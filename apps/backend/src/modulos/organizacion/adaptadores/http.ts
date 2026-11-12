// Rutas HTTP del módulo de organización. El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import { BILLING_POLICIES, type TenantParameters } from '../dominio/parameters.js';
import {
  ASSIGNABLE_KEYS,
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  SHORTCUT_NAMES,
} from '../dominio/shortcuts.js';
import type {
  GetPosShortcuts,
  GetShortcutSettings,
  ResetShortcuts,
  ShortcutSettings,
  UpdateShortcuts,
} from '../aplicacion/shortcuts.js';
import { PAYMENT_TYPES, type PaymentMethod } from '../dominio/payment-methods.js';
import type { Branch, Register } from '../dominio/structure.js';
import type { TenantUser } from '../aplicacion/ports.js';
import type {
  CreatePaymentMethod,
  DeactivatePaymentMethod,
  GetParameters,
  ListPaymentMethods,
  UpdateParameters,
  UpdatePaymentMethod,
} from '../aplicacion/settings.js';
import type {
  CreateBranch,
  CreateRegister,
  DeactivateBranch,
  DeactivateRegister,
  GetStructure,
  Structure,
  UpdateBranch,
  UpdateRegister,
} from '../aplicacion/structure.js';
import type {
  ChangeUserRoles,
  CreateTenantUser,
  DeactivateTenantUser,
  ListTenantUsers,
} from '../aplicacion/users.js';

export interface OrganizationUseCases {
  getStructure: GetStructure;
  createBranch: CreateBranch;
  updateBranch: UpdateBranch;
  deactivateBranch: DeactivateBranch;
  createRegister: CreateRegister;
  updateRegister: UpdateRegister;
  deactivateRegister: DeactivateRegister;
  listUsers: ListTenantUsers;
  createUser: CreateTenantUser;
  changeUserRoles: ChangeUserRoles;
  deactivateUser: DeactivateTenantUser;
  getParameters: GetParameters;
  updateParameters: UpdateParameters;
  listPaymentMethods: ListPaymentMethods;
  createPaymentMethod: CreatePaymentMethod;
  updatePaymentMethod: UpdatePaymentMethod;
  deactivatePaymentMethod: DeactivatePaymentMethod;
  getPosShortcuts: GetPosShortcuts;
  getShortcutSettings: GetShortcutSettings;
  updateShortcuts: UpdateShortcuts;
  resetShortcuts: ResetShortcuts;
}

const idParams = z.object({ id: z.uuid() });
const includeQuery = z.object({ incluirBajas: z.enum(['true', 'false']).optional() });
const branchBody = z
  .object({ nombre: z.string().max(200), direccion: z.string().max(400).nullable().optional() })
  .strict();
const branchPatch = branchBody.partial().strict();
const registerBody = z
  .object({ nombre: z.string().max(120), puntoVentaFiscal: z.number().int().nullable().optional() })
  .strict();
const registerPatch = registerBody.partial().strict();
const roleItem = z
  .object({ rol: z.enum(['SA', 'AC', 'AS', 'VO']), sucursalId: z.uuid().nullable() })
  .strict();
const userBody = z
  .object({
    email: z.string().trim().max(254).pipe(z.email()),
    nombre: z.string().max(120),
    roles: z.array(roleItem).max(20),
  })
  .strict();
const rolesBody = z.object({ roles: z.array(roleItem).max(20) }).strict();
const parametersPatch = z
  .object({
    inactividadCarritoMin: z.number().int(),
    inactividadSesionMin: z.number().int(),
    plazoRegularizacionHoras: z.number().int(),
    plazoDevolucionDias: z.number().int(),
    toleranciaArqueo: z.string().max(20),
    politicaFacturacion: z.enum(BILLING_POLICIES),
    plazoFacturacionPosteriorDias: z.number().int(),
  })
  .partial()
  .strict();
const paymentBody = z
  .object({
    nombre: z.string().max(120),
    tipo: z.enum(PAYMENT_TYPES),
    recargoPct: z.string().max(12),
  })
  .strict();
const paymentPatch = z
  .object({ nombre: z.string().max(120), recargoPct: z.string().max(12) })
  .partial()
  .strict();

