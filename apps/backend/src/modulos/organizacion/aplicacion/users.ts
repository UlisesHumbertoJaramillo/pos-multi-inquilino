// Usuarios del comercio: alta, roles y sucursales asignadas por el AC (T-064, RF-026).
// Los cambios de permisos quedan en la auditoría comercial (RF-018).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { assertNoDependencies } from '../dominio/structure.js';
import type {
  AccountRegistry,
  BranchRepository,
  DependencyQuery,
  RoleAssignment,
  TenantUser,
  TenantUsers,
} from './ports.js';

export interface UserAdminDependencies {
  uow: UnitOfWork;
  users: TenantUsers;
  accounts: AccountRegistry;
  branches: BranchRepository;
  dependencies: DependencyQuery;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
}

abstract class UserAdminUseCase {
  constructor(protected readonly deps: UserAdminDependencies) {}

  protected async tenantOf(context: SecurityContext): Promise<string> {
    await this.deps.access.check(context, 'organizacion.gestionar');
    return this.deps.access.requireTenant(context);
  }

  // Roles de un usuario del comercio: AC sin sucursal; AS y VO en sucursales activas del comercio.
  // Nunca SA (RF-012).
  protected async validRoles(tenantId: string, roles: RoleAssignment[]): Promise<RoleAssignment[]> {
    if (roles.length === 0) {
      throw new DomainError('ROLES_INVALIDOS', 'El usuario tiene que tener al menos un rol.');
    }
    const unique = new Map<string, RoleAssignment>();
    for (const assignment of roles) {
      if (assignment.role === 'SA') {
        throw new DomainError('ROLES_INVALIDOS', 'Un usuario del comercio no puede ser SA.');
      }
      const needsBranch = assignment.role === 'AS' || assignment.role === 'VO';
      if (needsBranch !== (assignment.branchId !== null)) {
        throw new DomainError(
          'ROLES_INVALIDOS',
          needsBranch
            ? `El rol ${assignment.role} se asigna a una sucursal.`
            : 'El rol AC actúa sobre todo el comercio: no lleva sucursal.',
        );
      }
      if (assignment.branchId !== null) {
        const branch = await this.deps.branches.findById(tenantId, assignment.branchId);
        if (!branch?.isActive) {
          throw new DomainError(
            'SUCURSAL_INVALIDA',
            'La sucursal elegida no existe o está dada de baja.',
          );
        }
      }
      unique.set(`${assignment.role}:${assignment.branchId ?? ''}`, assignment);
    }
    return [...unique.values()];
  }

  protected async user(
    context: SecurityContext,
    tenantId: string,
    id: string,
  ): Promise<TenantUser> {
    const found = await this.deps.users.findInTenant(tenantId, id);
    // De otro comercio se responde igual que inexistente, y el intento queda registrado (RF-002).
    if (!found) return this.deps.access.notFound(context, 'usuario', id);
    return found;
  }

  // El comercio nunca queda sin un AC activo.
  protected async assertKeepsAnAdmin(
    tenantId: string,
    userId: string,
    keepsAc: boolean,
  ): Promise<void> {
    if (keepsAc) return;
    const admins = (await this.deps.users.listByTenant(tenantId)).filter(
      (u) => u.isActive && u.id !== userId && u.assignments.some((a) => a.role === 'AC'),
    );
    if (admins.length === 0) {
      throw new ApplicationError(
        'conflict',
        'ULTIMO_ADMINISTRADOR',
        'El comercio no puede quedarse sin un administrador (AC) activo.',
      );
    }
  }
}

export class ListTenantUsers extends UserAdminUseCase {
  async execute(context: SecurityContext): Promise<TenantUser[]> {
    const tenantId = await this.tenantOf(context);
    return this.deps.users.listByTenant(tenantId);
  }
}

export class CreateTenantUser extends UserAdminUseCase {
  async execute(
    context: SecurityContext,
    input: { email: string; name: string; roles: RoleAssignment[] },
  ): Promise<{ userId: string }> {
    const tenantId = await this.tenantOf(context);
    const roles = await this.deps.uow.run(() => this.validRoles(tenantId, input.roles), {
      tenantId,
    });
    const created = await this.deps.accounts.execute({
      tenantId,
      email: input.email,
      name: input.name,
      roles,
      createdBy: context.userId,
    });
    await this.deps.uow.run(
      () =>
        this.deps.audit.record({
          tenantId,
          userId: context.userId,
          activeRole: 'AC',
          action: 'usuario_alta',
          entity: 'usuario',
          entityId: created.userId,
          after: { roles },
        }),
      { tenantId },
    );
    return created;
  }
}

export class ChangeUserRoles extends UserAdminUseCase {
  async execute(
    context: SecurityContext,
    userId: string,
    roles: RoleAssignment[],
  ): Promise<TenantUser> {
    const tenantId = await this.tenantOf(context);
    return this.deps.uow.run(
      async () => {
        const current = await this.user(context, tenantId, userId);
        if (!current.isActive) {
          throw new ApplicationError(
            'conflict',
            'YA_DADO_DE_BAJA',
            'El usuario está dado de baja.',
          );
        }
        const next = await this.validRoles(tenantId, roles);
        await this.assertKeepsAnAdmin(
          tenantId,
          userId,
          next.some((a) => a.role === 'AC'),
        );
        const now = this.deps.clock.now();
        await this.deps.users.replaceRoles(userId, next, context.userId, now);
        // Los permisos cambian en su próxima solicitud: se cierran sus sesiones (RF-011).
        await this.deps.users.revokeSessions(userId, now);
        await this.deps.audit.record({
          tenantId,
          userId: context.userId,
          activeRole: 'AC',
          action: 'roles_modificados',
          entity: 'usuario',
          entityId: userId,
          before: { roles: current.assignments },
          after: { roles: next },
        });
        return { ...current, assignments: next };
      },
      { tenantId },
    );
  }
}

export class DeactivateTenantUser extends UserAdminUseCase {
  async execute(context: SecurityContext, userId: string): Promise<void> {
    const tenantId = await this.tenantOf(context);
    if (userId === context.userId) {
      throw new ApplicationError('conflict', 'BAJA_PROPIA', 'No podés darte de baja a vos mismo.');
    }
    await this.deps.uow.run(
      async () => {
        const current = await this.user(context, tenantId, userId);
        if (!current.isActive) {
          throw new ApplicationError(
            'conflict',
            'YA_DADO_DE_BAJA',
            'El usuario está dado de baja.',
          );
        }
        // RF-148: un usuario con turno abierto no se da de baja.
        assertNoDependencies('el usuario', await this.deps.dependencies.forUser(tenantId, userId));
        await this.assertKeepsAnAdmin(tenantId, userId, false);
        const now = this.deps.clock.now();
        await this.deps.users.deactivate(userId, context.userId, now);
        await this.deps.users.revokeSessions(userId, now);
        await this.deps.audit.record({
          tenantId,
          userId: context.userId,
          activeRole: 'AC',
          action: 'usuario_baja',
          entity: 'usuario',
          entityId: userId,
          before: { roles: current.assignments },
        });
      },
      { tenantId },
    );
  }
}
