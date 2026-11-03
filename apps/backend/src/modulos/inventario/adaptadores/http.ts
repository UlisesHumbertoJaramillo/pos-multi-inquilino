// Rutas HTTP del módulo de inventario. El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import { type StockBalance, WASTE_REASONS } from '../dominio/stock.js';
import type { Alert, Movement } from '../aplicacion/ports.js';
import type {
  AdjustStock,
  ComboStock,
  DismissAlert,
  ListBranchAlerts,
  ListComboAvailability,
  ListMovements,
  ListStock,
  RecordWaste,
  ResolveReview,
  SetMinimum,
  StockRow,
} from '../aplicacion/stock.js';
import type {
  CancelTransfer,
  GetTransfer,
  IssueTransfer,
  ListTransferBranches,
  ListTransfers,
  ReceiveTransfer,
  RejectTransfer,
  TransferView,
} from '../aplicacion/transfers.js';

export interface InventoryUseCases {
  listStock: ListStock;
  adjustStock: AdjustStock;
  setMinimum: SetMinimum;
  recordWaste: RecordWaste;
  resolveReview: ResolveReview;
  listMovements: ListMovements;
  listBranchAlerts: ListBranchAlerts;
  dismissAlert: DismissAlert;
  listComboAvailability: ListComboAvailability;
  listTransferBranches: ListTransferBranches;
  listTransfers: ListTransfers;
  getTransfer: GetTransfer;
  issueTransfer: IssueTransfer;
  receiveTransfer: ReceiveTransfer;
  rejectTransfer: RejectTransfer;
  cancelTransfer: CancelTransfer;
}

const idParams = z.object({ id: z.uuid() });
const productParams = z.object({ id: z.uuid(), productoId: z.uuid() });
const alertParams = z.object({ id: z.uuid(), alertaId: z.uuid() });
const quantity = z.string().max(20);
const reason = z.string().max(200);

const adjustBody = z.object({ productoId: z.uuid(), cantidad: quantity, motivo: reason }).strict();
const minimumBody = z.object({ umbral: quantity.nullable() }).strict();
const wasteBody = z
  .object({
    productoId: z.uuid(),
    cantidad: quantity,
    motivo: z.enum(WASTE_REASONS),
    observacion: reason.nullable().optional(),
  })
  .strict();
const reviewBody = z
  .object({
    accion: z.enum(['reingresar', 'merma']),
    cantidad: quantity,
    motivo: reason.nullable().optional(),
  })
  .strict();
const transferBody = z
  .object({
    origenId: z.uuid(),
    destinoId: z.uuid(),
    items: z.array(z.object({ productoId: z.uuid(), cantidad: quantity }).strict()).max(100),
  })
  .strict();
const receptionBody = z
  .object({
    items: z
      .array(z.object({ productoId: z.uuid(), recibida: quantity, rechazada: quantity }).strict())
      .max(100),
  })
  .strict();

const balanceDto = (b: StockBalance) => ({
  productoId: b.productId,
  disponible: b.available,
  reservado: b.reserved,
  enRevision: b.inReview,
  enTransito: b.inTransit,
  umbralMinimo: b.minimum,
  alertaActiva: b.alertActive,
});
const stockRowDto = (row: StockRow) => ({
  ...balanceDto(row.balance),
  nombre: row.product.name,
  codigoBarras: row.product.barcode,
  activo: row.product.isActive,
});
const movementDto = (m: Movement) => ({
  id: m.id,
  productoId: m.productId,
  nombre: m.productName,
  tipo: m.type,
  estadoOrigen: m.from,
  estadoDestino: m.to,
  cantidad: m.quantity,
  referencia: m.reference,
  motivo: m.reason,
  usuarioId: m.userId,
  momento: m.at.toISOString(),
});
const alertDto = (a: Alert) => ({
  id: a.id,
  tipo: a.type,
  severidad: a.severity,
  referencia: a.reference,
  detalle: a.detail,
  creadaEn: a.at.toISOString(),
});
const comboDto = (c: ComboStock) => ({
  comboId: c.comboId,
  nombre: c.name,
  unidades: c.units,
  vendible: c.sellable,
});
const transferDto = (t: TransferView) => ({
  id: t.id,
  origen: { id: t.originId, nombre: t.originName },
  destino: { id: t.destinationId, nombre: t.destinationName },
  estado: t.state,
  emitidaEn: t.sentAt.toISOString(),
  cerradaEn: t.closedAt?.toISOString() ?? null,
  items: t.items.map((item) => ({
    productoId: item.productId,
    nombre: t.productNames[item.productId] ?? '—',
    enviada: item.sent,
    recibida: item.received,
    rechazada: item.rejected,
    faltante: item.missing,
  })),
});

const ADJUST = 'inventario.ajustar' as const;
const TRANSFERS = 'transferencias.gestionar' as const;

