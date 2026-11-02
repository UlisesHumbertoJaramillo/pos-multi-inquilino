// Rutas HTTP del módulo de plataforma. El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type { Tenant } from '../dominio/tenant.js';
import type { CreateFirstTenantAdmin, CreatePlatformAdmin } from '../aplicacion/accounts.js';
import type { GetTechnicalPanel, QueryTechnicalAudit } from '../aplicacion/monitoring.js';
import type { Ticket } from '../aplicacion/ports.js';
import type {
  CloseTicket,
  CreateTicket,
  GetTenantTicket,
  GetTicketForSupport,
  ListAllTickets,
  ListTenantTickets,
  ReplyTicket,
  TicketDetail,
} from '../aplicacion/support.js';
import type {
  CloseTenant,
  CreateTenant,
  GetTenant,
  ListTenants,
  ReactivateTenant,
  SetTenantBillingModule,
  SuspendTenant,
  UpdateTenant,
} from '../aplicacion/tenants.js';

export interface PlatformUseCases {
  createTenant: CreateTenant;
  listTenants: ListTenants;
  getTenant: GetTenant;
  updateTenant: UpdateTenant;
  suspendTenant: SuspendTenant;
  reactivateTenant: ReactivateTenant;
  closeTenant: CloseTenant;
  setBillingModule: SetTenantBillingModule;
  createPlatformAdmin: CreatePlatformAdmin;
  createFirstTenantAdmin: CreateFirstTenantAdmin;
  createTicket: CreateTicket;
  listTenantTickets: ListTenantTickets;
  getTenantTicket: GetTenantTicket;
  listAllTickets: ListAllTickets;
  getTicketForSupport: GetTicketForSupport;
  replyTicket: ReplyTicket;
  closeTicket: CloseTicket;
  queryTechnicalAudit: QueryTechnicalAudit;
  technicalPanel: GetTechnicalPanel;
}

const idParams = z.object({ id: z.uuid() });
const text = (max: number) => z.string().max(max);
const createTenantBody = z
  .object({
    nombre: text(200),
    cuit: z.string().max(20).nullable().optional(),
    moneda: z.string().max(3),
    zonaHoraria: z.string().max(64),
  })
  .strict();
const updateTenantBody = createTenantBody.partial().strict();
const billingBody = z.object({ activo: z.boolean() }).strict();
const accountBody = z
  .object({ email: z.string().trim().max(254).pipe(z.email()), nombre: text(120) })
  .strict();
const ticketBody = z.object({ asunto: text(400), mensaje: text(8000) }).strict();
const replyBody = z.object({ texto: text(8000) }).strict();
const ticketsQuery = z.object({ estado: z.enum(['abierto', 'respondido', 'cerrado']).optional() });
const auditQuery = z.object({
  desde: z.iso.datetime({ offset: true }).optional(),
  hasta: z.iso.datetime({ offset: true }).optional(),
  tipo: z.string().max(64).optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
});

function tenantDto(tenant: Tenant) {
  return {
    id: tenant.id,
    nombre: tenant.name,
    cuit: tenant.cuit,
    moneda: tenant.currency,
    zonaHoraria: tenant.timezone,
    estado: tenant.status,
    tieneOperaciones: tenant.hasOperations,
    moduloFacturacion: tenant.billingModule,
    creadoEn: tenant.createdAt.toISOString(),
  };
}

function ticketDto(ticket: Ticket) {
  return {
    id: ticket.id,
    comercioId: ticket.tenantId,
    comercioNombre: ticket.tenantName,
    asunto: ticket.subject,
    estado: ticket.status,
    creadoEn: ticket.createdAt.toISOString(),
    actualizadoEn: ticket.updatedAt.toISOString(),
  };
}

function ticketDetailDto(ticket: TicketDetail) {
  return {
    ...ticketDto(ticket),
    mensajes: ticket.messages.map((m) => ({
      id: m.id,
      deSoporte: m.fromSupport,
      texto: m.text,
      creadoEn: m.createdAt.toISOString(),
    })),
  };
}

