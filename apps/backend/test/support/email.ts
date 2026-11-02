// Correo en memoria para las pruebas: guarda los mensajes y permite leer sus enlaces.
import type { EmailMessage, EmailSender } from '../../src/compartido/aplicacion/email-sender.js';

export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }

  // Token del último enlace enviado a ese correo.
  lastTokenFor(to: string): string {
    const message = this.sent.filter((m) => m.to === to).at(-1);
    const token = message?.text.match(/[?&]token=([\w-]+)/)?.[1];
    if (!token) throw new Error(`No hay un enlace con token para ${to}.`);
    return token;
  }
}
