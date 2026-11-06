// Rutas HTTP de clientes, cuenta corriente y simulador de la pasarela. El contrato está en
// packages/contracts/openapi.yaml.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import { availableCredit, FISCAL_CONDITIONS } from '../dominio/customers.js';
import type {
  CollectAccount,
  CollectionView,
  ListPendingCollections,
  ResolveCollection,
} from '../aplicacion/collections.js';
import type {
  CreateCustomer,
  DeactivateCustomer,
  ListCustomers,
  SetCreditLimit,
  UpdateCustomer,
} from '../aplicacion/customers.js';
import type { Customer, SimulatorMode } from '../aplicacion/ports.js';
import type { GatewaySimulator } from './gateway-simulator.js';

export interface CollectionUseCases {
  listCustomers: ListCustomers;
  createCustomer: CreateCustomer;
  updateCustomer: UpdateCustomer;
  setCreditLimit: SetCreditLimit;
  deactivateCustomer: DeactivateCustomer;
  collectAccount: CollectAccount;
  listPendingCollections: ListPendingCollections;
  resolveCollection: ResolveCollection;
}

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ incluirInactivos: z.enum(['true', 'false']).optional() });
const customerBody = z
  .object({
    razonSocial: z.string().max(200),
    documento: z.string().max(40).nullable().optional(),
    condicionFiscal: z.enum(FISCAL_CONDITIONS),
  })
  .strict();
const creditBody = z.object({ cuentaCorriente: z.boolean(), limite: z.string().max(20) }).strict();
const collectBody = z
  .object({
    metodoPagoId: z.uuid(),
    monto: z.string().max(20),
    entregado: z.string().max(20).nullable().optional(),
    claveIdempotencia: z.uuid(),
  })
  .strict();
const resolveBody = z
  .object({ resultado: z.enum(['aprobado', 'rechazado']), autorizacionId: z.uuid() })
  .strict();
const simulatorBody = z
  .object({ modo: z.enum(['aprobar', 'rechazar', 'no_responder', 'aprobar_tarde']) })
  .strict();

export const customerDto = (c: Customer) => ({
  id: c.id,
  razonSocial: c.name,
  documento: c.document,
  condicionFiscal: c.fiscalCondition,
  cuentaCorriente: c.hasAccount,
  limiteCredito: c.creditLimit,
  saldo: c.balance,
  disponible: availableCredit(c.creditLimit, c.balance),
  activo: c.isActive,
});

const collectionDto = (v: CollectionView) => ({
  id: v.collection.id,
  clienteId: v.collection.customerId,
  cliente: v.collection.customerName,
  monto: v.collection.amount,
  estado: v.collection.state,
  pagoId: v.payment.id,
  metodo: v.payment.methodName,
  recargo: v.payment.adjustment,
  entregado: v.payment.tendered,
  vuelto: v.payment.change,
  saldoCliente: v.balance,
  resolucionManual: v.manualResolution,
  recibo: v.receipt && {
    numero: v.receipt.number,
    monto: v.receipt.amount,
    emitidoEn: v.receipt.issuedAt.toISOString(),
  },
});

const MANAGE = 'clientes.gestionar' as const;
const COLLECT = 'devoluciones.iniciar' as const;
const SIMULATE = 'simulador.operar' as const;

export function collectionRoutes(useCases: CollectionUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/clientes',
      action: MANAGE,
      handler: async (req, res) => {
        const { incluirInactivos } = parseInput(listQuery, req.query);
        const customers = await useCases.listCustomers.execute(
          securityContextOf(res),
          incluirInactivos === 'true',
        );
        res.json(customers.map(customerDto));
      },
    },
    {
      method: 'post',
      path: '/clientes',
      action: MANAGE,
      handler: async (req, res) => {
        const body = parseInput(customerBody, req.body);
        const customer = await useCases.createCustomer.execute(securityContextOf(res), {
          name: body.razonSocial,
          document: body.documento ?? null,
          fiscalCondition: body.condicionFiscal,
        });
        res.status(201).json(customerDto(customer));
      },
    },
    {
      method: 'put',
      path: '/clientes/:id',
      action: MANAGE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(customerBody, req.body);
        const customer = await useCases.updateCustomer.execute(securityContextOf(res), id, {
          name: body.razonSocial,
          document: body.documento ?? null,
          fiscalCondition: body.condicionFiscal,
        });
        res.json(customerDto(customer));
      },
    },
    {
      method: 'put',
      path: '/clientes/:id/credito',
      action: MANAGE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(creditBody, req.body);
        const customer = await useCases.setCreditLimit.execute(securityContextOf(res), id, {
          hasAccount: body.cuentaCorriente,
          limit: body.limite,
        });
        res.json(customerDto(customer));
      },
    },
    {
      method: 'post',
      path: '/clientes/:id/baja',
      action: MANAGE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivateCustomer.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'post',
      path: '/clientes/:id/cobros',
      action: COLLECT,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(collectBody, req.body);
        const view = await useCases.collectAccount.execute(securityContextOf(res), id, {
          methodId: body.metodoPagoId,
          amount: body.monto,
          tendered: body.entregado ?? null,
          key: body.claveIdempotencia,
        });
        res.status(201).json(collectionDto(view));
      },
    },
    {
      method: 'get',
      path: '/cuenta-corriente/cobros',
      action: COLLECT,
      handler: async (_req, res) => {
        const pending = await useCases.listPendingCollections.execute(securityContextOf(res));
        res.json(pending.map(collectionDto));
      },
    },
    {
      method: 'post',
      path: '/cuenta-corriente/cobros/:id/resolucion',
      action: COLLECT,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(resolveBody, req.body);
        const view = await useCases.resolveCollection.execute(securityContextOf(res), id, {
          result: body.resultado,
          authorizationId: body.autorizacionId,
        });
        res.json(collectionDto(view));
      },
    },
  ];
}

// Control del simulador: solo se registra fuera de producción.
export function simulatorRoutes(simulator: GatewaySimulator, access: AccessControl): HttpRoute[] {
  const mode = (value: SimulatorMode) => ({ modo: value });
  return [
    {
      method: 'get',
      path: '/simulador/pasarela',
      action: SIMULATE,
      handler: async (_req, res) => {
        const tenantId = access.requireTenant(securityContextOf(res));
        res.json(mode(await simulator.mode(tenantId)));
      },
    },
    {
      method: 'put',
      path: '/simulador/pasarela',
      action: SIMULATE,
      handler: async (req, res) => {
        const tenantId = access.requireTenant(securityContextOf(res));
        const body = parseInput(simulatorBody, req.body);
        await simulator.setMode(tenantId, body.modo);
        res.json(mode(body.modo));
      },
    },
  ];
}
