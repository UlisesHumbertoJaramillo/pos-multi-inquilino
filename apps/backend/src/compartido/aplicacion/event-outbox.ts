// Puerto del outbox transaccional (T-022, AD-07).
// Se usa siempre dentro de una unidad de trabajo: el evento se confirma junto con el cambio
// que lo origina, o no existe. Un worker lo despacha después del commit.
export interface OutboxEvent {
  type: string;
  // Comercio al que pertenece el evento. Se omite en los eventos de plataforma.
  tenantId?: string;
  payload: Record<string, unknown>;
}

export interface EventOutbox {
  add(event: OutboxEvent): Promise<void>;
}

// Lo que recibe el manejador de un tipo de evento. Se puede entregar más de una vez
// (por ejemplo, si el worker se cae después de entregarlo): los manejadores son idempotentes.
export interface DispatchedEvent {
  id: string;
  type: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export type EventHandler = (event: DispatchedEvent) => Promise<void>;
