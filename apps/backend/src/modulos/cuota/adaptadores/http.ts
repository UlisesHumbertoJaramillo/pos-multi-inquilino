// Rutas HTTP de la cuota de descuento. El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type {
  GetDiscountCap,
  ListSellerQuotas,
  QuotaLimits,
  SellerQuota,
  SetDiscountCap,
  SetSellerQuota,
} from '../aplicacion/quotas.js';

export interface QuotaUseCases {
  getCap: GetDiscountCap;
  setCap: SetDiscountCap;
  listSellerQuotas: ListSellerQuotas;
  setSellerQuota: SetSellerQuota;
}

const decimal = z.string().max(20);
const capBody = z.object({ porcentajeMaximo: decimal, montoMaximo: decimal }).strict();
const quotaBody = z.object({ porcentajeMaximo: decimal, monto: decimal }).strict();
const branchParams = z.object({ id: z.uuid() });
const sellerParams = z.object({ id: z.uuid(), usuarioId: z.uuid() });

const capDto = (cap: QuotaLimits) => ({
  porcentajeMaximo: cap.percent,
  montoMaximo: cap.amount,
});

const sellerDto = (seller: SellerQuota) => ({
  usuarioId: seller.id,
  nombre: seller.name,
  email: seller.email,
  porcentajeMaximo: seller.limits.percent,
  monto: seller.limits.amount,
  asignada: seller.assigned,
  saldo: seller.balance && {
    fechaJornada: seller.balance.journeyDate,
    saldo: seller.balance.balance,
  },
});

const CAP = 'cuota.tope.gestionar' as const;
const SELLER_QUOTAS = 'clientes.gestionar' as const;

export function quotaRoutes(useCases: QuotaUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/cuota/tope',
      action: CAP,
      handler: async (_req, res) => {
        res.json(capDto(await useCases.getCap.execute(securityContextOf(res))));
      },
    },
    {
      method: 'put',
      path: '/cuota/tope',
      action: CAP,
      handler: async (req, res) => {
        const body = parseInput(capBody, req.body);
        const result = await useCases.setCap.execute(securityContextOf(res), {
          percent: body.porcentajeMaximo,
          amount: body.montoMaximo,
        });
        res.json({ tope: capDto(result.cap), cuotasRecortadas: result.clamped });
      },
    },
    {
      method: 'get',
      path: '/cuota/sucursales/:id/vendedores',
      action: SELLER_QUOTAS,
      handler: async (req, res) => {
        const { id } = parseInput(branchParams, req.params);
        const result = await useCases.listSellerQuotas.execute(securityContextOf(res), id);
        res.json({ tope: capDto(result.cap), vendedores: result.sellers.map(sellerDto) });
      },
    },
    {
      method: 'put',
      path: '/cuota/sucursales/:id/vendedores/:usuarioId',
      action: SELLER_QUOTAS,
      handler: async (req, res) => {
        const { id, usuarioId } = parseInput(sellerParams, req.params);
        const body = parseInput(quotaBody, req.body);
        const seller = await useCases.setSellerQuota.execute(
          securityContextOf(res),
          id,
          usuarioId,
          {
            percent: body.porcentajeMaximo,
            amount: body.monto,
          },
        );
        res.json(sellerDto(seller));
      },
    },
  ];
}