export function inventoryRoutes(useCases: InventoryUseCases): HttpRoute[] {
  return [
    // Stock de la sucursal (RF-039 a RF-043).
    {
      method: 'get',
      path: '/inventario/sucursales/:id/stock',
      action: ADJUST,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const rows = await useCases.listStock.execute(securityContextOf(res), id);
        res.json(rows.map(stockRowDto));
      },
    },
    {
      method: 'post',
      path: '/inventario/sucursales/:id/ajustes',
      action: ADJUST,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(adjustBody, req.body);
        const balance = await useCases.adjustStock.execute(securityContextOf(res), id, {
          productId: body.productoId,
          delta: body.cantidad,
          reason: body.motivo,
        });
        res.json(balanceDto(balance));
      },
    },
    {
      method: 'put',
      path: '/inventario/sucursales/:id/umbrales/:productoId',
      action: ADJUST,
      handler: async (req, res) => {
        const { id, productoId } = parseInput(productParams, req.params);
        const body = parseInput(minimumBody, req.body);
        const balance = await useCases.setMinimum.execute(
          securityContextOf(res),
          id,
          productoId,
          body.umbral,
        );
        res.json(balanceDto(balance));
      },
    },
    {
      method: 'post',
      path: '/inventario/sucursales/:id/mermas',
      action: ADJUST,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(wasteBody, req.body);
        const balance = await useCases.recordWaste.execute(securityContextOf(res), id, {
          productId: body.productoId,
          quantity: body.cantidad,
          reason: body.motivo,
          note: body.observacion ?? null,
        });
        res.json(balanceDto(balance));
      },
    },
    {
      method: 'post',
      path: '/inventario/sucursales/:id/revision/:productoId',
      action: ADJUST,
      handler: async (req, res) => {
        const { id, productoId } = parseInput(productParams, req.params);
        const body = parseInput(reviewBody, req.body);
        const balance = await useCases.resolveReview.execute(
          securityContextOf(res),
          id,
          productoId,
          {
            action: body.accion,
            quantity: body.cantidad,
            reason: body.motivo ?? null,
          },
        );
        res.json(balanceDto(balance));
      },
    },
    {
      method: 'get',
      path: '/inventario/sucursales/:id/movimientos',
      action: ADJUST,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const list = await useCases.listMovements.execute(securityContextOf(res), id);
        res.json(list.map(movementDto));
      },
    },
    // Alertas de la sucursal (RF-041, RF-045).
    {
      method: 'get',
      path: '/inventario/sucursales/:id/alertas',
      action: ADJUST,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const list = await useCases.listBranchAlerts.execute(securityContextOf(res), id);
        res.json(list.map(alertDto));
      },
    },
    {
      method: 'post',
      path: '/inventario/sucursales/:id/alertas/:alertaId/descarte',
      action: ADJUST,
      handler: async (req, res) => {
        const { id, alertaId } = parseInput(alertParams, req.params);
        await useCases.dismissAlert.execute(securityContextOf(res), id, alertaId);
        res.status(204).end();
      },
    },
    // Disponibilidad de combos sobre el stock real (RF-052).
    {
      method: 'get',
      path: '/inventario/sucursales/:id/combos',
      action: ADJUST,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const list = await useCases.listComboAvailability.execute(securityContextOf(res), id);
        res.json(list.map(comboDto));
      },
    },
    // Transferencias (RF-044 a RF-047, RF-150, RF-151).
    {
      method: 'get',
      path: '/inventario/sucursales',
      action: TRANSFERS,
      handler: async (_req, res) => {
        const list = await useCases.listTransferBranches.execute(securityContextOf(res));
        res.json(list.map((b) => ({ id: b.id, nombre: b.name, propia: b.own })));
      },
    },
    {
      method: 'get',
      path: '/inventario/transferencias',
      action: TRANSFERS,
      handler: async (_req, res) => {
        const list = await useCases.listTransfers.execute(securityContextOf(res));
        res.json(list.map(transferDto));
      },
    },
    {
      method: 'post',
      path: '/inventario/transferencias',
      action: TRANSFERS,
      handler: async (req, res) => {
        const body = parseInput(transferBody, req.body);
        const transfer = await useCases.issueTransfer.execute(securityContextOf(res), {
          originId: body.origenId,
          destinationId: body.destinoId,
          items: body.items.map((item) => ({
            productId: item.productoId,
            quantity: item.cantidad,
          })),
        });
        res.status(201).json(transferDto(transfer));
      },
    },
    {
      method: 'get',
      path: '/inventario/transferencias/:id',
      action: TRANSFERS,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const transfer = await useCases.getTransfer.execute(securityContextOf(res), id);
        res.json(transferDto(transfer));
      },
    },
    {
      method: 'post',
      path: '/inventario/transferencias/:id/recepcion',
      action: TRANSFERS,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(receptionBody, req.body);
        const transfer = await useCases.receiveTransfer.execute(
          securityContextOf(res),
          id,
          body.items.map((item) => ({
            productId: item.productoId,
            received: item.recibida,
            rejected: item.rechazada,
          })),
        );
        res.json(transferDto(transfer));
      },
    },
    {
      method: 'post',
      path: '/inventario/transferencias/:id/rechazo',
      action: TRANSFERS,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const transfer = await useCases.rejectTransfer.execute(securityContextOf(res), id);
        res.json(transferDto(transfer));
      },
    },
    {
      method: 'post',
      path: '/inventario/transferencias/:id/cancelacion',
      action: TRANSFERS,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const transfer = await useCases.cancelTransfer.execute(securityContextOf(res), id);
        res.json(transferDto(transfer));
      },
    },
  ];
}
