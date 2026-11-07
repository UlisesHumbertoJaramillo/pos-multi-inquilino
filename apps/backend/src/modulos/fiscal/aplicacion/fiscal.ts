// Facturación fiscal (T-190 a T-205; RF-100 a RF-106, RF-155, RF-160 a RF-162, RF-165, RF-168).
// La llamada al servicio fiscal nunca ocurre dentro de una transacción: se toma el comprobante, se
// llama y se guarda el resultado. Solo una aceptación deja la venta como emitida (RF-106).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { EventOutbox } from '../../../compartido/aplicacion/event-outbox.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  assertWithinLaterInvoicing,
  CAEA_LEAD_DAYS,
  caeaPeriodOf,
  certificateExpiresSoon,
  daysUntil,
  type IssuerCondition,
  nextAttempt,
  nextCaeaPeriod,
  normalizeCuit,
  REMINDER_MS,
  requiresInvoiceA,
  voucherClass,
} from '../dominio/vouchers.js';
import type {
  FiscalAlert,
  FiscalAlerts,
  FiscalDirectory,
  FiscalRepository,
  FiscalResult,
  FiscalSales,
  FiscalService,
  SaleFiscalStates,
  SaleForVoucher,
  SecretCipher,
  Voucher,
  VoucherRow,
} from './ports.js';

export { requiresInvoiceA, type IssuerCondition };

const CLAIM_MS = 2 * 60_000;

export interface FiscalDependencies {
  uow: UnitOfWork;
  vouchers: FiscalRepository;
  directory: FiscalDirectory;
  sales: FiscalSales;
  states: SaleFiscalStates;
  service: FiscalService;
  alerts: FiscalAlerts;
  cipher: SecretCipher;
  certificateExpiry: (pem: string) => Date;
  outbox: EventOutbox;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

const dateIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

// Cola fiscal, sin sesión: la usan el consumidor del outbox, el worker y el reenvío.
export class FiscalQueue {
  constructor(private readonly deps: FiscalDependencies) {}

  private inTenant<T>(tenantId: string, work: () => Promise<T>) {
    return this.deps.uow.run(work, { tenantId });
  }

  // Crea el comprobante de una venta. Idempotente: el outbox puede entregar dos veces.
  async request(tenantId: string, saleId: string): Promise<void> {
    await this.inTenant(tenantId, async () => {
      if (!(await this.deps.directory.moduleActive(tenantId))) return;
      if (await this.deps.vouchers.forSale(tenantId, saleId)) return;
      const sale = await this.deps.sales.find(tenantId, saleId);
      if (!sale) return;
      await this.create(tenantId, sale);
    });
    await this.process(tenantId);
  }

  private async create(tenantId: string, sale: SaleForVoucher) {
    const now = this.deps.clock.now();
    const { regularizationHours } = await this.deps.directory.settings(tenantId);
    await this.deps.vouchers.insert({
      id: this.deps.ids.next(),
      tenantId,
      type: 'factura',
      voucherClass: null,
      saleId: sale.id,
      branchId: sale.branchId,
      registerId: sale.registerId,
      pointOfSale: sale.pointOfSale,
      number: null,
      total: sale.total,
      buyer: sale.buyer,
      contingency: false,
      caeaCode: null,
      nonFiscal: false,
      cae: null,
      state: 'pendiente',
      rejection: null,
      attempts: 0,
      nextAttemptAt: now,
      deadline: new Date(now.getTime() + regularizationHours * 3_600_000),
      issuedAt: now,
      resolvedAt: null,
    });
  }

  // Envía la cola vencida. Si el servicio cae, no se insiste con ese punto de venta en esta
  // pasada, pero cada comprobante igual pasa a contingencia. Un rechazo no frena al resto.
  async process(tenantId: string): Promise<void> {
    const due = await this.inTenant(tenantId, () =>
      this.deps.vouchers.due(tenantId, this.deps.clock.now()),
    );
    const down = new Set<number | null>();
    for (const voucher of due) {
      const answer = await this.send(tenantId, voucher, down.has(voucher.pointOfSale));
      if (answer === 'no_disponible') down.add(voucher.pointOfSale);
    }
  }