export function platformRoutes(useCases: PlatformUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/plataforma/comercios',
      action: 'plataforma.comercios.gestionar',
      handler: async (_req, res) => {
        const tenants = await useCases.listTenants.execute(securityContextOf(res));
        res.json(tenants.map(tenantDto));
      },
    },
    {
      method: 'post',
      path: '/plataforma/comercios',
      action: 'plataforma.comercios.gestionar',
      handler: async (req, res) => {
        const body = parseInput(createTenantBody, req.body);
        const tenant = await useCases.createTenant.execute(securityContextOf(res), {
          name: body.nombre,
          cuit: body.cuit ?? null,
          currency: body.moneda,
          timezone: body.zonaHoraria,
        });
        res.status(201).json(tenantDto(tenant));
      },
    },
    {
      method: 'get',
      path: '/plataforma/comercios/:id',
      action: 'plataforma.comercios.gestionar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(tenantDto(await useCases.getTenant.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'patch',
      path: '/plataforma/comercios/:id',
      action: 'plataforma.comercios.gestionar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(updateTenantBody, req.body);
        const tenant = await useCases.updateTenant.execute(securityContextOf(res), id, {
          ...(body.nombre === undefined ? {} : { name: body.nombre }),
          ...(body.cuit === undefined ? {} : { cuit: body.cuit }),
          ...(body.moneda === undefined ? {} : { currency: body.moneda }),
          ...(body.zonaHoraria === undefined ? {} : { timezone: body.zonaHoraria }),
        });
        res.json(tenantDto(tenant));
      },
    },
    {
      method: 'post',
      path: '/plataforma/comercios/:id/suspension',
      action: 'plataforma.comercios.gestionar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(tenantDto(await useCases.suspendTenant.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'post',
      path: '/plataforma/comercios/:id/reactivacion',
      action: 'plataforma.comercios.gestionar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(tenantDto(await useCases.reactivateTenant.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'post',
      path: '/plataforma/comercios/:id/baja',
      action: 'plataforma.comercios.gestionar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(tenantDto(await useCases.closeTenant.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'put',
      path: '/plataforma/comercios/:id/modulo-facturacion',
      action: 'plataforma.facturacion.modulo',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const { activo } = parseInput(billingBody, req.body);
        const tenant = await useCases.setBillingModule.execute(securityContextOf(res), id, activo);
        res.json(tenantDto(tenant));
      },
    },
    {
      method: 'post',
      path: '/plataforma/comercios/:id/administrador',
      action: 'plataforma.usuarios.crear',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(accountBody, req.body);
        const { userId } = await useCases.createFirstTenantAdmin.execute(
          securityContextOf(res),
          id,
          {
            email: body.email,
            name: body.nombre,
          },
        );
        res.status(201).json({ usuarioId: userId, email: body.email.toLowerCase() });
      },
    },
    {
      method: 'post',
      path: '/plataforma/administradores',
      action: 'plataforma.usuarios.crear',
      handler: async (req, res) => {
        const body = parseInput(accountBody, req.body);
        const { userId } = await useCases.createPlatformAdmin.execute(securityContextOf(res), {
          email: body.email,
          name: body.nombre,
        });
        res.status(201).json({ usuarioId: userId, email: body.email.toLowerCase() });
      },
    },
    {
      method: 'get',
      path: '/plataforma/tickets',
      action: 'plataforma.auditoria_tecnica.consultar',
      handler: async (req, res) => {
        const { estado } = parseInput(ticketsQuery, req.query);
        const tickets = await useCases.listAllTickets.execute(securityContextOf(res), estado);
        res.json(tickets.map(ticketDto));
      },
    },
    {
      method: 'get',
      path: '/plataforma/tickets/:id',
      action: 'plataforma.auditoria_tecnica.consultar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(
          ticketDetailDto(await useCases.getTicketForSupport.execute(securityContextOf(res), id)),
        );
      },
    },
    {
      method: 'post',
      path: '/plataforma/tickets/:id/respuestas',
      action: 'plataforma.auditoria_tecnica.consultar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const { texto } = parseInput(replyBody, req.body);
        res.json(
          ticketDetailDto(await useCases.replyTicket.execute(securityContextOf(res), id, texto)),
        );
      },
    },
    {
      method: 'post',
      path: '/plataforma/tickets/:id/cierre',
      action: 'plataforma.auditoria_tecnica.consultar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(ticketDetailDto(await useCases.closeTicket.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'get',
      path: '/plataforma/auditoria-tecnica',
      action: 'plataforma.auditoria_tecnica.consultar',
      handler: async (req, res) => {
        const query = parseInput(auditQuery, req.query);
        const entries = await useCases.queryTechnicalAudit.execute(securityContextOf(res), {
          ...(query.desde === undefined ? {} : { from: new Date(query.desde) }),
          ...(query.hasta === undefined ? {} : { to: new Date(query.hasta) }),
          ...(query.tipo === undefined ? {} : { type: query.tipo }),
          ...(query.limite === undefined ? {} : { limit: query.limite }),
        });
        res.json(
          entries.map((e) => ({
            id: e.id,
            momento: e.at.toISOString(),
            tipoEvento: e.type,
            actorId: e.actorId,
            comercioId: e.tenantId,
            ip: e.ip,
            detalle: e.detail,
          })),
        );
      },
    },
    {
      method: 'get',
      path: '/plataforma/panel',
      action: 'plataforma.auditoria_tecnica.consultar',
      handler: async (_req, res) => {
        const panel = await useCases.technicalPanel.execute(securityContextOf(res));
        res.json({
          erroresRecientes: panel.recentErrors.map((e) => ({
            momento: e.at.toISOString(),
            metodo: e.method,
            ruta: e.path,
            error: e.error,
          })),
          trabajos: {
            pendientes: panel.jobs.pending,
            enCurso: panel.jobs.running,
            fallidos: panel.jobs.failed,
          },
          outbox: {
            pendientes: panel.outbox.pending,
            conErrores: panel.outbox.withErrors,
            pendienteMasAntiguo: panel.outbox.oldestPendingAt?.toISOString() ?? null,
          },
        });
      },
    },
    // Lado del comercio: el AC y el AS envían y consultan sus tickets.
    {
      method: 'post',
      path: '/soporte/tickets',
      action: 'soporte.tickets.enviar',
      handler: async (req, res) => {
        const body = parseInput(ticketBody, req.body);
        const ticket = await useCases.createTicket.execute(securityContextOf(res), {
          subject: body.asunto,
          message: body.mensaje,
        });
        res.status(201).json(ticketDetailDto(ticket));
      },
    },
    {
      method: 'get',
      path: '/soporte/tickets',
      action: 'soporte.tickets.enviar',
      handler: async (_req, res) => {
        const tickets = await useCases.listTenantTickets.execute(securityContextOf(res));
        res.json(tickets.map(ticketDto));
      },
    },
    {
      method: 'get',
      path: '/soporte/tickets/:id',
      action: 'soporte.tickets.enviar',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(
          ticketDetailDto(await useCases.getTenantTicket.execute(securityContextOf(res), id)),
        );
      },
    },
  ];
}
