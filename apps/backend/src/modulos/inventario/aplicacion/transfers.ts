// Transferencias entre sucursales del mismo comercio (T-093 a T-095; RF-044 a RF-047, RF-150,
// RF-151, D-36). Emite y cancela un AS de origen; recibe y rechaza un AS de destino.
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import { TRANSIT_LOSS_REASON, toUnits } from '../dominio/stock.js';
import {
  assertBranches,
  assertPending,
  normalizeItems,
  type ReceptionLine,
  type ReceptionResult,
  settleReception,
  settleRejection,
  type Transfer,
} from '../dominio/transfers.js';
import { type Actor, InventoryUseCase } from './ledger.js';
import type { CatalogProduct, TransferSummary } from './ports.js';

const TRANSFERS = 'transferencias.gestionar' as const;
const MAX_TRANSFERS = 100;
export const TRANSFER_SHORTAGE_ALERT = 'transferencia_faltante';

export interface TransferView extends TransferSummary {
  originName: string;
  destinationName: string;
  productNames: Record<string, string>;
}

abstract class TransferUseCase extends InventoryUseCase {
  protected async view(actor: Actor, transfer: TransferSummary): Promise<TransferView> {
    const branches = new Map(
      (await this.deps.branches.list(actor.tenantId)).map((b) => [b.id, b.name]),
    );
    const products = await this.deps.catalog.products(
      actor.tenantId,
      transfer.items.map((item) => item.productId),
    );
    return {
      ...transfer,
      originName: branches.get(transfer.originId) ?? '—',
      destinationName: branches.get(transfer.destinationId) ?? '—',
      productNames: Object.fromEntries(products.map((p) => [p.id, p.name])),
    };
  }

  // Toma la transferencia con bloqueo y verifica que el AS sea de la sucursal indicada.
  protected async pending(
    context: SecurityContext,
    actor: Actor,
    id: string,
    side: 'origin' | 'destination',
  ): Promise<TransferSummary> {
    const transfer = await this.deps.transfers.findForUpdate(actor.tenantId, id);
    if (!transfer) return this.deps.access.notFound(context, 'transferencia', id);
    await this.deps.access.check(context, TRANSFERS, {
      branchId: side === 'origin' ? transfer.originId : transfer.destinationId,
    });
    assertPending(transfer);
    return transfer;
  }

  protected async names(actor: Actor, transfer: Transfer): Promise<Map<string, CatalogProduct>> {
    const products = await this.deps.catalog.products(
      actor.tenantId,
      transfer.items.map((item) => item.productId),
    );
    return new Map(products.map((p) => [p.id, p]));
  }

  // Devuelve todo lo enviado al disponible de origen (rechazo total o cancelación).
  protected async returnToOrigin(
    actor: Actor,
    transfer: Transfer,
    operation: 'rechazarTransferencia' | 'cancelarTransferencia',
  ): Promise<void> {
    const products = await this.names(actor, transfer);
    for (const item of transfer.items) {
      const product = products.get(item.productId) ?? { id: item.productId, name: item.productId };
      await this.ledger.apply(actor, {
        branchId: transfer.originId,
        product,
        operation,
        quantity: item.sent,
        reference: transfer.id,
      });
    }
  }

  // Cierra la transferencia con su resultado y la registra en la auditoría.
  protected async close(
    actor: Actor,
    transfer: TransferSummary,
    result: ReceptionResult,
    action: string,
  ): Promise<TransferView> {
    await this.deps.transfers.close(
      actor.tenantId,
      transfer.id,
      result.state,
      result.items,
      actor.userId,
      actor.at,
    );
    const closed: TransferSummary = {
      ...transfer,
      state: result.state,
      items: result.items,
      closedAt: actor.at,
    };
    await this.record(
      actor,
      action === 'transferencia_cancelada' ? transfer.originId : transfer.destinationId,
      action,
      'transferencia',
      transfer.id,
      { estado: transfer.state, items: transfer.items },
      { estado: closed.state, items: closed.items },
    );
    return this.view(actor, closed);
  }
}

export class ListTransferBranches extends InventoryUseCase {
  // Sucursales del comercio, para elegir el destino. Marca las del ámbito del AS.
  async execute(context: SecurityContext): Promise<{ id: string; name: string; own: boolean }[]> {
    return this.inTenant(context, TRANSFERS, async (actor) =>
      (await this.deps.branches.list(actor.tenantId)).map((b) => ({
        ...b,
        own: context.branchIds.includes(b.id),
      })),
    );
  }
}

export class ListTransfers extends TransferUseCase {
  // De las sucursales del AS, como origen o destino.
  async execute(context: SecurityContext): Promise<TransferView[]> {
    return this.inTenant(context, TRANSFERS, async (actor) => {
      const transfers = await this.deps.transfers.list(
        actor.tenantId,
        context.branchIds,
        MAX_TRANSFERS,
      );
      return Promise.all(transfers.map((t) => this.view(actor, t)));
    });
  }
}

export class GetTransfer extends TransferUseCase {
  async execute(context: SecurityContext, id: string): Promise<TransferView> {
    return this.inTenant(context, TRANSFERS, async (actor) => {
      const transfer = await this.deps.transfers.find(actor.tenantId, id);
      if (!transfer) return this.deps.access.notFound(context, 'transferencia', id);
      if (
        !context.branchIds.includes(transfer.originId) &&
        !context.branchIds.includes(transfer.destinationId)
      ) {
        await this.deps.access.check(context, TRANSFERS, { branchId: transfer.originId });
      }
      return this.view(actor, transfer);
    });
  }
}

