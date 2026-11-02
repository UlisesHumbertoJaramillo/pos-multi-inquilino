// Salud del sistema, tipada con el contrato de la API (packages/contracts).
import type { HealthStatus } from '@pos/contracts';
import { apiRequest } from './httpClient';

export function getHealth(): Promise<HealthStatus> {
  return apiRequest<HealthStatus>('/salud');
}
