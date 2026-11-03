// Llamadas de promociones (AC), tipadas con el contrato.
import type {
  Promotion,
  PromotionCreateRequest,
  PromotionRule,
  PromotionUpdateRequest,
} from '@pos/contracts';
import { formatMoney } from './catalog';
import type { Request } from './platform';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const promotionsApi = (request: Request) => ({
  listPromotions: (onlyCurrent: boolean) =>
    request<Promotion[]>(`/promociones${onlyCurrent ? '?vigentes=true' : ''}`),
  createPromotion: (body: PromotionCreateRequest) =>
    request<Promotion>('/promociones', send('POST', body)),
  updatePromotion: (id: string, body: PromotionUpdateRequest) =>
    request<Promotion>(`/promociones/${id}`, send('PATCH', body)),
  deactivatePromotion: (id: string) => request<undefined>(`/promociones/${id}/baja`, send('POST')),
});

// "2x1", "15 %", "3 por $ 1.000,00".
export function describeRule(rule: PromotionRule): string {
  switch (rule.tipo) {
    case 'nxm':
      return `${String(rule.lleva)}x${String(rule.paga)}`;
    case 'porcentaje':
      return `${Number(rule.porcentaje).toLocaleString('es-AR')} %`;
    case 'precio_cantidad':
      return `${String(rule.cantidad)} por ${formatMoney(rule.precio)}`;
  }
}