  private async send(tenantId: string, queued: Voucher, skipCall: boolean) {
    const now = this.deps.clock.now();
    const prepared = await this.inTenant(tenantId, async () => {
      const claimed = await this.deps.vouchers.claim(
        tenantId,
        queued.id,
        now,
        new Date(now.getTime() + CLAIM_MS),
      );
      if (!claimed) return null;
      return this.prepare(tenantId, queued.id, now);
    });
    if (!prepared) return null;

    const request = { tenantId, voucher: prepared.voucher, cuit: prepared.cuit };
    const call = prepared.voucher.contingency
      ? () => this.deps.service.report(request)
      : () => this.deps.service.authorize(request);
    const answer: FiscalResult = skipCall ? { outcome: 'no_disponible' } : await ask(call);

    await this.inTenant(tenantId, async () => {
      const voucher = await this.deps.vouchers.find(tenantId, queued.id, true);
      if (voucher?.state !== 'pendiente') return;
      const at = this.deps.clock.now();
      if (!skipCall) {
        await this.deps.vouchers.addAttempt(tenantId, {
          id: this.deps.ids.next(),
          voucherId: voucher.id,
          at,
          result: answer.outcome,
          detail: answer.outcome === 'rechazado' ? answer.reason : null,
        });
      }
      await this.apply(tenantId, voucher, answer, at);
    });
    return answer.outcome;
  }

  // Sin configuración o sin punto de venta, el comprobante espera en la cola y se alerta al AC
  // (D-87). Con todo listo, toma su tipo y su número.
  private async prepare(tenantId: string, id: string, now: Date) {
    const voucher = await this.deps.vouchers.find(tenantId, id, true);
    if (voucher?.state !== 'pendiente') return null;
    const sale = await this.deps.sales.find(tenantId, voucher.saleId);
    const pointOfSale = voucher.pointOfSale ?? sale?.pointOfSale ?? null;
    const credential = await this.deps.vouchers.credentialInfo(tenantId);
    if (pointOfSale === null || !credential) {
      await this.deps.alerts.raise({
        tenantId,
        branchId: null,
        role: 'AC',
        type: 'fiscal_sin_configurar',
        severity: 'advertencia',
        persistent: true,
        reference: null,
        detail: { motivo: credential ? 'punto_de_venta' : 'credencial' },
        at: now,
      });
      await this.deps.vouchers.save({
        ...voucher,
        attempts: voucher.attempts + 1,
        nextAttemptAt: nextAttempt(voucher.attempts + 1, now),
      });
      return null;
    }
    await this.deps.alerts.resolve(tenantId, 'fiscal_sin_configurar', null, now);
    const issued = voucherClass(credential.condition, voucher.buyer.condition);
    const fresh = voucher.number === null || voucher.voucherClass !== issued;
    const ready: Voucher = {
      ...voucher,
      pointOfSale,
      voucherClass: issued,
      number: fresh
        ? await this.deps.vouchers.nextNumber(tenantId, pointOfSale, issued)
        : voucher.number,
    };
    await this.deps.vouchers.save(ready);
    return { voucher: ready, cuit: credential.cuit };
  }

