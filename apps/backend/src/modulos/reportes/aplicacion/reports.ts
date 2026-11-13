// Casos de uso de reportes y de la auditoría comercial (T-232 a T-236; RF-107, RF-109 a RF-111,
// RF-114, D-50, D-91). Solo leen.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { Action } from '../../../compartido/aplicacion/permissions.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  assertDay,
  assertPeriod,
  averageTicket,
  dateIn,
  changePercent,
  defaultPeriod,
  fillDays,
  previousPeriod,
  MAX_PERIOD_DAYS,
  type Period,
  TICKET_LEGENDS,
  type TicketIdentification,
  ticketIdentification,
} from '../dominio/reports.js';
import { type PrintLine, TICKET_WIDTH, ticketLines } from '../dominio/ticket-layout.js';
import type {
  AlertCounts,
  AuditEntry,
  AuditReader,
  BelowMinimum,
  CashCountDifference,
  DayTotal,
  MethodTotal,
  ProductTotal,
  ReportReader,
  ReportScope,
  ReturnTotals,
  SellerTotal,
  ShiftTotal,
  TicketDocument,
  VoidTotals,
} from './ports.js';

export interface ReportDependencies {
  uow: UnitOfWork;
  reports: ReportReader;
  audit: AuditReader;
  access: AccessControl;
  clock: Clock;
}

interface Actor {
  tenantId: string;
}

abstract class ReportUseCase {
  constructor(protected readonly deps: ReportDependencies) {}

  protected async inTenant<T>(
    context: SecurityContext,
    action: Action,
    work: (actor: Actor) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, action);
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(() => work({ tenantId }), { tenantId });
  }

  // Sucursal del comercio (si no, inexistente) y dentro del ámbito del rol (si no, sin permiso).
  protected async branch(
    context: SecurityContext,
    action: Action,
    actor: Actor,
    branchId: string,
  ): Promise<string> {
    const name = await this.deps.reports.branchName(actor.tenantId, branchId);
    if (name === null) return this.deps.access.notFound(context, 'sucursal', branchId);
    await this.deps.access.check(context, action, { branchId });
    return name;
  }

  protected async today(actor: Actor): Promise<string> {
    return dateIn(this.deps.clock.now(), await this.deps.reports.timeZone(actor.tenantId));
  }
}

export interface TicketView {
  document: TicketDocument;
  identification: TicketIdentification;
  legend: string;
  // Líneas listas para la impresora térmica de 80 mm (AD-16, D-92).
  print: { width: number; lines: PrintLine[] };
}

// Documento del ticket de una venta confirmada o anulada (RF-107). Lo pide el VO de la sucursal.
export class GetTicket extends ReportUseCase {
  async execute(context: SecurityContext, saleId: string): Promise<TicketView> {
    const action = 'ventas.operar';
    return this.inTenant(context, action, async (actor) => {
      const document = await this.deps.reports.ticket(actor.tenantId, saleId);
      if (!document) return this.deps.access.notFound(context, 'venta', saleId);
      await this.deps.access.check(context, action, { branchId: document.branchId });
      if (document.state !== 'confirmada' && document.state !== 'anulada') {
        throw new DomainError('VENTA_SIN_TICKET', 'La venta todavía no está confirmada.');
      }
      const identification = ticketIdentification({
        billed: document.billed,
        voucher: document.voucher && {
          state: document.voucher.state,
          nonFiscal: document.voucher.nonFiscal,
          authorized: document.voucher.cae !== null || document.voucher.caea !== null,
        },
      });
      const legend = TICKET_LEGENDS[identification];
      return {
        document,
        identification,
        legend,
        print: { width: TICKET_WIDTH, lines: ticketLines({ ...document, legend }) },
      };
    });
  }
}

export interface Totals {
  total: string;
  tickets: number;
  average: string;
}

