// Llamadas del inventario y las transferencias (AS), tipadas con el contrato.
import type {
  Alert,
  ComboStock,
  ReviewResolutionRequest,
  StockAdjustmentRequest,
  StockBalance,
  StockMovement,
  StockRow,
  Transfer,
  TransferBranch,
  TransferCreateRequest,
  TransferReceptionRequest,
  WasteRequest,
} from '@pos/contracts';
import { formatMoney } from './catalog';
import type { Request } from './platform';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const branch = (id: string) => `/inventario/sucursales/${id}`;

export const inventoryApi = (request: Request) => ({
  listBranches: () => request<TransferBranch[]>('/inventario/sucursales'),
  listStock: (branchId: string) => request<StockRow[]>(`${branch(branchId)}/stock`),
  adjust: (branchId: string, body: StockAdjustmentRequest) =>
    request<StockBalance>(`${branch(branchId)}/ajustes`, send('POST', body)),
  setMinimum: (branchId: string, productId: string, umbral: string | null) =>
    request<StockBalance>(`${branch(branchId)}/umbrales/${productId}`, send('PUT', { umbral })),
  recordWaste: (branchId: string, body: WasteRequest) =>
    request<StockBalance>(`${branch(branchId)}/mermas`, send('POST', body)),
  resolveReview: (branchId: string, productId: string, body: ReviewResolutionRequest) =>
    request<StockBalance>(`${branch(branchId)}/revision/${productId}`, send('POST', body)),
  listMovements: (branchId: string) => request<StockMovement[]>(`${branch(branchId)}/movimientos`),
  listAlerts: (branchId: string) => request<Alert[]>(`${branch(branchId)}/alertas`),
  dismissAlert: (branchId: string, alertId: string) =>
    request<undefined>(`${branch(branchId)}/alertas/${alertId}/descarte`, send('POST')),
  listCombos: (branchId: string) => request<ComboStock[]>(`${branch(branchId)}/combos`),
  listTransfers: () => request<Transfer[]>('/inventario/transferencias'),
  issueTransfer: (body: TransferCreateRequest) =>
    request<Transfer>('/inventario/transferencias', send('POST', body)),
  receiveTransfer: (id: string, body: TransferReceptionRequest) =>
    request<Transfer>(`/inventario/transferencias/${id}/recepcion`, send('POST', body)),
  rejectTransfer: (id: string) =>
    request<Transfer>(`/inventario/transferencias/${id}/rechazo`, send('POST')),
  cancelTransfer: (id: string) =>
    request<Transfer>(`/inventario/transferencias/${id}/cancelacion`, send('POST')),
});

// "10.500" → "10,5". Solo presentación.
export function formatQuantity(value: string | null): string {
  if (value === null) return '—';
  return Number(value).toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

export const TRANSFER_STATES: Record<Transfer['estado'], string> = {
  enviada: 'En tránsito',
  recibida: 'Recibida',
  parcial: 'Recibida con diferencias',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

export const MOVEMENT_TYPES: Record<StockMovement['tipo'], string> = {
  ingreso: 'Ingreso',
  ajuste: 'Ajuste',
  merma: 'Merma',
  reserva: 'Reserva',
  liberacion: 'Liberación',
  venta: 'Venta',
  transferencia: 'Transferencia enviada',
  recepcion: 'Transferencia recibida',
  rechazo: 'Transferencia rechazada',
  cancelacion: 'Transferencia cancelada',
  devolucion: 'Devolución',
  reingreso: 'Reingreso',
};

// Texto de una alerta a partir de su tipo y su detalle.
export function describeAlert(alert: Alert): string {
  const detail = alert.detalle as {
    producto?: string;
    disponible?: string;
    umbral?: string;
    items?: { producto: string; faltante: string }[];
  };
  if (alert.tipo === 'stock_minimo') {
    return `${detail.producto ?? 'Un producto'} quedó por debajo del mínimo: ${formatQuantity(detail.disponible ?? null)} de ${formatQuantity(detail.umbral ?? null)}.`;
  }
  if (alert.tipo === 'transferencia_faltante') {
    const items = (detail.items ?? [])
      .map((item) => `${formatQuantity(item.faltante)} × ${item.producto}`)
      .join(', ');
    return `Una transferencia llegó con faltante: ${items}.`;
  }
  const cash = alert.detalle as {
    caja?: string;
    vendedor?: string;
    declarado?: string;
    anterior?: string;
    diferencia?: string;
    monto?: string;
    efectivoTeorico?: string;
    resultado?: string;
    fechaJornada?: string;
  };
  const money = (value?: string) => formatMoney(value ?? null);
  switch (alert.tipo) {
    case 'diferencia_apertura':
      return `${cash.vendedor ?? 'Un vendedor'} abrió ${cash.caja ?? 'una caja'} con ${money(cash.declarado)}, pero el turno anterior declaró ${money(cash.anterior)} (diferencia ${money(cash.diferencia)}).`;
    case 'retiro_rechazado':
      return `Se rechazó un retiro de ${money(cash.monto)} de ${cash.vendedor ?? 'un vendedor'} en ${cash.caja ?? 'una caja'}: el efectivo teórico era ${money(cash.efectivoTeorico)}.`;
    case 'arqueo_fuera_de_tolerancia':
      return `Arqueo de ${cash.caja ?? 'una caja'}${cash.vendedor ? ` (${cash.vendedor})` : ''} con ${cash.resultado ?? 'diferencia'} de ${money(cash.diferencia)}.`;
    case 'cierre_forzado':
      return `Se forzó el cierre del turno de ${cash.vendedor ?? 'un vendedor'} en ${cash.caja ?? 'una caja'}.`;
    case 'jornada_sin_z':
      return `${cash.caja ?? 'Una caja'} tiene la jornada del ${cash.fechaJornada ?? '—'} sin Corte Z: no se pueden abrir turnos hasta hacerlo.`;
  }
  return alert.tipo;
}
