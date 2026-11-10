// Alertas del rol activo, tipadas con el contrato. Quién las ve lo decide el backend (D-91).
import type { AlertSummary, RoleAlert } from '@pos/contracts';
import type { Request } from './platform';

export const alertsApi = (request: Request) => ({
  list: () => request<RoleAlert[]>('/alertas'),
  // Cantidad de pendientes y la más grave, para el indicador del encabezado (RF-189).
  summary: () => request<AlertSummary>('/alertas/resumen'),
  resolve: (id: string, nota: string | null) =>
    request<undefined>(`/alertas/${id}/resolucion`, {
      method: 'POST',
      body: JSON.stringify(nota === null ? {} : { nota }),
    }),
});