  private async apply(tenantId: string, voucher: Voucher, answer: FiscalResult, at: Date) {
    const attempts = voucher.attempts + 1;
    if (answer.outcome === 'aceptado') {
      await this.deps.vouchers.save({
        ...voucher,
        attempts,
        state: 'aceptado',
        cae: voucher.contingency ? null : answer.cae,
        rejection: null,
        resolvedAt: at,
      });
      await this.deps.states.set(tenantId, voucher.saleId, 'emitida');
      await this.deps.alerts.resolve(tenantId, 'fiscal_plazo_vencido', voucher.id, at);
      await this.deps.alerts.resolve(tenantId, 'comprobante_rechazado', voucher.id, at);
      await this.deps.alerts.resolve(tenantId, 'fiscal_sin_caea', voucher.id, at);
      return;
    }
    if (answer.outcome === 'rechazado') {
      await this.deps.vouchers.save({
        ...voucher,
        attempts,
        state: 'rechazado',
        rejection: answer.reason,
        // Un rechazo en línea deja el ticket como no fiscal (RF-103).
        nonFiscal: voucher.nonFiscal || !voucher.contingency,
      });
      await this.deps.states.set(tenantId, voucher.saleId, 'rechazada');
      for (const role of ['AS', 'AC'] as const) {
        await this.deps.alerts.raise({
          tenantId,
          branchId: voucher.branchId,
          role,
          type: 'comprobante_rechazado',
          severity: 'critica',
          persistent: true,
          reference: voucher.id,
          detail: { motivo: answer.reason, numero: voucher.number },
          at,
        });
      }
      return;
    }
    const retry = { ...voucher, attempts, nextAttemptAt: nextAttempt(attempts, at) };
    if (voucher.contingency || voucher.nonFiscal) {
      await this.deps.vouchers.save(retry);
      return;
    }
    const timeZone = await this.deps.directory.timeZone(tenantId);
    const caea = await this.deps.vouchers.caeaFor(tenantId, dateIn(voucher.issuedAt, timeZone));
    if (caea !== undefined) {
      await this.deps.vouchers.save({ ...retry, contingency: true, caeaCode: caea });
      await this.deps.states.set(tenantId, voucher.saleId, 'en_contingencia');
      return;
    }
    // Sin CAEA vigente: ticket no fiscal, el pedido sigue en cola (RF-161).
    await this.deps.vouchers.save({ ...retry, nonFiscal: true });
    await this.deps.alerts.raise({
      tenantId,
      branchId: null,
      role: 'AC',
      type: 'fiscal_sin_caea',
      severity: 'critica',
      persistent: true,
      reference: voucher.id,
      detail: { numero: voucher.number },
      at,
    });
  }

  // Pasada periódica del worker por cada comercio con el módulo activo.
  async sweep(): Promise<void> {
    for (const tenantId of await this.deps.directory.tenantsWithModule()) {
      await this.ensureCaea(tenantId);
      await this.checkCertificate(tenantId);
      await this.process(tenantId);
      await this.escalate(tenantId);
    }
  }

  // Pide el CAEA del período actual y, con anticipación, el del siguiente (RF-160).
  private async ensureCaea(tenantId: string) {
    const now = this.deps.clock.now();
    const timeZone = await this.inTenant(tenantId, () => this.deps.directory.timeZone(tenantId));
    const today = dateIn(now, timeZone);
    const current = caeaPeriodOf(today);
    const next = nextCaeaPeriod(current);
    const wanted = daysUntil(today, next.from) <= CAEA_LEAD_DAYS ? [current, next] : [current];
    for (const period of wanted) {
      if (await this.inTenant(tenantId, () => this.deps.vouchers.hasCaea(tenantId, period.code))) {
        continue;
      }
      const answer = await askCaea(() => this.deps.service.requestCaea(tenantId, period.code));
      await this.inTenant(tenantId, async () => {
        if (answer.outcome === 'no_disponible') {
          await this.deps.alerts.raise({
            tenantId,
            branchId: null,
            role: 'AC',
            type: 'caea_no_obtenido',
            severity: 'critica',
            persistent: true,
            reference: null,
            detail: { periodo: period.code },
            at: now,
          });
          return;
        }
        await this.deps.vouchers.addCaea(tenantId, {
          id: this.deps.ids.next(),
          period: period.code,
          code: answer.code,
          from: period.from,
          to: period.to,
          at: now,
        });
        await this.deps.alerts.resolve(tenantId, 'caea_no_obtenido', null, now);
      });
    }
  }

  private async checkCertificate(tenantId: string) {
    await this.inTenant(tenantId, async () => {
      const now = this.deps.clock.now();
      const credential = await this.deps.vouchers.credentialInfo(tenantId);
      if (!credential) return;
      if (!certificateExpiresSoon(credential.expiresAt, now)) {
        await this.deps.alerts.resolve(tenantId, 'certificado_por_vencer', null, now);
        return;
      }
      await this.deps.alerts.raise({
        tenantId,
        branchId: null,
        role: 'AC',
        type: 'certificado_por_vencer',
        severity: 'advertencia',
        persistent: true,
        reference: null,
        detail: { venceEn: credential.expiresAt.toISOString() },
        at: now,
      });
    });
  }

