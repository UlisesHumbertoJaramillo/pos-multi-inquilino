// Llamadas del POS (VO), tipadas con el contrato. Los totales los calcula el backend en cada cambio.
import type {
  Cart,
  SaleCustomer,
  SaleDiscountRequest,
  SalePaymentAttempt,
  SalePaymentMethod,
  SalePaymentRequest,
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
  pay: (saleId: string, body: SalePaymentRequest) =>
    request<SaleReceipt>(`/ventas/${saleId}/cobro`, send('POST', body)),
  methods: () => request<SalePaymentMethod[]>('/ventas/metodos-pago'),
  customers: (q: string) => request<SaleCustomer[]>(`/ventas/clientes?q=${encodeURIComponent(q)}`),
  setCustomer: (saleId: string, clienteId: string | null) =>
    request<Cart>(`/ventas/${saleId}/cliente`, send('PUT', { clienteId })),
  // Cada intento lleva su clave: repetirla nunca genera otro cobro (RF-126).
  charge: (saleId: string, metodoPagoId: string, fraccion: string) =>
    request<SalePaymentAttempt>(
      `/ventas/${saleId}/pagos`,
      send('POST', { metodoPagoId, fraccion, claveIdempotencia: crypto.randomUUID() }),
    ),
  reverse: (saleId: string, paymentId: string) =>
    request<Cart>(`/ventas/${saleId}/pagos/${paymentId}/reversion`, send('POST')),
  resolve: (
    saleId: string,
    paymentId: string,
    resultado: 'aprobado' | 'rechazado',
    autorizacionId: string,
  ) =>
    request<Cart>(
      `/ventas/${saleId}/pagos/${paymentId}/resolucion`,
      send('POST', { resultado, autorizacionId }),
    ),
  transferTargets: (saleId: string) => request<TransferTarget[]>(`/ventas/${saleId}/receptores`),
  transfer: (saleId: string, receptorId: string) =>
    request<SaleTransfer>(`/ventas/${saleId}/traspaso`, send('POST', { receptorId })),
  acceptTransfer: (id: string) => request<Cart>(`/ventas/traspasos/${id}/aceptacion`, send('POST')),
  rejectTransfer: (id: string) =>
    request<undefined>(`/ventas/traspasos/${id}/rechazo`, send('POST')),
});

// "2.000" → "2"; "1.500" → "1,5".
export const formatQuantity = (value: string) => Number(value).toLocaleString('es-AR');
