// Llamadas de proveedores, compras y recepción, tipadas con el contrato.
import type {
  CatalogImportResult,
  Purchase,
  PurchaseCreateRequest,
  PurchaseReceptionRequest,
  Supplier,
  SupplierCreateRequest,
  SupplierPaymentRequest,
  SupplierPaymentResult,
  SupplierStatement,
  SupplierUpdateRequest,
} from '@pos/contracts';
import type { Request } from './platform';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const suppliersApi = (request: Request) => ({
  listSuppliers: () => request<Supplier[]>('/proveedores'),
  createSupplier: (body: SupplierCreateRequest) =>
    request<Supplier>('/proveedores', send('POST', body)),
  updateSupplier: (id: string, body: SupplierUpdateRequest) =>
    request<Supplier>(`/proveedores/${id}`, send('PATCH', body)),
  deactivateSupplier: (id: string) => request<undefined>(`/proveedores/${id}/baja`, send('POST')),
  getStatement: (id: string) => request<SupplierStatement>(`/proveedores/${id}/cuenta`),
  importCatalog: (id: string, file: File) =>
    request<CatalogImportResult>(`/proveedores/${id}/importaciones`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'text/csv' },
    }),
  registerPayment: (id: string, body: SupplierPaymentRequest) =>
    request<SupplierPaymentResult>(`/proveedores/${id}/pagos`, send('POST', body)),
  listPurchases: () => request<Purchase[]>('/compras'),
  registerPurchase: (body: PurchaseCreateRequest) =>
    request<Purchase>('/compras', send('POST', body)),
  listPendingReceptions: () => request<Purchase[]>('/recepciones'),
  receivePurchase: (id: string, body: PurchaseReceptionRequest) =>
    request<Purchase>(`/compras/${id}/recepcion`, send('POST', body)),
});

export const PAYMENT_METHOD_NAMES: Record<SupplierPaymentRequest['metodo'], string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  otro: 'Otro',
};