// Emisión (RF-044): el stock pasa del disponible de origen al tránsito. El destino tiene que ser
// otra sucursal activa del mismo comercio (RF-047).
export class IssueTransfer extends TransferUseCase {
  async execute(
    context: SecurityContext,
    input: {
      originId: string;
      destinationId: string;
      items: { productId: string; quantity: string }[];
    },
  ): Promise<TransferView> {
    return this.inBranch(context, TRANSFERS, input.originId, async (actor) => {
      assertBranches(input.originId, input.destinationId);
      await this.branch(context, TRANSFERS, actor, input.destinationId, false);
      const items = normalizeItems(input.items);
      // Antes de insertar: un producto de otro comercio responde como inexistente.
      const products = [];
      for (const item of items) products.push(await this.stockable(context, actor, item.productId));
      const transfer: TransferSummary = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        originId: input.originId,
        destinationId: input.destinationId,
        state: 'enviada',
        items: items.map((item) => ({
          productId: item.productId,
          sent: item.quantity,
          received: null,
          rejected: null,
          missing: null,
        })),
        sentAt: actor.at,
        closedAt: null,
      };
      await this.deps.transfers.insert(transfer, actor.userId, actor.at);
      for (const [index, item] of items.entries()) {
        const product = products[index] ?? { id: item.productId, name: item.productId };
        await this.ledger.apply(actor, {
          branchId: input.originId,
          product,
          operation: 'pasarATransito',
          quantity: item.quantity,
          reference: transfer.id,
        });
      }
      await this.record(
        actor,
        input.originId,
        'transferencia_emitida',
        'transferencia',
        transfer.id,
        null,
        {
          destino: input.destinationId,
          items,
        },
      );
      return this.view(actor, transfer);
    });
  }
}

// Recepción en destino (RF-045, RF-150): lo recibido entra al disponible de destino, lo rechazado
// vuelve al origen y el faltante sale del tránsito como merma, con alerta a los dos AS.
export class ReceiveTransfer extends TransferUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    lines: readonly ReceptionLine[],
  ): Promise<TransferView> {
    return this.inTenant(context, TRANSFERS, async (actor) => {
      const transfer = await this.pending(context, actor, id, 'destination');
      const result = settleReception(transfer, lines);
      const products = await this.names(actor, transfer);
      const shortages: { producto: string; faltante: string }[] = [];
      for (const item of result.items) {
        const product = products.get(item.productId) ?? {
          id: item.productId,
          name: item.productId,
        };
        const move = async (
          branchId: string,
          operation:
            'salirDeTransito' | 'recibirTransferencia' | 'mermarTransito' | 'rechazarTransferencia',
          quantity: string | null,
          reason: string | null = null,
        ) => {
          if (quantity === null || toUnits(quantity) === 0n) return;
          await this.ledger.apply(actor, {
            branchId,
            product,
            operation,
            quantity,
            reference: id,
            reason,
          });
        };
        await move(transfer.originId, 'salirDeTransito', item.received);
        await move(transfer.destinationId, 'recibirTransferencia', item.received);
        await move(transfer.originId, 'rechazarTransferencia', item.rejected);
        await move(transfer.originId, 'mermarTransito', item.missing, TRANSIT_LOSS_REASON);
        if (item.missing !== null && toUnits(item.missing) > 0n) {
          shortages.push({ producto: product.name, faltante: item.missing });
        }
      }
      if (shortages.length > 0) {
        for (const branchId of [transfer.originId, transfer.destinationId]) {
          await this.deps.alerts.add({
            tenantId: actor.tenantId,
            branchId,
            recipientRole: 'AS',
            type: TRANSFER_SHORTAGE_ALERT,
            severity: 'advertencia',
            reference: id,
            detail: { items: shortages },
            at: actor.at,
          });
        }
      }
      return this.close(actor, transfer, result, 'transferencia_recibida');
    });
  }
}

// Rechazo total por el destino (RF-046): todo vuelve al disponible de origen.
export class RejectTransfer extends TransferUseCase {
  async execute(context: SecurityContext, id: string): Promise<TransferView> {
    return this.inTenant(context, TRANSFERS, async (actor) => {
      const transfer = await this.pending(context, actor, id, 'destination');
      const result = settleRejection(transfer);
      await this.returnToOrigin(actor, transfer, 'rechazarTransferencia');
      return this.close(actor, transfer, result, 'transferencia_rechazada');
    });
  }
}

// Cancelación por el origen mientras no se recibió (RF-151).
export class CancelTransfer extends TransferUseCase {
  async execute(context: SecurityContext, id: string): Promise<TransferView> {
    return this.inTenant(context, TRANSFERS, async (actor) => {
      const transfer = await this.pending(context, actor, id, 'origin');
      await this.returnToOrigin(actor, transfer, 'cancelarTransferencia');
      return this.close(
        actor,
        transfer,
        {
          state: 'cancelada',
          items: transfer.items.map((item) => ({
            ...item,
            received: '0.000',
            rejected: item.sent,
            missing: '0.000',
          })),
        },
        'transferencia_cancelada',
      );
    });
  }
}
