// Rutas HTTP del módulo de identidad. El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import {
  clientIp,
  securityContextOf,
} from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import { ROLES } from '../../../compartido/dominio/roles.js';
import type { ActivateAccount } from '../aplicacion/accounts.js';
import type {
  ConfirmEmail,
  RequestPasswordReset,
  ResendEmailValidation,
  ResetPassword,
} from '../aplicacion/account-recovery.js';
import type {
  AuthorizeOperation,
  GetAuthorization,
  ListAuthorizers,
  SetAuthorizationPin,
} from '../aplicacion/authorizations.js';
import { AUTHORIZATION_TYPES, type Authorization } from '../aplicacion/ports.js';
import type {
  GetCurrentSession,
  Login,
  Logout,
  RefreshSession,
  SelectActiveRole,
  SessionTokens,
  SessionUser,
} from '../aplicacion/sessions.js';

export interface IdentityUseCases {
  login: Login;
  refresh: RefreshSession;
  logout: Logout;
  selectRole: SelectActiveRole;
  currentSession: GetCurrentSession;
  resendValidation: ResendEmailValidation;
  confirmEmail: ConfirmEmail;
  requestPasswordReset: RequestPasswordReset;
  resetPassword: ResetPassword;
  activateAccount: ActivateAccount;
  setPin: SetAuthorizationPin;
  authorize: AuthorizeOperation;
  getAuthorization: GetAuthorization;
  listAuthorizers: ListAuthorizers;
}

const email = z.string().trim().max(254).pipe(z.email());
const secret = z.string().min(1).max(256);
const opaqueToken = z.string().min(20).max(200);

const loginBody = z.object({ email, contrasena: secret }).strict();
const refreshBody = z.object({ tokenRenovacion: opaqueToken }).strict();
const roleBody = z.object({ rol: z.enum(ROLES) }).strict();
const emailBody = z.object({ email }).strict();
const tokenBody = z.object({ token: opaqueToken }).strict();
const resetBody = z.object({ token: opaqueToken, nuevaContrasena: secret }).strict();
const pinBody = z.object({ pin: z.string().max(20) }).strict();
const authorizersQuery = z.object({ sucursalId: z.uuid() });
const authorizeBody = z
  .object({
    tipo: z.enum(AUTHORIZATION_TYPES),
    operacionRef: z.string().trim().min(1).max(100),
    sucursalId: z.uuid(),
    autorizanteId: z.uuid(),
    pin: z.string().max(20),
  })
  .strict();
const idParams = z.object({ id: z.uuid() });

const RECOVERY_REQUESTED = {
  mensaje: 'Si el correo está registrado, te enviamos un enlace. Revisá tu bandeja de entrada.',
};

function userDto(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    nombre: user.name,
    comercioId: user.tenantId,
    roles: user.roles,
    rolActivo: user.activeRole,
    sucursales: user.branchIds,
    moduloFacturacion: user.billingModule,
    nombreComercio: user.tenantName,
    detalleSucursales: user.branches.map((b) => ({ id: b.id, nombre: b.name })),
  };
}

function sessionDto(tokens: SessionTokens) {
  return {
    tokenAcceso: tokens.accessToken,
    tokenAccesoVenceEn: tokens.accessTokenExpiresAt.toISOString(),
    tokenRenovacion: tokens.refreshToken,
    sesionVenceEn: tokens.sessionExpiresAt.toISOString(),
    usuario: userDto(tokens.user),
    requiereElegirRol: tokens.requiresRoleSelection,
  };
}

function authorizationDto(authorization: Authorization) {
  return {
    id: authorization.id,
    tipo: authorization.type,
    operacionRef: authorization.operationRef,
    sucursalId: authorization.branchId,
    solicitanteId: authorization.requesterId,
    autorizanteId: authorization.authorizerId,
    emitidaEn: authorization.issuedAt.toISOString(),
    usada: authorization.usedAt !== null,
  };
}

