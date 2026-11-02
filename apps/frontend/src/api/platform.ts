// Llamadas de la plataforma (SA) y del soporte, tipadas con el contrato. Reciben la función
// `request` de la sesión, que agrega el token y lo renueva si hace falta.
import type {
  CreatedAccount,
  NewAccountRequest,
  TechnicalAuditEntry,
  TechnicalPanel,
  Tenant,
  TenantCreateRequest,
  TicketDetail,
  TicketStatus,
  TicketSummary,
} from '@pos/contracts';

export type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const platformApi = (request: Request) => ({
  listTenants: () => request<Tenant[]>('/plataforma/comercios'),
  createTenant: (body: TenantCreateRequest) =>
    request<Tenant>('/plataforma/comercios', send('POST', body)),
  suspendTenant: (id: string) =>
    request<Tenant>(`/plataforma/comercios/${id}/suspension`, send('POST')),
  reactivateTenant: (id: string) =>
    request<Tenant>(`/plataforma/comercios/${id}/reactivacion`, send('POST')),
  closeTenant: (id: string) => request<Tenant>(`/plataforma/comercios/${id}/baja`, send('POST')),
  setBillingModule: (id: string, activo: boolean) =>
    request<Tenant>(`/plataforma/comercios/${id}/modulo-facturacion`, send('PUT', { activo })),
  createTenantAdmin: (id: string, body: NewAccountRequest) =>
    request<CreatedAccount>(`/plataforma/comercios/${id}/administrador`, send('POST', body)),
  createPlatformAdmin: (body: NewAccountRequest) =>
    request<CreatedAccount>('/plataforma/administradores', send('POST', body)),
  listTickets: (estado?: TicketStatus) =>
    request<TicketSummary[]>(`/plataforma/tickets${estado ? `?estado=${estado}` : ''}`),
  getTicket: (id: string) => request<TicketDetail>(`/plataforma/tickets/${id}`),
  replyTicket: (id: string, texto: string) =>
    request<TicketDetail>(`/plataforma/tickets/${id}/respuestas`, send('POST', { texto })),
  closeTicket: (id: string) =>
    request<TicketDetail>(`/plataforma/tickets/${id}/cierre`, send('POST')),
  technicalAudit: (filter: { tipo?: string; limite?: number }) => {
    const params = new URLSearchParams();
    if (filter.tipo) params.set('tipo', filter.tipo);
    if (filter.limite) params.set('limite', String(filter.limite));
    const query = params.toString();
    return request<TechnicalAuditEntry[]>(
      `/plataforma/auditoria-tecnica${query ? `?${query}` : ''}`,
    );
  },
  technicalPanel: () => request<TechnicalPanel>('/plataforma/panel'),
});
