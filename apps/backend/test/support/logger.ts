// Logger en memoria para las pruebas: guarda lo registrado en lugar de escribirlo.
import type { LogContext, Logger } from '../../src/compartido/aplicacion/logger.js';

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  context: LogContext | undefined;
}

export interface MemoryLogger extends Logger {
  entries: LogEntry[];
}

export function createMemoryLogger(): MemoryLogger {
  const entries: LogEntry[] = [];
  return {
    entries,
    info: (message, context) => entries.push({ level: 'info', message, context }),
    warn: (message, context) => entries.push({ level: 'warn', message, context }),
    error: (message, context) => entries.push({ level: 'error', message, context }),
  };
}