export function identityRoutes(useCases: IdentityUseCases): HttpRoute[] {
  return [
    {
      method: 'post',
      path: '/auth/login',
      public: 'inicio_sesion',
      handler: async (req, res) => {
        const body = parseInput(loginBody, req.body);
        const tokens = await useCases.login.execute({
          email: body.email,
          password: body.contrasena,
          ip: clientIp(req),
        });
        res.json(sessionDto(tokens));
      },
    },
    {
      method: 'post',
      path: '/auth/renovar',
      public: 'inicio_sesion',
      handler: async (req, res) => {
        const body = parseInput(refreshBody, req.body);
        const tokens = await useCases.refresh.execute({
          refreshToken: body.tokenRenovacion,
          ip: clientIp(req),
        });
        res.json(sessionDto(tokens));
      },
    },
    {
      method: 'post',
      path: '/auth/cerrar-sesion',
      handler: async (_req, res) => {
        await useCases.logout.execute(securityContextOf(res));
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/auth/sesion',
      handler: async (_req, res) => {
        res.json(userDto(await useCases.currentSession.execute(securityContextOf(res))));
      },
    },
    {
      method: 'put',
      path: '/auth/rol-activo',
      handler: async (req, res) => {
        const body = parseInput(roleBody, req.body);
        const result = await useCases.selectRole.execute(securityContextOf(res), body.rol);
        res.json({
          tokenAcceso: result.accessToken,
          tokenAccesoVenceEn: result.accessTokenExpiresAt.toISOString(),
          usuario: userDto(result.user),
        });
      },
    },
    {
      method: 'post',
      path: '/auth/validacion/reenviar',
      public: 'validacion_correo',
      handler: async (req, res) => {
        await useCases.resendValidation.execute(parseInput(emailBody, req.body));
        res.status(202).json({
          mensaje:
            'Si la cuenta existe y falta validarla, te enviamos un nuevo correo de validación.',
        });
      },
    },
    {
      method: 'post',
      path: '/auth/validacion/confirmar',
      public: 'validacion_correo',
      handler: async (req, res) => {
        await useCases.confirmEmail.execute(parseInput(tokenBody, req.body));
        res.json({ mensaje: 'Tu correo quedó validado. Ya podés iniciar sesión.' });
      },
    },
    {
      method: 'post',
      path: '/auth/activacion',
      public: 'validacion_correo',
      handler: async (req, res) => {
        const body = parseInput(resetBody, req.body);
        await useCases.activateAccount.execute({
          token: body.token,
          newPassword: body.nuevaContrasena,
        });
        res.json({ mensaje: 'Tu cuenta quedó activada. Ya podés iniciar sesión.' });
      },
    },
    {
      method: 'post',
      path: '/auth/recuperacion/solicitar',
      public: 'recuperacion_contrasena',
      handler: async (req, res) => {
        await useCases.requestPasswordReset.execute(parseInput(emailBody, req.body));
        res.status(202).json(RECOVERY_REQUESTED);
      },
    },
    {
      method: 'post',
      path: '/auth/recuperacion/restablecer',
      public: 'recuperacion_contrasena',
      handler: async (req, res) => {
        const body = parseInput(resetBody, req.body);
        await useCases.resetPassword.execute({
          token: body.token,
          newPassword: body.nuevaContrasena,
        });
        res.json({ mensaje: 'Tu contraseña cambió. Ya podés iniciar sesión.' });
      },
    },
    {
      method: 'put',
      path: '/auth/pin',
      action: 'autorizaciones.autorizar',
      handler: async (req, res) => {
        const body = parseInput(pinBody, req.body);
        await useCases.setPin.execute(securityContextOf(res), body.pin);
        res.status(204).end();
      },
    },
    {
      method: 'post',
      path: '/autorizaciones',
      handler: async (req, res) => {
        const body = parseInput(authorizeBody, req.body);
        const authorization = await useCases.authorize.execute(securityContextOf(res), {
          type: body.tipo,
          operationRef: body.operacionRef,
          branchId: body.sucursalId,
          authorizerId: body.autorizanteId,
          pin: body.pin,
          ip: clientIp(req),
        });
        res.status(201).json(authorizationDto(authorization));
      },
    },
    {
      // Antes de /autorizaciones/:id, para que "autorizantes" no se tome como un id.
      method: 'get',
      path: '/autorizaciones/autorizantes',
      handler: async (req, res) => {
        const { sucursalId } = parseInput(authorizersQuery, req.query);
        const list = await useCases.listAuthorizers.execute(securityContextOf(res), sucursalId);
        res.json(list.map((a) => ({ id: a.id, nombre: a.name, rol: a.role })));
      },
    },
    {
      method: 'get',
      path: '/autorizaciones/:id',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(
          authorizationDto(await useCases.getAuthorization.execute(securityContextOf(res), id)),
        );
      },
    },
  ];
}
