// Llamadas del POS (VO), tipadas con el contrato. Los totales los calcula el backend en cada cambio.
import type {
  Cart,
  SaleDiscountRequest,
  SaleReceipt,
  SaleSearchResult,
  SalesOverview,
  SaleTransfer,
  TransferTarget,
} from '@pos/contracts';
import type { Request } from './platform';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const salesApi = (request: Request) => ({
  listOwn: () => request<SalesOverview>('/ventas'),
  start: () => request<Cart>('/ventas', send('POST')),
  search: (q: string) =>
    request<SaleSearchResult[]>(`/ventas/productos?q=${encodeURIComponent(q)}`),
  addItem: (saleId: string, productoId: string, cantidad: string) =>
    request<Cart>(`/ventas/${saleId}/items`, send('POST', { productoId, cantidad })),
  setQuantity: (saleId: string, itemId: string, cantidad: string) =>
    request<Cart>(`/ventas/${saleId}/items/${itemId}`, send('PATCH', { cantidad })),
  removeItem: (saleId: string, itemId: string) =>
    request<Cart>(`/ventas/${saleId}/items/${itemId}/baja`, send('POST')),
  setDiscount: (saleId: string, body: SaleDiscountRequest) =>
    request<Cart>(`/ventas/${saleId}/descuento`, send('PUT', body)),
  discard: (saleId: string) => request<undefined>(`/ventas/${saleId}/descarte`, send('POST')),
  payCash: (saleId: string, entregado: string | null) =>
    request<SaleReceipt>(`/ventas/${saleId}/cobro`, send('POST', { entregado })),
  transferTargets: (saleId: string) => request<TransferTarget[]>(`/ventas/${saleId}/receptores`),
  transfer: (saleId: string, receptorId: string) =>
    request<SaleTransfer>(`/ventas/${saleId}/traspaso`, send('POST', { receptorId })),
  acceptTransfer: (id: string) => request<Cart>(`/ventas/traspasos/${id}/aceptacion`, send('POST')),
  rejectTransfer: (id: string) =>
    request<undefined>(`/ventas/traspasos/${id}/rechazo`, send('POST')),
});

// "2.000" → "2"; "1.500" → "1,5".
export const formatQuantity = (value: string) => Number(value).toLocaleString('es-AR');
