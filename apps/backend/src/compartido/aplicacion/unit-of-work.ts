// Puerto UnidadDeTrabajo (T-020): todo lo que hace `work` se confirma junto o no se confirma (Const. 6).
// Los repositorios y el outbox usados dentro de `work` participan de la misma transacción.
export interface TransactionOptions {
  // Comercio de la sesión: la base lo usa para la seguridad a nivel de fila (AD-03).
  tenantId?: string;
}

export interface UnitOfWork {
  run<T>(work: () => Promise<T>, options?: TransactionOptions): Promise<T>;
}
