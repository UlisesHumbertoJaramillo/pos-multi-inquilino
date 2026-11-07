// Alertas del rol activo, tipadas con el contrato. Quién las ve lo decide el backend (D-91).
import type { RoleAlert } from '@pos/contracts';
import type { Request } from './platform';

export const alertsApi = (request: Request) => ({
  list: () => request<RoleAlert[]>('/alertas'),
  resolve: (id: string, nota: string | null) =>
    request<undefined>(`/alertas/${id}/resolucion`, {
      method: 'POST',
      body: JSON.stringify(nota === null ? {} : { nota }),
    }),
});

export const SEVERITY_LABELS: Record<RoleAlert['severidad'], string> = {
  critica: 'Crítica',
  advertencia: 'Advertencia',
  info: 'Aviso',
};
