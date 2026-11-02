// Validación de correo y recuperación de contraseña (T-029, T-030; RF-006 a RF-008, D-43).
// Las solicitudes responden lo mismo exista o no la cuenta, para no revelar qué correos existen.
import type { TechnicalAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { EmailSender } from '../../../compartido/aplicacion/email-sender.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { assertValidPassword } from '../dominio/credentials.js';
import { activationEmail } from './accounts.js';
import type { IdentityConfig } from './config.js';
import type {
  OneTimeTokenRepository,
  OneTimeTokenType,
  OpaqueTokens,
  SecretHasher,
  SessionRepository,
  UserAccount,
  UserRepository,
} from './ports.js';

export interface AccountRecoveryDependencies {
  uow: UnitOfWork;
  users: UserRepository;
  sessions: SessionRepository;
  oneTimeTokens: OneTimeTokenRepository;
  hasher: SecretHasher;
  opaqueTokens: OpaqueTokens;
  email: EmailSender;
  audit: TechnicalAuditLog;
  clock: Clock;
  ids: IdGenerator;
  config: IdentityConfig;
}

function invalidToken(): ApplicationError {
  return new ApplicationError(
    'invalid_request',
    'TOKEN_INVALIDO',
    'El enlace no es válido, venció o ya se usó. Pedí uno nuevo.',
  );
}

abstract class AccountRecoveryUseCase {
  constructor(protected readonly deps: AccountRecoveryDependencies) {}

  // Crea un token de un solo uso, deja sin efecto los anteriores y devuelve el enlace.
  protected async issueToken(
    account: UserAccount,
    type: OneTimeTokenType,
    path: string,
  ): Promise<string> {
    const now = this.deps.clock.now();
    const ttl =
      type === 'validacion'
        ? this.deps.config.validationTokenTtlMs
        : this.deps.config.recoveryTokenTtlMs;
    const { token, hash } = this.deps.opaqueTokens.generate();
    await this.deps.uow.run(async () => {
      await this.deps.oneTimeTokens.invalidateUnused(account.id, type, now);
      await this.deps.oneTimeTokens.insert({
        id: this.deps.ids.next(),
        userId: account.id,
        type,
        tokenHash: hash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttl),
      });
    });
    const url = new URL(path, this.deps.config.appPublicUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }
}

export class ResendEmailValidation extends AccountRecoveryUseCase {
  async execute(input: { email: string }): Promise<void> {
    const account = await this.deps.users.findByEmail(input.email.trim().toLowerCase());
    if (!account || !account.isActive || account.emailValidated) return;
    // Una cuenta creada por otro todavía no tiene contraseña: el enlace lleva a activarla.
    if (!account.passwordDefined) {
      const link = await this.issueToken(account, 'validacion', '/activar-cuenta');
      await this.deps.email.send({
        to: account.email,
        ...activationEmail(account.name, link, this.deps.config.validationTokenTtlMs),
      });
      return;
    }
    const link = await this.issueToken(account, 'validacion', '/validar-correo');
    await this.deps.email.send({
      to: account.email,
      subject: 'Validá tu correo',
      text: [
        `Hola, ${account.name}:`,
        '',
        'Para activar tu cuenta del sistema POS, abrí este enlace:',
        link,
        '',
        `El enlace vence en ${String(Math.round(this.deps.config.validationTokenTtlMs / 3_600_000))} horas y se puede usar una sola vez.`,
      ].join('\n'),
    });
  }
}

export class ConfirmEmail extends AccountRecoveryUseCase {
  async execute(input: { token: string }): Promise<void> {
    const now = this.deps.clock.now();
    const hash = this.deps.opaqueTokens.hash(input.token);
    const userId = await this.deps.uow.run(async () => {
      const owner = await this.deps.oneTimeTokens.consume('validacion', hash, now);
      if (owner !== undefined) await this.deps.users.markEmailValidated(owner);
      return owner;
    });
    if (userId === undefined) throw invalidToken();
    await this.deps.audit.record({ type: 'correo_validado', actorId: userId });
  }
}

export class RequestPasswordReset extends AccountRecoveryUseCase {
  async execute(input: { email: string }): Promise<void> {
    const account = await this.deps.users.findByEmail(input.email.trim().toLowerCase());
    if (!account?.isActive) return;
    const link = await this.issueToken(account, 'recuperacion', '/restablecer-contrasena');
    await this.deps.email.send({
      to: account.email,
      subject: 'Recuperá tu contraseña',
      text: [
        `Hola, ${account.name}:`,
        '',
        'Recibimos un pedido para restablecer tu contraseña. Para elegir una nueva, abrí este enlace:',
        link,
        '',
        `El enlace vence en ${String(Math.round(this.deps.config.recoveryTokenTtlMs / 60_000))} minutos y se puede usar una sola vez.`,
        'Si no lo pediste, ignorá este correo: tu contraseña no cambia.',
      ].join('\n'),
    });
  }
}

export class ResetPassword extends AccountRecoveryUseCase {
  async execute(input: { token: string; newPassword: string }): Promise<void> {
    assertValidPassword(input.newPassword);
    const now = this.deps.clock.now();
    const hash = this.deps.opaqueTokens.hash(input.token);
    const passwordHash = await this.deps.hasher.hash(input.newPassword);
    const userId = await this.deps.uow.run(async () => {
      const owner = await this.deps.oneTimeTokens.consume('recuperacion', hash, now);
      if (owner === undefined) return undefined;
      await this.deps.users.definePassword(owner, passwordHash);
      // Recibir el enlace prueba que el correo es suyo.
      await this.deps.users.markEmailValidated(owner);
      // Con la contraseña nueva, se cierran todas las sesiones abiertas.
      await this.deps.sessions.revokeAllForUser(owner, now);
      return owner;
    });
    if (userId === undefined) throw invalidToken();
    await this.deps.audit.record({ type: 'contrasena_restablecida', actorId: userId });
  }
}
