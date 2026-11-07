// Ticket, informe diario, dashboards y auditoría comercial, tipados con el contrato. Todas las
// cifras las calcula el backend: estas llamadas solo las piden.
import type { CommercialAuditPage, DailyReport, Dashboard, SaleTicket } from '@pos/contracts';
import type { Request } from './platform';

const query = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
};

export interface PeriodFilter {
  desde?: string | null;
  hasta?: string | null;
}

export interface AuditFilter {
  desde?: string | null;
  hasta?: string | null;
  sucursalId?: string | null;
  entidad?: string | null;
  accion?: string | null;
  pagina?: number;
}

export const reportsApi = (request: Request) => ({
  ticket: (saleId: string) => request<SaleTicket>(`/ventas/${saleId}/ticket`),
  daily: (branchId: string, fecha: string | null) =>
    request<DailyReport>(`/reportes/sucursales/${branchId}/informe-diario${query({ fecha })}`),
  branchDashboard: (branchId: string, period: PeriodFilter) =>
    request<Dashboard>(`/reportes/sucursales/${branchId}/dashboard${query({ ...period })}`),
  dashboard: (period: PeriodFilter & { sucursalId?: string | null }) =>
    request<Dashboard>(`/reportes/dashboard${query({ ...period })}`),
  audit: (filter: AuditFilter) =>
    request<CommercialAuditPage>(`/auditoria-comercial${query({ ...filter })}`),
});
