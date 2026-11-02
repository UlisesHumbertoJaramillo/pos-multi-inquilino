// Alta de cuentas creadas por otro usuario (T-051, RF-015) y su activación por correo.
// La cuenta nace sin contraseña utilizable: la persona la elige al abrir el enlace, y eso valida
// su correo. Así nadie conoce la contraseña de otro, ni siquiera quien creó la cuenta.
import type { TechnicalAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { EmailSender } from '../../../compartido/aplicacion/email-sender.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { assertValidPassword } from '../dominio/credentials.js';
import type { RoleAssignment } from '../dominio/roles.js';
import type { IdentityConfig } from './config.js';
import type {
  OneTimeTokenRepository,
  OpaqueTokens,
  SecretHasher,
  UserRepository,
} from './ports.js';

export interface AccountDependencies {
  uow: UnitOfWork;
  users: UserRepository;
  oneTimeTokens: OneTimeTokenRepository;
  hasher: SecretHasher;
  opaqueTokens: OpaqueTokens;
  email: EmailSender;
  audit: TechnicalAuditLog;
  clock: Clock;
  ids: IdGenerator;
  config: IdentityConfig;
}

export interface RegisterAccountInput {
  tenantId: string | null;
  email: string;
  name: string;
  roles: RoleAssignment[];
  // Quién crea la cuenta, para la auditoría técnica.
  createdBy: string;
}

export function activationEmail(name: string, link: string, ttlMs: number) {
  return {
    subject: 'Activá tu cuenta',
    text: [
      `Hola, ${name}:`,
      '',
      'Te crearon una cuenta en el sistema POS. Para activarla y elegir tu contraseña, abrí este enlace:',
      link,
      '',
      `El enlace vence en ${String(Math.round(ttlMs / 3_600_000))} horas y se puede usar una sola vez.`,
    ].join('\n'),
  };
}

export class RegisterAccount {
  constructor(private readonly deps: AccountDependencies) {}

  async execute(input: RegisterAccountInput): Promise<{ userId: string }> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const now = this.deps.clock.now();
    const userId = this.deps.ids.next();
    // Hash de un secreto al azar que nadie conoce: hasta activar la cuenta no se puede ingresar.
    const placeholderHash = await this.deps.hasher.hash(this.deps.opaqueTokens.generate().token);
    const { token, hash } = this.deps.opaqueTokens.generate();

    await this.deps.uow.run(async () => {
      if (await this.deps.users.findByEmail(email)) {
        throw new ApplicationError(
          'conflict',
          'CORREO_EN_USO',
          'Ya existe una cuenta con ese correo.',
        );
      }
      await this.deps.users.insert({
        id: userId,
        tenantId: input.tenantId,
        email,
        name,
        passwordHash: placeholderHash,
        passwordDefined: false,
        createdAt: now,
      });
      for (const assignment of input.roles) {
        await this.deps.users.insertRole(userId, assignment, now);
      }
      await this.deps.oneTimeTokens.insert({
        id: this.deps.ids.next(),
        userId,
        type: 'validacion',
        tokenHash: hash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.deps.config.validationTokenTtlMs),
      });
    });

    const link = new URL('/activar-cuenta', this.deps.config.appPublicUrl);
    link.searchParams.set('token', token);
    await this.deps.email.send({
      to: email,
      ...activationEmail(name, link.toString(), this.deps.config.validationTokenTtlMs),
    });
    await this.deps.audit.record({
      type: 'cuenta_creada',
      actorId: input.createdBy,
      tenantId: input.tenantId,
      detail: { userId, roles: input.roles.map((r) => r.role).join(',') },
    });
    return { userId };
  }
}

// Activación: con el token del correo, la persona elige su contraseña y el correo queda validado.
export class ActivateAccount {
  constructor(private readonly deps: AccountDependencies) {}

  async execute(input: { token: string; newPassword: string }): Promise<void> {
    assertValidPassword(input.newPassword);
    const now = this.deps.clock.now();
    const hash = this.deps.opaqueTokens.hash(input.token);
    const passwordHash = await this.deps.hasher.hash(input.newPassword);
    const userId = await this.deps.uow.run(async () => {
      const owner = await this.deps.oneTimeTokens.consume('validacion', hash, now);
      if (owner === undefined) return undefined;
      await this.deps.users.definePassword(owner, passwordHash);
      await this.deps.users.markEmailValidated(owner);
      return owner;
    });
    if (userId === undefined) {
      throw new ApplicationError(
        'invalid_request',
        'TOKEN_INVALIDO',
        'El enlace no es válido, venció o ya se usó. Pedí uno nuevo.',
      );
    }
    await this.deps.audit.record({ type: 'cuenta_activada', actorId: userId });
  }
}
