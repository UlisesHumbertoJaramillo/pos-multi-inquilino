// Llamadas de la cuota de descuento: tope del comercio (AC) y cuotas de los VO (AS), tipadas con
// el contrato.
import type {
  BranchSellerQuotas,
  DiscountCap,
  DiscountCapResult,
  SellerQuota,
  SellerQuotaRequest,
} from '@pos/contracts';
import type { Request } from './platform';

const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });

const sellers = (branchId: string) => `/cuota/sucursales/${branchId}/vendedores`;

export const quotasApi = (request: Request) => ({
  getCap: () => request<DiscountCap>('/cuota/tope'),
  setCap: (body: DiscountCap) => request<DiscountCapResult>('/cuota/tope', put(body)),
  listSellerQuotas: (branchId: string) => request<BranchSellerQuotas>(sellers(branchId)),
  setSellerQuota: (branchId: string, userId: string, body: SellerQuotaRequest) =>
    request<SellerQuota>(`${sellers(branchId)}/${userId}`, put(body)),
});

// "15.0000" → "15 %".
export const formatPercent = (value: string) => `${Number(value).toLocaleString('es-AR')} %`;
