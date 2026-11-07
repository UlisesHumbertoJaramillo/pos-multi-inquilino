// Devoluciones y anulaciones del POS, tipadas con el contrato. El reintegro lo calcula el backend.
import type {
  ReturnQuote,
  ReturnQuoteRequest,
  ReturnResult,
  ReturnTicket,
  VoidResult,
} from '@pos/contracts';
import type { Request } from './platform';

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const returnsApi = (request: Request) => ({
  ticket: (numero: number) => request<ReturnTicket>(`/devoluciones/tickets/${String(numero)}`),
  quote: (saleId: string, items: ReturnQuoteRequest['items']) =>
    request<ReturnQuote>(`/devoluciones/ventas/${saleId}/cotizacion`, post({ items })),
  confirm: (saleId: string, items: ReturnQuoteRequest['items'], autorizacionId: string | null) =>
    request<ReturnResult>(`/devoluciones/ventas/${saleId}`, post({ items, autorizacionId })),
  voidSale: (saleId: string, autorizacionId: string) =>
    request<VoidResult>(`/devoluciones/ventas/${saleId}/anulacion`, post({ autorizacionId })),
});
