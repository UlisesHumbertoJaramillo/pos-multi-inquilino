// Rutas HTTP del módulo fiscal. El contrato está en packages/contracts/openapi.yaml. Ninguna
// respuesta incluye el certificado ni su clave (RF-162).
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import { ISSUER_CONDITIONS } from '../dominio/vouchers.js';
import type {
  FiscalConfiguration,
  GetFiscalConfiguration,
  InvoiceLater,
  ListVouchers,
  ResendVoucher,
  SaveFiscalCredential,
} from '../aplicacion/fiscal.js';
import type { FiscalAlert, VoucherRow } from '../aplicacion/ports.js';
import type { FiscalSimulator } from './fiscal-simulator.js';

export interface FiscalUseCases {
  getConfiguration: GetFiscalConfiguration;
  saveCredential: SaveFiscalCredential;
  listVouchers: ListVouchers;
  resendVoucher: ResendVoucher;
  invoiceLater: InvoiceLater;
}

const idParams = z.object({ id: z.uuid() });
const credentialBody = z
  .object({
    cuit: z.string().max(20),
    condicionFiscal: z.enum(ISSUER_CONDITIONS),
    certificado: z.string().min(1).max(20_000),
    clave: z.string().min(1).max(20_000),
  })
  .strict();
const laterBody = z.object({ numeroTicket: z.number().int().positive() }).strict();
const simulatorBody = z.object({ modo: z.enum(['acepta', 'rechaza', 'caido']) }).strict();

const configurationDto = (c: FiscalConfiguration) => ({
  cuit: c.cuit,
  condicionFiscal: c.condition,
  certificadoVenceEn: c.expiresAt?.toISOString() ?? null,
});

const voucherDto = (v: VoucherRow) => ({
  id: v.id,
  tipo: v.type,
  clase: v.voucherClass,
  ventaId: v.saleId,
  numeroTicket: v.ticket,
  puntoVenta: v.pointOfSale,
  numero: v.number,
  total: v.total,
  comprador: v.buyer.name,
  estado: v.state,
  contingencia: v.contingency,
  noFiscal: v.nonFiscal,
  cae: v.cae,
  caea: v.caeaCode,
  motivoRechazo: v.rejection,
  intentos: v.attempts,
  emitidoEn: v.issuedAt.toISOString(),
  plazoVence: v.deadline.toISOString(),
});

const alertDto = (a: FiscalAlert) => ({
  id: a.id,
  tipo: a.type,
  severidad: a.severity,
  detalle: a.detail,
  creadaEn: a.createdAt.toISOString(),
});

const CONFIGURE = 'facturacion.configurar' as const;
const REVIEW = 'facturacion.corregir_rechazos' as const;

export function fiscalRoutes(useCases: FiscalUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/fiscal/configuracion',
      action: CONFIGURE,
      handler: async (_req, res) => {
        res.json(configurationDto(await useCases.getConfiguration.execute(securityContextOf(res))));
      },
    },
    {
      method: 'put',
      path: '/fiscal/credencial',
      action: CONFIGURE,
      handler: async (req, res) => {
        const body = parseInput(credentialBody, req.body);
        const saved = await useCases.saveCredential.execute(securityContextOf(res), {
          cuit: body.cuit,
          condition: body.condicionFiscal,
          certificate: body.certificado,
          key: body.clave,
        });
        res.json(configurationDto(saved));
      },
    },
    {
      method: 'get',
      path: '/fiscal/comprobantes',
      action: REVIEW,
      handler: async (_req, res) => {
        const { vouchers, alerts } = await useCases.listVouchers.execute(securityContextOf(res));
        res.json({ comprobantes: vouchers.map(voucherDto), alertas: alerts.map(alertDto) });
      },
    },
    {
      method: 'post',
      path: '/fiscal/comprobantes/:id/reenvio',
      action: REVIEW,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(voucherDto(await useCases.resendVoucher.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'post',
      path: '/fiscal/facturacion-posterior',
      action: 'facturacion.facturar_posterior',
      handler: async (req, res) => {
        const body = parseInput(laterBody, req.body);
        await useCases.invoiceLater.execute(securityContextOf(res), body.numeroTicket);
        res.status(202).end();
      },
    },
  ];
}

export function fiscalSimulatorRoutes(
  simulator: FiscalSimulator,
  access: AccessControl,
): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/simulador/fiscal',
      action: 'simulador.operar',
      handler: async (_req, res) => {
        const tenantId = access.requireTenant(securityContextOf(res));
        res.json({ modo: await simulator.mode(tenantId) });
      },
    },
    {
      method: 'put',
      path: '/simulador/fiscal',
      action: 'simulador.operar',
      handler: async (req, res) => {
        const tenantId = access.requireTenant(securityContextOf(res));
        const body = parseInput(simulatorBody, req.body);
        await simulator.setMode(tenantId, body.modo);
        res.json({ modo: body.modo });
      },
    },
  ];
}
