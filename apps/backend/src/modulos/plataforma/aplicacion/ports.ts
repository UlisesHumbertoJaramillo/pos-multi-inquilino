// Puertos de salida del módulo de plataforma.
import type { Role } from '../../../compartido/dominio/roles.js';
import type { FiscalPending, Tenant } from '../dominio/tenant.js';

export interface TenantRepository {
  insert(tenant: Tenant): Promise<void>;
  findById(id: string): Promise<Tenant | undefined>;
  list(): Promise<Tenant[]>;
  // Guarda el estado del comercio. `by` y `at` quedan como autor y momento del cambio.
  save(tenant: Tenant, by: string, at: Date): Promise<void>;
}

// Puerto ConsultaPendientesFiscales (T-053): comprobantes sin regularizar de un comercio.
// Hasta la Fase 12 responde siempre "sin pendientes".
export interface FiscalPendingQuery {
  pendingFor(tenantId: string): Promise<FiscalPending>;
}

// Lo provee el módulo de identidad.
export interface TenantSessions {
  revokeAllForTenant(tenantId: string, at: Date): Promise<void>;
}

// Lo provee el módulo de identidad: alta de cuentas con activación por correo.
export interface AccountRegistry {
  execute(input: {
    tenantId: string | null;
    email: string;
    name: string;
    roles: { role: Role; branchId: string | null }[];
    createdBy: string;
  }): Promise<{ userId: string }>;
}

export interface TenantRoles {
  tenantHasRole(tenantId: string, role: Role): Promise<boolean>;
}

export type TicketStatus = 'abierto' | 'respondido' | 'cerrado';

export interface TicketMessage {
  id: string;
  fromSupport: boolean;
  text: string;
  createdAt: Date;
}

export interface Ticket {
  id: string;
  tenantId: string;
  tenantName: string;
  authorId: string;
  subject: string;
  status: TicketStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketRepository {
  insert(ticket: Omit<Ticket, 'tenantName'>, firstMessage: TicketMessage): Promise<void>;
  findById(id: string): Promise<(Ticket & { messages: TicketMessage[] }) | undefined>;
  // Del comercio; si se indica autor, solo los suyos.
  listForTenant(tenantId: string, authorId?: string): Promise<Ticket[]>;
  listAll(status?: TicketStatus): Promise<Ticket[]>;
  addMessage(ticketId: string, authorId: string, message: TicketMessage): Promise<void>;
  setStatus(ticketId: string, status: TicketStatus, at: Date): Promise<void>;
}

export interface TechnicalAuditEntryView {
  id: string;
  at: Date;
  type: string;
  actorId: string | null;
  tenantId: string | null;
  ip: string | null;
  detail: Record<string, string | number | boolean | null>;
}

export interface TechnicalAuditFilter {
  from?: Date;
  to?: Date;
  type?: string;
  limit: number;
}

export interface TechnicalAuditQuery {
  search(filter: TechnicalAuditFilter): Promise<TechnicalAuditEntryView[]>;
}

export interface PlatformHealth {
  recentErrors: { at: Date; method: string; path: string; error: string }[];
  jobs: { pending: number; running: number; failed: number };
  outbox: { pending: number; withErrors: number; oldestPendingAt: Date | null };
}

export interface PlatformHealthQuery {
  snapshot(): Promise<PlatformHealth>;
}