  // Plazo vencido: alerta crítica que no se descarta y recordatorios periódicos (RF-105, D-38).
  private async escalate(tenantId: string) {
    await this.inTenant(tenantId, async () => {
      const now = this.deps.clock.now();
      const next = new Date(now.getTime() + REMINDER_MS);
      for (const voucher of await this.deps.vouchers.overdue(tenantId, now)) {
        await this.deps.alerts.raise({
          tenantId,
          branchId: null,
          role: 'AC',
          type: 'fiscal_plazo_vencido',
          severity: 'critica',
          persistent: true,
          reference: voucher.id,
          detail: { numero: voucher.number, recordatorios: 0 },
          at: now,
          nextReminder: next,
        });
      }
      await this.deps.alerts.remind(tenantId, 'fiscal_plazo_vencido', now, next);
    });
  }

  async pendingFor(tenantId: string) {
    return this.inTenant(tenantId, () => this.deps.vouchers.pendingCounts(tenantId));
  }
}

// Una falla técnica es "no disponible", nunca una aceptación (D-41, Const. 11).
async function ask(call: () => Promise<FiscalResult>): Promise<FiscalResult> {
  try {
    return await call();
  } catch {
    return { outcome: 'no_disponible' };
  }
}

async function askCaea(call: () => ReturnType<FiscalService['requestCaea']>) {
  try {
    return await call();
  } catch {
    return { outcome: 'no_disponible' as const };
  }
}

abstract class FiscalUseCase {
  constructor(
    protected readonly deps: FiscalDependencies,
    protected readonly queue: FiscalQueue,
  ) {}

