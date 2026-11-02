// Adaptador del puerto EmailSender para desarrollo (T-029): escribe el correo en la consola,
// separado del log de la aplicación, porque los enlaces llevan tokens de un solo uso.
// El backend no arranca en producción con este adaptador (Const. 17).
import type { Writable } from 'node:stream';
import type { EmailMessage, EmailSender } from '../../aplicacion/email-sender.js';

export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly output: Writable = process.stdout) {}

  send(message: EmailMessage): Promise<void> {
    const line = '─'.repeat(64);
    this.output.write(
      [
        '',
        `┌${line}`,
        '│ CORREO SIMULADO (solo desarrollo)',
        `│ Para:   ${message.to}`,
        `│ Asunto: ${message.subject}`,
        `├${line}`,
        ...message.text.split('\n').map((text) => `│ ${text}`),
        `└${line}`,
        '',
      ].join('\n'),
    );
    return Promise.resolve();
  }
}

export interface EmailSenderConfig {
  adapter: string;
  production: boolean;
}

export function createEmailSender(config: EmailSenderConfig): EmailSender {
  if (config.adapter === 'console') {
    if (config.production) {
      throw new Error(
        'EMAIL_ADAPTER=console no se permite en producción: configurá un adaptador de envío real.',
      );
    }
    return new ConsoleEmailSender();
  }
  throw new Error(`Adaptador de correo desconocido: ${config.adapter}`);
}
