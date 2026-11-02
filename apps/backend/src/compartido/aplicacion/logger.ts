// Puerto de registro (T-015). Los adaptadores ocultan los datos sensibles antes de escribir (Const. 17).
export type LogContext = Record<string, unknown>;

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
