// Puerto para programar trabajos en segundo plano (T-021, AD-19).
// Dentro de una unidad de trabajo, el trabajo se programa en la misma transacción.
export interface ScheduledJob {
  type: string;
  // Identifica el trabajo dentro de su tipo: programarlo de nuevo mientras está pendiente no lo duplica.
  key: string;
  runAt: Date;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

export interface JobScheduler {
  // Devuelve false si ya había un trabajo pendiente o en curso con el mismo tipo y clave.
  schedule(job: ScheduledJob): Promise<boolean>;
}

// Lo que recibe el manejador de un tipo de trabajo cuando le toca ejecutarse.
export interface RunnableJob {
  id: string;
  type: string;
  key: string;
  payload: Record<string, unknown>;
  attempt: number;
}

export type JobHandler = (job: RunnableJob) => Promise<void>;
