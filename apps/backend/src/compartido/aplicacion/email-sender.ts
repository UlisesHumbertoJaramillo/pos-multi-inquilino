// Puerto EnvioDeCorreo (T-029). Los correos pueden llevar enlaces con tokens de un solo uso:
// nunca se registran en el log de la aplicación.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