export interface DailyReport {
  branch: { id: string; name: string };
  day: string;
  sales: Totals;
  byMethod: MethodTotal[];
  bySeller: SellerTotal[];
  byShift: ShiftTotal[];
  returns: ReturnTotals;
  voids: VoidTotals;
  cashCounts: CashCountDifference[];
  // Nulo sin el módulo de facturación.
  pendingVouchers: number | null;
}

// Informe diario de una sucursal por fecha de jornada (RF-109, D-91).
export class GetDailyReport extends ReportUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    day: string | null,
  ): Promise<DailyReport> {
    const action = 'dashboard.operativo';
    return this.inTenant(context, action, async (actor) => {
      const name = await this.branch(context, action, actor, branchId);
      const date = day === null ? await this.today(actor) : assertDay(day);
      const scope: ReportScope = { tenantId: actor.tenantId, branchIds: [branchId] };
      const period = { from: date, to: date };
      const r = this.deps.reports;
      const sales = await r.sales(scope, period);
      return {
        branch: { id: branchId, name },
        day: date,
        sales: { ...sales, average: averageTicket(sales.total, sales.tickets) },
        byMethod: await r.byMethod(scope, period),
        bySeller: await r.bySeller(scope, period),
        byShift: await r.byShift(scope, period),
        returns: await r.returns(scope, period),
        voids: await r.voids(scope, period),
        cashCounts: await r.cashCounts(scope, period),
        pendingVouchers: (await r.fiscalModule(actor.tenantId))
          ? await r.pendingVouchers(scope, period)
          : null,
      };
    });
  }
}

export interface Dashboard {
  period: Period;
  branchId: string | null;
  sales: Totals;
  returns: ReturnTotals;
  voids: VoidTotals;
  byMethod: MethodTotal[];
  bySeller: SellerTotal[];
  byProduct: ProductTotal[];
  byDay: DayTotal[];
  cashCounts: CashCountDifference[];
  belowMinimum: BelowMinimum[];
  // Sin regularizar a hoy, de cualquier fecha. Nulo sin el módulo de facturación.
  pendingVouchers: number | null;
  alerts: AlertCounts;
  // Primer nivel (D-97): comparación con el período anterior de igual duración, serie diaria
  // completa para la gráfica, los más vendidos y los puntos que requieren atención (RF-186).
  previous: { period: Period; sales: Totals };
  change: { total: string | null; tickets: string | null; average: string | null };
  dailySeries: DayTotal[];
  topProducts: ProductTotal[];
  attention: { cashCountDifferences: number; lowStock: number; pendingVouchers: number | null };
}

export const TOP_PRODUCTS = 20;
export const TOP_PRODUCTS_CHART = 5;

async function buildDashboard(
  reports: ReportReader,
  scope: ReportScope,
  period: Period,
  role: 'AC' | 'AS',
): Promise<Dashboard> {
  const current = await reports.sales(scope, period);
  const sales = { ...current, average: averageTicket(current.total, current.tickets) };
  const before = previousPeriod(period);
  const earlier = await reports.sales(scope, before);
  const previous = { ...earlier, average: averageTicket(earlier.total, earlier.tickets) };
  const byProduct = await reports.byProduct(scope, period, TOP_PRODUCTS);
  const byDay = await reports.byDay(scope, period);
  const cashCounts = await reports.cashCounts(scope, period);
  const belowMinimum = await reports.belowMinimum(scope);
  const pendingVouchers = (await reports.fiscalModule(scope.tenantId))
    ? await reports.pendingVouchers(scope, null)
    : null;
  return {
    period,
    branchId: scope.branchIds?.[0] ?? null,
    sales,
    previous: { period: before, sales: previous },
    change: {
      total: changePercent(sales.total, previous.total),
      tickets: changePercent(String(sales.tickets), String(previous.tickets), 0),
      average: changePercent(sales.average, previous.average),
    },
    dailySeries: fillDays(period, byDay, (day) => ({ day, total: '0.00', tickets: 0 })),
    topProducts: byProduct.slice(0, TOP_PRODUCTS_CHART),
    attention: {
      cashCountDifferences: cashCounts.length,
      lowStock: belowMinimum.length,
      pendingVouchers,
    },
    returns: await reports.returns(scope, period),
    voids: await reports.voids(scope, period),
    byMethod: await reports.byMethod(scope, period),
    bySeller: await reports.bySeller(scope, period),
    byProduct,
    byDay,
    cashCounts,
    belowMinimum,
    pendingVouchers,
    alerts: await reports.alertCounts(scope, role),
  };
}

