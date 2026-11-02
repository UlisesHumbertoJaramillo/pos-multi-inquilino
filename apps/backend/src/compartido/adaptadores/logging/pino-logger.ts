// Adaptador del puerto Logger con pino: registros JSON, con los datos sensibles ocultos (T-015).
import { pino, type DestinationStream, type Level } from 'pino';
import type { LogContext, Logger } from '../../aplicacion/logger.js';
import { redactSensitive, redactText } from './redact.js';

export interface PinoLoggerOptions {
  level?: Level;
  // Para las pruebas: dónde escribir en lugar de la salida estándar.
  destination?: DestinationStream;
}

export function createPinoLogger(options: PinoLoggerOptions = {}): Logger {
  const base = pino(
    {
      level: options.level ?? 'info',
      // Sin pid ni nombre del equipo en cada registro.
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    options.destination,
  );

  const write = (level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void => {
    base[level](context ? redactSensitive(context) : {}, redactText(message));
  };

  return {
    info: (message, context) => {
      write('info', message, context);
    },
    warn: (message, context) => {
      write('warn', message, context);
    },
    error: (message, context) => {
      write('error', message, context);
    },
  };
}