const branchDto = (b: Branch) => ({
  id: b.id,
  nombre: b.name,
  direccion: b.address,
  activa: b.isActive,
});
const registerDto = (r: Register) => ({
  id: r.id,
  sucursalId: r.branchId,
  nombre: r.name,
  puntoVentaFiscal: r.fiscalPointOfSale,
  activa: r.isActive,
});
const structureDto = (s: Structure) => ({
  comercio: { id: s.tenantId, nombre: s.tenantName },
  sucursales: s.branches.map((b) => ({ ...branchDto(b), cajas: b.registers.map(registerDto) })),
});
const userDto = (u: TenantUser) => ({
  id: u.id,
  email: u.email,
  nombre: u.name,
  activo: u.isActive,
  correoValidado: u.emailValidated,
  roles: u.assignments.map((a) => ({ rol: a.role, sucursalId: a.branchId })),
});
const parametersDto = (p: TenantParameters) => ({
  inactividadCarritoMin: p.cartIdleMinutes,
  inactividadSesionMin: p.sessionIdleMinutes,
  plazoRegularizacionHoras: p.fiscalRegularizationHours,
  plazoDevolucionDias: p.returnWindowDays,
  toleranciaArqueo: p.cashCountTolerance,
  politicaFacturacion: p.billingPolicy,
  plazoFacturacionPosteriorDias: p.laterInvoicingDays,
});
const paymentDto = (m: PaymentMethod) => ({
  id: m.id,
  nombre: m.name,
  tipo: m.type,
  recargoPct: m.surchargePct,
  activo: m.isActive,
});

const ORG = 'organizacion.gestionar' as const;
const SETTINGS = 'parametros.gestionar' as const;

const shortcutsBody = z
  .object({ atajos: z.record(z.string().max(40), z.string().max(40).nullable()) })
  .strict();

// Atajos con su nombre, su tecla y la de por defecto, más las teclas que se pueden elegir.
const shortcutsDto = (s: ShortcutSettings) => ({
  porDefecto: s.isDefault,
  atajos: SHORTCUT_ACTIONS.map((action) => ({
    accion: action,
    nombre: SHORTCUT_NAMES[action],
    tecla: s.map[action],
    teclaPorDefecto: DEFAULT_SHORTCUTS[action],
  })),
  teclasPermitidas: [...ASSIGNABLE_KEYS],
});