export interface PeriodInput {
  from: string | null;
  to: string | null;
}

abstract class DashboardUseCase extends ReportUseCase {
  protected async period(actor: Actor, input: PeriodInput): Promise<Period> {
    const fallback = defaultPeriod(await this.today(actor));
    return assertPeriod({ from: input.from ?? fallback.from, to: input.to ?? fallback.to });
  }
}

// Dashboard estratégico del AC: todo el comercio o una sucursal (RF-110).
export class GetStrategicDashboard extends DashboardUseCase {
  async execute(
    context: SecurityContext,
    input: PeriodInput & { branchId: string | null },
  ): Promise<Dashboard> {
    const action = 'dashboard.estrategico';
    return this.inTenant(context, action, async (actor) => {
      if (input.branchId !== null) await this.branch(context, action, actor, input.branchId);
      const period = await this.period(actor, input);
      const scope = {
        tenantId: actor.tenantId,
        branchIds: input.branchId === null ? null : [input.branchId],
      };
      return buildDashboard(this.deps.reports, scope, period, 'AC');
    });
  }
}

// Dashboard operativo de una sucursal: el AS solo la suya (RF-111).
export class GetBranchDashboard extends DashboardUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    input: PeriodInput,
  ): Promise<Dashboard> {
    const action = 'dashboard.operativo';
    return this.inTenant(context, action, async (actor) => {
      await this.branch(context, action, actor, branchId);
      const period = await this.period(actor, input);
      const role = context.activeRole === 'AC' ? 'AC' : 'AS';
      return buildDashboard(
        this.deps.reports,
        { tenantId: actor.tenantId, branchIds: [branchId] },
        period,
        role,
      );
    });
  }
}

export interface AuditInput {
  from: Date | null;
  to: Date | null;
  branchId: string | null;
  userId: string | null;
  entity: string | null;
  action: string | null;
  page: number;
  pageSize: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  hasMore: boolean;
}

const DEFAULT_AUDIT_DAYS = 7;
const DAY_MS = 86_400_000;

// Auditoría comercial: el AC ve todo su comercio y el AS solo sus sucursales (RF-114). El SA no
// tiene la acción en la matriz.
export class QueryCommercialAudit extends ReportUseCase {
  async execute(context: SecurityContext, input: AuditInput): Promise<AuditPage> {
    const action = 'auditoria_comercial.consultar';
    return this.inTenant(context, action, async (actor) => {
      if (input.branchId !== null) await this.branch(context, action, actor, input.branchId);
      const to = input.to ?? this.deps.clock.now();
      const from = input.from ?? new Date(to.getTime() - DEFAULT_AUDIT_DAYS * DAY_MS);
      if (from > to) {
        throw new DomainError('PERIODO_INVALIDO', 'La fecha inicial es posterior a la final.');
      }
      if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
        throw new DomainError(
          'PERIODO_DEMASIADO_LARGO',
          `El período puede abarcar hasta ${String(MAX_PERIOD_DAYS)} días.`,
        );
      }
      const branchIds =
        input.branchId !== null
          ? [input.branchId]
          : context.activeRole === 'AC'
            ? null
            : context.branchIds;
      // Se pide uno más para saber si hay otra página.
      const rows = await this.deps.audit.entries({
        tenantId: actor.tenantId,
        branchIds,
        from,
        to,
        userId: input.userId,
        entity: input.entity,
        action: input.action,
        limit: input.pageSize + 1,
        offset: (input.page - 1) * input.pageSize,
      });
      return { entries: rows.slice(0, input.pageSize), hasMore: rows.length > input.pageSize };
    });
  }
}
