// Rutas HTTP de reportes, ticket y auditoría comercial (T-232 a T-236). El contrato está en
// packages/contracts/openapi.yaml.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type {
  AuditPage,
  DailyReport,
  Dashboard,
  GetBranchDashboard,
  GetDailyReport,
  GetStrategicDashboard,
  GetTicket,
  QueryCommercialAudit,
  TicketView,
  Totals,
} from '../aplicacion/reports.js';
import type {
  CashCountDifference,
  MethodTotal,
  ReturnTotals,
  SellerTotal,
  VoidTotals,
} from '../aplicacion/ports.js';

export interface ReportUseCases {
  getTicket: GetTicket;
  getDailyReport: GetDailyReport;
  getStrategicDashboard: GetStrategicDashboard;
  getBranchDashboard: GetBranchDashboard;
  queryCommercialAudit: QueryCommercialAudit;
}

const idParams = z.object({ id: z.uuid() });
const day = z.string().max(10);
const dailyQuery = z.object({ fecha: day.optional() }).strict();
const periodQuery = z.object({ desde: day.optional(), hasta: day.optional() }).strict();
const strategicQuery = periodQuery.extend({ sucursalId: z.uuid().optional() }).strict();
const auditQuery = z
  .object({
    desde: z.iso.datetime({ offset: true }).optional(),
    hasta: z.iso.datetime({ offset: true }).optional(),
    sucursalId: z.uuid().optional(),
    usuarioId: z.uuid().optional(),
    entidad: z.string().min(1).max(60).optional(),
    accion: z.string().min(1).max(80).optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
    tamano: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const iso = (value: Date | null) => value?.toISOString() ?? null;

const ticketDto = ({ document: d, identification, legend, print }: TicketView) => ({
  ventaId: d.saleId,
  estado: d.state,
  numeroTicket: d.ticketNumber,
  confirmadaEn: iso(d.confirmedAt),
  comercio: { nombre: d.tenant.name, cuit: d.tenant.cuit },
  sucursal: { nombre: d.branch.name, direccion: d.branch.address },
  caja: d.register,
  vendedor: d.seller,
  cliente:
    d.customer === null
      ? null
      : {
          nombre: d.customer.name,
          documento: d.customer.document,
          condicionFiscal: d.customer.taxCondition,
        },
  items: d.items.map((i) => ({
    nombre: i.name,
    cantidad: i.quantity,
    precioUnitario: i.unitPrice,
    bruto: i.gross,
    promocion:
      i.promotion === null ? null : { nombre: i.promotion.name, descuento: i.promotion.discount },
    descuentoManual: i.manualDiscount,
    importe: i.final,
    devuelta: i.returned,
  })),
  pagos: d.payments.map((p) => ({
    metodo: p.method,
    tipo: p.type,
    monto: p.amount,
    recargo: p.surcharge,
    abonado: p.tendered,
    vuelto: p.change,
  })),
  totales: {
    subtotal: d.totals.subtotal,
    descuentoPromociones: d.totals.promotionDiscount,
    descuentoManual: d.totals.manualDiscount,
    total: d.totals.total,
    recargos: d.totals.surcharges,
    cobrado: d.totals.charged,
  },
  identificacion: identification,
  leyenda: legend,
  impresion: {
    ancho: print.width,
    lineas: print.lines.map((l) => ({ texto: l.text, estilo: l.style })),
  },
  comprobante:
    d.voucher === null
      ? null
      : {
          tipo: d.voucher.type,
          clase: d.voucher.voucherClass,
          puntoVenta: d.voucher.pointOfSale,
          numero: d.voucher.number,
          cae: d.voucher.cae,
          caea: d.voucher.caea,
          estado: d.voucher.state,
        },
});

const totalsDto = (t: Totals) => ({ total: t.total, tickets: t.tickets, promedio: t.average });
const methodDto = (m: MethodTotal) => ({
  metodo: m.method,
  tipo: m.type,
  monto: m.amount,
  recargo: m.surcharge,
});
const sellerDto = (s: SellerTotal) => ({
  vendedorId: s.sellerId,
  vendedor: s.seller,
  tickets: s.tickets,
  total: s.total,
});
const returnsDto = (r: ReturnTotals) => ({
  cantidad: r.count,
  valor: r.value,
  reintegro: r.refund,
});
const voidsDto = (v: VoidTotals) => ({ cantidad: v.count, total: v.total, reintegro: v.refund });
const cashCountDto = (c: CashCountDifference) => ({
  tipo: c.kind,
  caja: c.register,
  vendedor: c.seller,
  fechaJornada: c.day,
  resultado: c.result,
  diferencia: c.difference,
  momento: c.at.toISOString(),
});

const dailyDto = (r: DailyReport) => ({
  sucursal: { id: r.branch.id, nombre: r.branch.name },
  fechaJornada: r.day,
  ventas: totalsDto(r.sales),
  porMedio: r.byMethod.map(methodDto),
  porVendedor: r.bySeller.map(sellerDto),
  porTurno: r.byShift.map((s) => ({
    turnoId: s.shiftId,
    caja: s.register,
    vendedor: s.seller,
    abiertoEn: s.openedAt.toISOString(),
    cerradoEn: iso(s.closedAt),
    tickets: s.tickets,
    total: s.total,
    resultado: s.result,
    diferencia: s.difference,
  })),
  devoluciones: returnsDto(r.returns),
  anulaciones: voidsDto(r.voids),
  arqueos: r.cashCounts.map(cashCountDto),
  comprobantesSinRegularizar: r.pendingVouchers,
});

const dashboardDto = (d: Dashboard) => ({
  desde: d.period.from,
  hasta: d.period.to,
  sucursalId: d.branchId,
  ventas: totalsDto(d.sales),
  devoluciones: returnsDto(d.returns),
  anulaciones: voidsDto(d.voids),
  porMedio: d.byMethod.map(methodDto),
  porVendedor: d.bySeller.map(sellerDto),
  porProducto: d.byProduct.map((p) => ({
    productoId: p.productId,
    nombre: p.name,
    cantidad: p.quantity,
    total: p.total,
  })),
  porDia: d.byDay.map((x) => ({ fecha: x.day, total: x.total, tickets: x.tickets })),
  arqueos: d.cashCounts.map(cashCountDto),
  bajoMinimo: d.belowMinimum.map((b) => ({
    sucursal: b.branch,
    producto: b.product,
    disponible: b.available,
    umbral: b.minimum,
  })),
  comprobantesSinRegularizar: d.pendingVouchers,
  anterior: {
    desde: d.previous.period.from,
    hasta: d.previous.period.to,
    ventas: totalsDto(d.previous.sales),
  },
  variacion: { total: d.change.total, tickets: d.change.tickets, promedio: d.change.average },
  serieDiaria: d.dailySeries.map((x) => ({ fecha: x.day, total: x.total, tickets: x.tickets })),
  masVendidos: d.topProducts.map((p) => ({
    productoId: p.productId,
    nombre: p.name,
    cantidad: p.quantity,
    total: p.total,
  })),
  atencion: {
    arqueosConDiferencia: d.attention.cashCountDifferences,
    bajoMinimo: d.attention.lowStock,
    comprobantesSinRegularizar: d.attention.pendingVouchers,
  },
  alertas: {
    criticas: d.alerts.critical,
    advertencias: d.alerts.warning,
    informativas: d.alerts.info,
  },
});

const auditDto = (page: AuditPage) => ({
  entradas: page.entries.map((e) => ({
    id: e.id,
    momento: e.at.toISOString(),
    sucursalId: e.branchId,
    sucursal: e.branch,
    usuarioId: e.userId,
    usuario: e.user,
    rolActivo: e.role,
    accion: e.action,
    entidad: e.entity,
    entidadId: e.entityId,
    antes: e.before ?? null,
    despues: e.after ?? null,
    autorizacionId: e.authorizationId,
  })),
  hayMas: page.hasMore,
});

export function reportRoutes(useCases: ReportUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/ventas/:id/ticket',
      action: 'ventas.operar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(ticketDto(await useCases.getTicket.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'get',
      path: '/reportes/sucursales/:id/informe-diario',
      action: 'dashboard.operativo',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const query = parseInput(dailyQuery, req.query);
        const report = await useCases.getDailyReport.execute(
          securityContextOf(res),
          id,
          query.fecha ?? null,
        );
        res.json(dailyDto(report));
      },
    },
    {
      method: 'get',
      path: '/reportes/sucursales/:id/dashboard',
      action: 'dashboard.operativo',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const query = parseInput(periodQuery, req.query);
        const dashboard = await useCases.getBranchDashboard.execute(securityContextOf(res), id, {
          from: query.desde ?? null,
          to: query.hasta ?? null,
        });
        res.json(dashboardDto(dashboard));
      },
    },
    {
      method: 'get',
      path: '/reportes/dashboard',
      action: 'dashboard.estrategico',
      handler: async (req, res) => {
        const query = parseInput(strategicQuery, req.query);
        const dashboard = await useCases.getStrategicDashboard.execute(securityContextOf(res), {
          from: query.desde ?? null,
          to: query.hasta ?? null,
          branchId: query.sucursalId ?? null,
        });
        res.json(dashboardDto(dashboard));
      },
    },
    {
      method: 'get',
      path: '/auditoria-comercial',
      action: 'auditoria_comercial.consultar',
      handler: async (req, res) => {
        const query = parseInput(auditQuery, req.query);
        const page = await useCases.queryCommercialAudit.execute(securityContextOf(res), {
          from: query.desde ? new Date(query.desde) : null,
          to: query.hasta ? new Date(query.hasta) : null,
          branchId: query.sucursalId ?? null,
          userId: query.usuarioId ?? null,
          entity: query.entidad ?? null,
          action: query.accion ?? null,
          page: query.pagina,
          pageSize: query.tamano,
        });
        res.json(auditDto(page));
      },
    },
  ];
}
