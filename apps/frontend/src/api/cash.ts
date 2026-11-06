// Llamadas de caja (VO y AS) y de autorizaciones por PIN, tipadas con el contrato.
import type {
  Authorizer,
  CashCount,
  CashMovement,
  CashRegisterStatus,
  CashShift,
  JourneyClosure,
  OwnShift,
  ShiftClosure,
} from '@pos/contracts';
import type { Request } from './platform';

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export type AuthorizationType =
  'retiro' | 'descuento' | 'cierre_forzado' | 'credito' | 'pago_por_verificar';

export const cashApi = (request: Request) => ({
  listRegisters: (branchId: string) =>
    request<CashRegisterStatus[]>(`/caja/sucursales/${branchId}/cajas`),
  getOwnShift: () => request<OwnShift>('/caja/turno'),
  openShift: (cajaId: string, saldoInicial: string) =>
    request<CashShift>('/caja/turnos', post({ cajaId, saldoInicial })),
  recordCashIn: (monto: string, motivo: string) =>
    request<CashMovement>('/caja/turno/ingresos', post({ monto, motivo })),
  recordWithdrawal: (monto: string, motivo: string, autorizacionId: string) =>
    request<CashMovement>('/caja/turno/retiros', post({ monto, motivo, autorizacionId })),
  closeOwnShift: (declarado: string) =>
    request<ShiftClosure>('/caja/turno/corte-x', post({ declarado })),
  listOpenShifts: (branchId: string) =>
    request<CashShift[]>(`/caja/sucursales/${branchId}/turnos-abiertos`),
  forceCloseShift: (shiftId: string, declarado: string) =>
    request<ShiftClosure>(`/caja/turnos/${shiftId}/cierre-forzado`, post({ declarado })),
  closeJourney: (cajaId: string, declarado: string) =>
    request<JourneyClosure>(`/caja/cajas/${cajaId}/corte-z`, post({ declarado })),
  listAuthorizers: (branchId: string) =>
    request<Authorizer[]>(`/autorizaciones/autorizantes?sucursalId=${branchId}`),
  authorize: (body: {
    tipo: AuthorizationType;
    operacionRef: string;
    sucursalId: string;
    autorizanteId: string;
    pin: string;
  }) => request<{ id: string }>('/autorizaciones', post(body)),
});

// Monto con dos decimales, como lo espera la referencia de una autorización de retiro.
export const twoDecimals = (value: string) => {
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) ? number.toFixed(2) : value;
};

export const RESULT_NAMES: Record<NonNullable<CashCount['resultado']>, string> = {
  faltante: 'Faltante',
  sobrante: 'Sobrante',
  cuadrado: 'Cuadrado',
};

export const MOVEMENT_NAMES: Record<CashMovement['tipo'], string> = {
  ingreso: 'Ingreso',
  retiro: 'Retiro',
  venta: 'Venta',
  reintegro: 'Reintegro',
  cobro: 'Cobro',
  anulacion: 'Anulación',
};