export function organizationRoutes(useCases: OrganizationUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/organizacion/estructura',
      action: ORG,
      handler: async (req, res) => {
        const { incluirBajas } = parseInput(includeQuery, req.query);
        const structure = await useCases.getStructure.execute(
          securityContextOf(res),
          incluirBajas === 'true',
        );
        res.json(structureDto(structure));
      },
    },
    {
      method: 'post',
      path: '/organizacion/sucursales',
      action: ORG,
      handler: async (req, res) => {
        const body = parseInput(branchBody, req.body);
        const branch = await useCases.createBranch.execute(securityContextOf(res), {
          name: body.nombre,
          address: body.direccion ?? null,
        });
        res.status(201).json(branchDto(branch));
      },
    },
    {
      method: 'patch',
      path: '/organizacion/sucursales/:id',
      action: ORG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(branchPatch, req.body);
        const branch = await useCases.updateBranch.execute(securityContextOf(res), id, {
          ...(body.nombre === undefined ? {} : { name: body.nombre }),
          ...(body.direccion === undefined ? {} : { address: body.direccion }),
        });
        res.json(branchDto(branch));
      },
    },
    {
      method: 'post',
      path: '/organizacion/sucursales/:id/baja',
      action: ORG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivateBranch.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'post',
      path: '/organizacion/sucursales/:id/cajas',
      action: ORG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(registerBody, req.body);
        const register = await useCases.createRegister.execute(securityContextOf(res), id, {
          name: body.nombre,
          fiscalPointOfSale: body.puntoVentaFiscal ?? null,
        });
        res.status(201).json(registerDto(register));
      },
    },
    {
      method: 'patch',
      path: '/organizacion/cajas/:id',
      action: ORG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(registerPatch, req.body);
        const register = await useCases.updateRegister.execute(securityContextOf(res), id, {
          ...(body.nombre === undefined ? {} : { name: body.nombre }),
          ...(body.puntoVentaFiscal === undefined
            ? {}
            : { fiscalPointOfSale: body.puntoVentaFiscal }),
        });
        res.json(registerDto(register));
      },
    },
    {
      method: 'post',
      path: '/organizacion/cajas/:id/baja',
      action: ORG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivateRegister.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/organizacion/usuarios',
      action: ORG,
      handler: async (_req, res) => {
        res.json((await useCases.listUsers.execute(securityContextOf(res))).map(userDto));
      },
    },
    {
      method: 'post',
      path: '/organizacion/usuarios',
      action: ORG,
      handler: async (req, res) => {
        const body = parseInput(userBody, req.body);
        const { userId } = await useCases.createUser.execute(securityContextOf(res), {
          email: body.email,
          name: body.nombre,
          roles: body.roles.map((r) => ({ role: r.rol, branchId: r.sucursalId })),
        });
        res.status(201).json({ usuarioId: userId, email: body.email.toLowerCase() });
      },
    },
    {
      method: 'put',
      path: '/organizacion/usuarios/:id/roles',
      action: ORG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const { roles } = parseInput(rolesBody, req.body);
        const user = await useCases.changeUserRoles.execute(
          securityContextOf(res),
          id,
          roles.map((r) => ({ role: r.rol, branchId: r.sucursalId })),
        );
        res.json(userDto(user));
      },
    },
    {
      method: 'post',
      path: '/organizacion/usuarios/:id/baja',
      action: ORG,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivateUser.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/organizacion/parametros',
      action: SETTINGS,
      handler: async (_req, res) => {
        res.json(parametersDto(await useCases.getParameters.execute(securityContextOf(res))));
      },
    },
    {
      method: 'patch',
      path: '/organizacion/parametros',
      action: SETTINGS,
      handler: async (req, res) => {
        const body = parseInput(parametersPatch, req.body);
        const next = await useCases.updateParameters.execute(securityContextOf(res), {
          ...(body.inactividadCarritoMin === undefined
            ? {}
            : { cartIdleMinutes: body.inactividadCarritoMin }),
          ...(body.inactividadSesionMin === undefined
            ? {}
            : { sessionIdleMinutes: body.inactividadSesionMin }),
          ...(body.plazoRegularizacionHoras === undefined
            ? {}
            : { fiscalRegularizationHours: body.plazoRegularizacionHoras }),
          ...(body.plazoDevolucionDias === undefined
            ? {}
            : { returnWindowDays: body.plazoDevolucionDias }),
          ...(body.toleranciaArqueo === undefined
            ? {}
            : { cashCountTolerance: body.toleranciaArqueo }),
          ...(body.politicaFacturacion === undefined
            ? {}
            : { billingPolicy: body.politicaFacturacion }),
          ...(body.plazoFacturacionPosteriorDias === undefined
            ? {}
            : { laterInvoicingDays: body.plazoFacturacionPosteriorDias }),
        });
        res.json(parametersDto(next));
      },
    },
    {
      method: 'get',
      path: '/organizacion/metodos-pago',
      action: SETTINGS,
      handler: async (req, res) => {
        const { incluirBajas } = parseInput(includeQuery, req.query);
        const methods = await useCases.listPaymentMethods.execute(
          securityContextOf(res),
          incluirBajas === 'true',
        );
        res.json(methods.map(paymentDto));
      },
    },
    {
      method: 'post',
      path: '/organizacion/metodos-pago',
      action: SETTINGS,
      handler: async (req, res) => {
        const body = parseInput(paymentBody, req.body);
        const method = await useCases.createPaymentMethod.execute(securityContextOf(res), {
          name: body.nombre,
          type: body.tipo,
          surchargePct: body.recargoPct,
        });
        res.status(201).json(paymentDto(method));
      },
    },
    {
      method: 'patch',
      path: '/organizacion/metodos-pago/:id',
      action: SETTINGS,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(paymentPatch, req.body);
        const method = await useCases.updatePaymentMethod.execute(securityContextOf(res), id, {
          ...(body.nombre === undefined ? {} : { name: body.nombre }),
          ...(body.recargoPct === undefined ? {} : { surchargePct: body.recargoPct }),
        });
        res.json(paymentDto(method));
      },
    },
    {
      method: 'post',
      path: '/organizacion/metodos-pago/:id/baja',
      action: SETTINGS,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivatePaymentMethod.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      // Los atajos con que opera el POS: los consulta el VO (RF-181).
      method: 'get',
      path: '/atajos',
      action: 'ventas.operar',
      handler: async (_req, res) => {
        res.json(shortcutsDto(await useCases.getPosShortcuts.execute(securityContextOf(res))));
      },
    },
    {
      method: 'get',
      path: '/organizacion/atajos',
      action: SETTINGS,
      handler: async (_req, res) => {
        res.json(shortcutsDto(await useCases.getShortcutSettings.execute(securityContextOf(res))));
      },
    },
    {
      method: 'put',
      path: '/organizacion/atajos',
      action: SETTINGS,
      handler: async (req, res) => {
        const body = parseInput(shortcutsBody, req.body);
        res.json(
          shortcutsDto(await useCases.updateShortcuts.execute(securityContextOf(res), body.atajos)),
        );
      },
    },
    {
      method: 'post',
      path: '/organizacion/atajos/restablecimiento',
      action: SETTINGS,
      handler: async (_req, res) => {
        res.json(shortcutsDto(await useCases.resetShortcuts.execute(securityContextOf(res))));
      },
    },
  ];
}
