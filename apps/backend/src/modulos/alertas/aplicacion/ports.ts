// Puertos del módulo de alertas y tiempo real (T-227, T-228; plan §2.17, AD-06).
import type { AlertAudience, AlertRole, AlertSeverity } from '../dominio/alerts.js';

export interface AlertView {
  id: string;
  branchId: string | null;
  branchName: string | null;
  recipientRole: AlertRole;
  recipientId: string | null;
  type: string;
  severity: AlertSeverity;
  persistent: boolean;
  reference: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
  lastReminder: Date | null;
  resolvedAt: Date | null;
}

export interface AlertQuery extends AlertAudience {
  tenantId: string;
  // Filtro opcional del AC por sucursal.
  branchId: string | null;
}

// Alertas de la tabla común, que escriben todos los módulos.
export interface AlertInbox {
  // Las pendientes del destinatario, la más reciente (o recién recordada) primero.
  pending(query: AlertQuery): Promise<AlertView[]>;
  find(tenantId: string, id: string): Promise<AlertView | undefined>;
  // Resolución condicional: devuelve false si otro la resolvió antes.
  resolve(
    tenantId: string,
    id: string,
    by: string,
    at: Date,
    note: string | null,
  ): Promise<boolean>;
  // Comercios activos, para la pasada de recordatorios del worker.
  activeTenants(): Promise<string[]>;
  // Recuerda las persistentes vencidas y programa el próximo recordatorio. Devuelve cuántas.
  remind(tenantId: string, now: Date, next: Date): Promise<number>;
}

export interface BranchLookup {
  exists(tenantId: string, branchId: string): Promise<boolean>;
}

// Aviso que llega de la base cuando confirma una transacción (AD-06).
export type RealtimeNotice =
  | {
      kind: 'stock';
      tenantId: string;
      branchId: string;
      productId: string;
      available: string;
    }
  | {
      kind: 'alertas';
      tenantId: string;
      branchId: string | null;
      role: AlertRole;
    };

// Fuente de avisos. El adaptador se reconecta solo si se pierde la conexión.
export interface RealtimeFeed {
  start(onNotice: (notice: RealtimeNotice) => void): Promise<void>;
  stop(): Promise<void>;
}
