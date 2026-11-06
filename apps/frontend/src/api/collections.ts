// Clientes, cuenta corriente y simulador de la pasarela, tipados con el contrato.
import type {
  AccountCollection,
  Customer,
  CustomerCreditRequest,
  CustomerRequest,
  GatewaySimulator,
} from '@pos/contracts';
import type { Request } from './platform';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const FISCAL_CONDITIONS: Record<Customer['condicionFiscal'], string> = {
  consumidor_final: 'Consumidor final',
  responsable_inscripto: 'Responsable inscripto',
  monotributista: 'Monotributista',
  exento: 'Exento',
};

export const collectionsApi = (request: Request) => ({
  listCustomers: (includeInactive: boolean) =>
    request<Customer[]>(`/clientes?incluirInactivos=${String(includeInactive)}`),
  createCustomer: (body: CustomerRequest) => request<Customer>('/clientes', send('POST', body)),
  updateCustomer: (id: string, body: CustomerRequest) =>
    request<Customer>(`/clientes/${id}`, send('PUT', body)),
  setCredit: (id: string, body: CustomerCreditRequest) =>
    request<Customer>(`/clientes/${id}/credito`, send('PUT', body)),
  deactivateCustomer: (id: string) => request<undefined>(`/clientes/${id}/baja`, send('POST')),
  collect: (
    customerId: string,
    body: { metodoPagoId: string; monto: string; entregado: string | null },
  ) =>
    request<AccountCollection>(
      `/clientes/${customerId}/cobros`,
      send('POST', { ...body, claveIdempotencia: crypto.randomUUID() }),
    ),
  pendingCollections: () => request<AccountCollection[]>('/cuenta-corriente/cobros'),
  resolveCollection: (id: string, resultado: 'aprobado' | 'rechazado', autorizacionId: string) =>
    request<AccountCollection>(
      `/cuenta-corriente/cobros/${id}/resolucion`,
      send('POST', { resultado, autorizacionId }),
    ),
  simulator: () => request<GatewaySimulator>('/simulador/pasarela'),
  setSimulator: (modo: GatewaySimulator['modo']) =>
    request<GatewaySimulator>('/simulador/pasarela', send('PUT', { modo })),
});
