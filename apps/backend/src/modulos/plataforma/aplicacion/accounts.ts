// Cuentas que crea el SA: otros SA y el primer AC de cada comercio (T-051, RF-015).
// Ambas se activan por correo: la persona elige su contraseña y así valida el correo.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import { ApplicationError, notFoundError } from '../../../compartido/aplicacion/errors.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { AccountRegistry, TenantRepository, TenantRoles } from './ports.js';

export interface PlatformAccountDependencies {
  accounts: AccountRegistry;
  tenants: TenantRepository;
  roles: TenantRoles;
  access: AccessControl;
}

export interface NewAccountInput {
  email: string;
  name: string;
}

export class CreatePlatformAdmin {
  constructor(private readonly deps: PlatformAccountDependencies) {}

  async execute(context: SecurityContext, input: NewAccountInput): Promise<{ userId: string }> {
    await this.deps.access.check(context, 'plataforma.usuarios.crear');
    return this.deps.accounts.execute({
      tenantId: null,
      email: input.email,
      name: input.name,
      roles: [{ role: 'SA', branchId: null }],
      createdBy: context.userId,
    });
  }
}

// Solo el primero: los demás usuarios del comercio los crea su AC (RF-026). Así el SA no
// administra ni ve usuarios del comercio (RF-003).
export class CreateFirstTenantAdmin {
  constructor(private readonly deps: PlatformAccountDependencies) {}

  async execute(
    context: SecurityContext,
    tenantId: string,
    input: NewAccountInput,
  ): Promise<{ userId: string }> {
    await this.deps.access.check(context, 'plataforma.usuarios.crear');
    const tenant = await this.deps.tenants.findById(tenantId);
    if (!tenant) throw notFoundError();
    if (tenant.status === 'baja') {
      throw new ApplicationError(
        'conflict',
        'COMERCIO_DADO_DE_BAJA',
        'El comercio está dado de baja.',
      );
    }
    if (await this.deps.roles.tenantHasRole(tenantId, 'AC')) {
      throw new ApplicationError(
        'conflict',
        'YA_TIENE_ADMINISTRADOR',
        'El comercio ya tiene un administrador. Los demás usuarios los crea ese administrador.',
      );
    }
    return this.deps.accounts.execute({
      tenantId,
      email: input.email,
      name: input.name,
      roles: [{ role: 'AC', branchId: null }],
      createdBy: context.userId,
    });
  }
}