  protected async assertModule(tenantId: string) {
    if (!(await this.deps.directory.moduleActive(tenantId))) {
      throw new ApplicationError(
        'conflict',
        'MODULO_FISCAL_INACTIVO',
        'El comercio no tiene activo el módulo de facturación.',
      );
    }
  }
}

export interface FiscalConfiguration {
  cuit: string | null;
  condition: IssuerCondition | null;
  expiresAt: Date | null;
}

// Nunca devuelve el certificado ni la clave (RF-162).
export class GetFiscalConfiguration extends FiscalUseCase {
  async execute(context: SecurityContext): Promise<FiscalConfiguration> {
    await this.deps.access.check(context, 'facturacion.configurar');
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(
      async () => {
        await this.assertModule(tenantId);
        const info = await this.deps.vouchers.credentialInfo(tenantId);
        return {
          cuit: info?.cuit ?? null,
          condition: info?.condition ?? null,
          expiresAt: info?.expiresAt ?? null,
        };
      },
      { tenantId },
    );
  }
}

export class SaveFiscalCredential extends FiscalUseCase {
  async execute(
    context: SecurityContext,
    input: { cuit: string; condition: IssuerCondition; certificate: string; key: string },
  ): Promise<FiscalConfiguration> {
    await this.deps.access.check(context, 'facturacion.configurar');
    const tenantId = this.deps.access.requireTenant(context);
    const cuit = normalizeCuit(input.cuit);
    let expiresAt: Date;
    try {
      expiresAt = this.deps.certificateExpiry(input.certificate);
    } catch {
      throw new DomainError('CERTIFICADO_INVALIDO', 'El certificado no se pudo leer.');
    }
    return this.deps.uow.run(
      async () => {
        await this.assertModule(tenantId);
        const at = this.deps.clock.now();
        await this.deps.vouchers.saveCredential(
          tenantId,
          {
            cuit,
            condition: input.condition,
            certificate: this.deps.cipher.encrypt(input.certificate),
            key: this.deps.cipher.encrypt(input.key),
            expiresAt,
          },
          context.userId,
          at,
        );
        await this.deps.audit.record({
          tenantId,
          branchId: null,
          userId: context.userId,
          activeRole: 'AC',
          action: 'credencial_fiscal_cargada',
          entity: 'credencial_fiscal',
          entityId: tenantId,
          after: { cuit, venceEn: expiresAt.toISOString() },
        });
        return { cuit, condition: input.condition, expiresAt };
      },
      { tenantId },
    );
  }
}

const REVIEW = 'facturacion.corregir_rechazos' as const;
const branchesOf = (context: SecurityContext) =>
  context.activeRole === 'AC' ? null : context.branchIds;

export class ListVouchers extends FiscalUseCase {
  async execute(
    context: SecurityContext,
  ): Promise<{ vouchers: VoucherRow[]; alerts: FiscalAlert[] }> {
    await this.deps.access.check(context, REVIEW);
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(
      async () => {
        await this.assertModule(tenantId);
        return {
          vouchers: await this.deps.vouchers.list(tenantId, branchesOf(context)),
          alerts: await this.deps.alerts.list(tenantId, branchesOf(context)),
        };
      },
      { tenantId },
    );
  }
}

// Reenvío de un comprobante rechazado (RF-104, D-87): el dato se corrige en la ficha del cliente;
// acá se toma de nuevo el comprador y se vuelve a enviar.
export class ResendVoucher extends FiscalUseCase {
  async execute(context: SecurityContext, id: string): Promise<VoucherRow> {
    await this.deps.access.check(context, REVIEW);
    const tenantId = this.deps.access.requireTenant(context);
    await this.deps.uow.run(
      async () => {
        const voucher = await this.deps.vouchers.find(tenantId, id, true);
        const branches = branchesOf(context);
        if (!voucher || (branches !== null && !branches.includes(voucher.branchId))) {
          return this.deps.access.notFound(context, 'comprobante', id);
        }
        await this.assertModule(tenantId);
        if (voucher.state !== 'rechazado') {
          throw new DomainError(
            'COMPROBANTE_NO_RECHAZADO',
            'Solo se reenvía un comprobante rechazado.',
          );
        }
        const sale = await this.deps.sales.find(tenantId, voucher.saleId);
        const now = this.deps.clock.now();
        await this.deps.vouchers.save({
          ...voucher,
          buyer: sale?.buyer ?? voucher.buyer,
          state: 'pendiente',
          rejection: null,
          nextAttemptAt: now,
        });
        await this.deps.states.set(tenantId, voucher.saleId, 'pendiente');
        await this.deps.audit.record({
          tenantId,
          branchId: voucher.branchId,
          userId: context.userId,
          activeRole: context.activeRole === 'AC' ? 'AC' : 'AS',
          action: 'comprobante_reenviado',
          entity: 'comprobante',
          entityId: voucher.id,
          before: { motivo: voucher.rejection },
        });
      },
      { tenantId },
    );
    await this.queue.process(tenantId);
    return this.deps.uow.run(
      async () => {
        const rows = await this.deps.vouchers.list(tenantId, null);
        const row = rows.find((v) => v.id === id);
        if (!row) throw new Error('El comprobante desapareció.');
        return row;
      },
      { tenantId },
    );
  }
}

// Facturación posterior de una venta sin factura, dentro del plazo (RF-168, D-59).
export class InvoiceLater extends FiscalUseCase {
  async execute(context: SecurityContext, ticket: number): Promise<void> {
    await this.deps.access.check(context, 'facturacion.facturar_posterior');
    const tenantId = this.deps.access.requireTenant(context);
    await this.deps.uow.run(
      async () => {
        await this.assertModule(tenantId);
        const sale = await this.deps.sales.findByTicket(tenantId, ticket);
        const branches = branchesOf(context);
        if (!sale || (branches !== null && !branches.includes(sale.branchId))) {
          throw new DomainError('TICKET_INEXISTENTE', 'No se encontró ese ticket.');
        }
        if (sale.state !== 'confirmada' || sale.billed === true) {
          throw new DomainError(
            'VENTA_YA_FACTURADA',
            'Esa venta ya se facturó o no está confirmada.',
          );
        }
        const { laterInvoicingDays } = await this.deps.directory.settings(tenantId);
        const now = this.deps.clock.now();
        const timeZone = await this.deps.directory.timeZone(tenantId);
        assertWithinLaterInvoicing(sale.journeyDate, laterInvoicingDays, dateIn(now, timeZone));
        await this.deps.states.markBilled(tenantId, sale.id, context.userId);
        await this.deps.outbox.add({
          type: 'comprobante.solicitado',
          tenantId,
          payload: { ventaId: sale.id },
        });
        await this.deps.audit.record({
          tenantId,
          branchId: sale.branchId,
          userId: context.userId,
          activeRole: context.activeRole === 'AC' ? 'AC' : 'AS',
          action: 'facturacion_posterior',
          entity: 'venta',
          entityId: sale.id,
          after: { ticket },
        });
      },
      { tenantId },
    );
  }
}
