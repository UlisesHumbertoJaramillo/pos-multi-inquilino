// Tickets de soporte (T-055, RF-017): el AC y el AS los envían y el SA los sigue y responde.
// Los tickets no llevan datos comerciales adjuntos.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError, notFoundError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import type { Ticket, TicketMessage, TicketRepository, TicketStatus } from './ports.js';

export interface SupportDependencies {
  uow: UnitOfWork;
  tickets: TicketRepository;
  access: AccessControl;
  clock: Clock;
  ids: IdGenerator;
}

export type TicketDetail = Ticket & { messages: TicketMessage[] };

function assertText(text: string, max: number, field: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new DomainError(
      'TEXTO_INVALIDO',
      `${field} tiene que tener entre 1 y ${String(max)} caracteres.`,
    );
  }
  return trimmed;
}

abstract class SupportUseCase {
  constructor(protected readonly deps: SupportDependencies) {}

  protected newMessage(text: string, fromSupport: boolean): TicketMessage {
    return {
      id: this.deps.ids.next(),
      fromSupport,
      text: assertText(text, 4000, 'El mensaje'),
      createdAt: this.deps.clock.now(),
    };
  }
}

// Lado del comercio.
export class CreateTicket extends SupportUseCase {
  async execute(
    context: SecurityContext,
    input: { subject: string; message: string },
  ): Promise<TicketDetail> {
    await this.deps.access.check(context, 'soporte.tickets.enviar');
    const tenantId = this.deps.access.requireTenant(context);
    const now = this.deps.clock.now();
    const ticket = {
      id: this.deps.ids.next(),
      tenantId,
      authorId: context.userId,
      subject: assertText(input.subject, 200, 'El asunto'),
      status: 'abierto' as const,
      createdAt: now,
      updatedAt: now,
    };
    const message = this.newMessage(input.message, false);
    await this.deps.uow.run(() => this.deps.tickets.insert(ticket, message));
    const created = await this.deps.tickets.findById(ticket.id);
    if (!created) throw notFoundError();
    return created;
  }
}

// El AC ve todos los tickets de su comercio; el AS, los que envió.
export class ListTenantTickets extends SupportUseCase {
  async execute(context: SecurityContext): Promise<Ticket[]> {
    await this.deps.access.check(context, 'soporte.tickets.enviar');
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.tickets.listForTenant(
      tenantId,
      context.activeRole === 'AC' ? undefined : context.userId,
    );
  }
}

export class GetTenantTicket extends SupportUseCase {
  async execute(context: SecurityContext, id: string): Promise<TicketDetail> {
    await this.deps.access.check(context, 'soporte.tickets.enviar');
    const tenantId = this.deps.access.requireTenant(context);
    const ticket = await this.deps.tickets.findById(id);
    const visible =
      ticket?.tenantId === tenantId &&
      (context.activeRole === 'AC' || ticket.authorId === context.userId);
    // Un ticket de otro comercio se responde igual que uno inexistente (RF-002).
    if (!visible) throw notFoundError();
    return ticket;
  }
}

// Lado del SA.
export class ListAllTickets extends SupportUseCase {
  async execute(context: SecurityContext, status?: TicketStatus): Promise<Ticket[]> {
    await this.deps.access.check(context, 'plataforma.auditoria_tecnica.consultar');
    return this.deps.tickets.listAll(status);
  }
}

export class GetTicketForSupport extends SupportUseCase {
  async execute(context: SecurityContext, id: string): Promise<TicketDetail> {
    await this.deps.access.check(context, 'plataforma.auditoria_tecnica.consultar');
    const ticket = await this.deps.tickets.findById(id);
    if (!ticket) throw notFoundError();
    return ticket;
  }
}

export class ReplyTicket extends SupportUseCase {
  async execute(context: SecurityContext, id: string, text: string): Promise<TicketDetail> {
    await this.deps.access.check(context, 'plataforma.auditoria_tecnica.consultar');
    const message = this.newMessage(text, true);
    await this.deps.uow.run(async () => {
      const ticket = await this.deps.tickets.findById(id);
      if (!ticket) throw notFoundError();
      if (ticket.status === 'cerrado') {
        throw new ApplicationError('conflict', 'TICKET_CERRADO', 'El ticket está cerrado.');
      }
      await this.deps.tickets.addMessage(id, context.userId, message);
      await this.deps.tickets.setStatus(id, 'respondido', message.createdAt);
    });
    const updated = await this.deps.tickets.findById(id);
    if (!updated) throw notFoundError();
    return updated;
  }
}

export class CloseTicket extends SupportUseCase {
  async execute(context: SecurityContext, id: string): Promise<TicketDetail> {
    await this.deps.access.check(context, 'plataforma.auditoria_tecnica.consultar');
    await this.deps.uow.run(async () => {
      if (!(await this.deps.tickets.findById(id))) throw notFoundError();
      await this.deps.tickets.setStatus(id, 'cerrado', this.deps.clock.now());
    });
    const updated = await this.deps.tickets.findById(id);
    if (!updated) throw notFoundError();
    return updated;
  }
}
