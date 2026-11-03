// Rutas HTTP del módulo de promociones. El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import { PROMOTION_SCOPES, type PromotionRule } from '../dominio/promotions.js';
import type {
  CreatePromotion,
  DeactivatePromotion,
  ListedPromotion,
  ListPromotions,
  PromotionInput,
  UpdatePromotion,
} from '../aplicacion/promotions.js';

export interface PromotionUseCases {
  listPromotions: ListPromotions;
  createPromotion: CreatePromotion;
  updatePromotion: UpdatePromotion;
  deactivatePromotion: DeactivatePromotion;
}

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ vigentes: z.enum(['true', 'false']).optional() });
const units = z.number().int();
const rule = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('nxm'), lleva: units, paga: units }).strict(),
  z.object({ tipo: z.literal('porcentaje'), porcentaje: z.string().max(20) }).strict(),
  z
    .object({ tipo: z.literal('precio_cantidad'), cantidad: units, precio: z.string().max(20) })
    .strict(),
]);
const promotionBody = z
  .object({
    nombre: z.string().max(200),
    regla: rule,
    alcance: z.enum(PROMOTION_SCOPES),
    objetivoId: z.uuid(),
    vigenteDesde: z.iso.datetime({ offset: true }),
    vigenteHasta: z.iso.datetime({ offset: true }),
    sucursales: z.array(z.uuid()).max(100).nullable(),
  })
  .strict();

const toRule = (r: z.infer<typeof rule>): PromotionRule => {
  switch (r.tipo) {
    case 'nxm':
      return { type: 'nxm', take: r.lleva, pay: r.paga };
    case 'porcentaje':
      return { type: 'porcentaje', percent: r.porcentaje };
    case 'precio_cantidad':
      return { type: 'precio_cantidad', quantity: r.cantidad, price: r.precio };
  }
};

const ruleDto = (r: PromotionRule) => {
  switch (r.type) {
    case 'nxm':
      return { tipo: r.type, lleva: r.take, paga: r.pay };
    case 'porcentaje':
      return { tipo: r.type, porcentaje: r.percent };
    case 'precio_cantidad':
      return { tipo: r.type, cantidad: r.quantity, precio: r.price };
  }
};

const promotionDto = (p: ListedPromotion) => ({
  id: p.id,
  nombre: p.name,
  regla: ruleDto(p.rule),
  alcance: p.scope,
  objetivo: { id: p.targetId, nombre: p.targetName },
  vigenteDesde: p.validFrom.toISOString(),
  vigenteHasta: p.validUntil.toISOString(),
  sucursales: p.branchIds,
  activa: p.isActive,
  vigente: p.current,
});

type Body = z.infer<typeof promotionBody>;

const fullInput = (body: Body): PromotionInput => ({
  name: body.nombre,
  rule: toRule(body.regla),
  scope: body.alcance,
  targetId: body.objetivoId,
  validFrom: new Date(body.vigenteDesde),
  validUntil: new Date(body.vigenteHasta),
  branchIds: body.sucursales,
});

function toInput(body: { [K in keyof Body]?: Body[K] | undefined }): Partial<PromotionInput> {
  return {
    ...(body.nombre === undefined ? {} : { name: body.nombre }),
    ...(body.regla === undefined ? {} : { rule: toRule(body.regla) }),
    ...(body.alcance === undefined ? {} : { scope: body.alcance }),
    ...(body.objetivoId === undefined ? {} : { targetId: body.objetivoId }),
    ...(body.vigenteDesde === undefined ? {} : { validFrom: new Date(body.vigenteDesde) }),
    ...(body.vigenteHasta === undefined ? {} : { validUntil: new Date(body.vigenteHasta) }),
    ...(body.sucursales === undefined ? {} : { branchIds: body.sucursales }),
  };
}

const CATALOG = 'catalogo.gestionar' as const;

export function promotionRoutes(useCases: PromotionUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/promociones',
      action: CATALOG,
      handler: async (req, res) => {
        const { vigentes } = parseInput(listQuery, req.query);
        const list = await useCases.listPromotions.execute(
          securityContextOf(res),
          vigentes === 'true',
        );
        res.json(list.map(promotionDto));
      },
    },
    {
      method: 'post',
      path: '/promociones',
      action: CATALOG,
      handler: async (req, res) => {
        const body = parseInput(promotionBody, req.body);
        const promotion = await useCases.createPromotion.execute(
          securityContextOf(res),
          fullInput(body),
        );
        res.status(201).json(promotionDto(promotion));
      },
    },
    {
      method: 'patch',
      path: '/promociones/:id',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(promotionBody.partial().strict(), req.body);
        const promotion = await useCases.updatePromotion.execute(
          securityContextOf(res),
          id,
          toInput(body),
        );
        res.json(promotionDto(promotion));
      },
    },
    {
      method: 'post',
      path: '/promociones/:id/baja',
      action: CATALOG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivatePromotion.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
  ];
}
