// Llamadas del módulo fiscal, tipadas con el contrato.
import type {
  FiscalConfiguration,
  FiscalCredentialRequest,
  FiscalSimulator,
  Voucher,
  VoucherOverview,
} from '@pos/contracts';
import { formatMoney } from './catalog';
import type { Request } from './platform';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const fiscalApi = (request: Request) => ({
  configuration: () => request<FiscalConfiguration>('/fiscal/configuracion'),
  saveCredential: (body: FiscalCredentialRequest) =>
    request<FiscalConfiguration>('/fiscal/credencial', send('PUT', body)),
  vouchers: () => request<VoucherOverview>('/fiscal/comprobantes'),
  resend: (id: string) => request<Voucher>(`/fiscal/comprobantes/${id}/reenvio`, send('POST')),
  invoiceLater: (numeroTicket: number) =>
    request<undefined>('/fiscal/facturacion-posterior', send('POST', { numeroTicket })),
  simulator: () => request<FiscalSimulator>('/simulador/fiscal'),
  setSimulator: (modo: FiscalSimulator['modo']) =>
    request<FiscalSimulator>('/simulador/fiscal', send('PUT', { modo })),
});

export const ISSUER_CONDITIONS: Record<FiscalCredentialRequest['condicionFiscal'], string> = {
  responsable_inscripto: 'Responsable inscripto',
  monotributista: 'Monotributista',
  exento: 'Exento',
};

export function describeVoucherState(v: Voucher): string {
  if (v.estado === 'aceptado') return 'Emitido';
  if (v.estado === 'rechazado') return 'Rechazado';
  if (v.estado === 'bloqueado') return 'Bloqueado';
  if (v.contingencia) return 'Con CAEA, por informar';
  return v.noFiscal ? 'En cola, ticket no fiscal' : 'En cola';
}

export function describeFiscalAlert(tipo: string, detalle: Record<string, unknown>): string {
  const text = (key: string) => {
    const value = detalle[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  };
  switch (tipo) {
    case 'comprobante_rechazado':
      return `Comprobante rechazado: ${text('motivo')}`;
    case 'fiscal_sin_caea':
      return 'El servicio fiscal no responde y no hay un CAEA vigente: se emitió un ticket no fiscal.';
    case 'fiscal_sin_configurar':
      return text('motivo') === 'punto_de_venta'
        ? 'Hay ventas facturadas en una caja sin punto de venta: asignáselo en Estructura.'
        : 'Falta cargar el certificado fiscal del comercio.';
    case 'caea_no_obtenido':
      return `No se pudo obtener el CAEA del período ${text('periodo')}.`;
    case 'certificado_por_vencer':
      return 'El certificado fiscal está por vencer.';
    case 'fiscal_plazo_vencido':
      return 'Venció el plazo para regularizar un comprobante.';
    case 'reintegro_pendiente':
      return `Reintegro pendiente de ${formatMoney(text('monto'))}.`;
    default:
      return tipo;
  }
}
