// Sucursales, cajas y jerarquía del comercio (T-061 a T-063, T-067; RF-023 a RF-025, RF-027).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import {
  assertAddress,
  assertName,
  assertNoDependencies,
  assertPointOfSale,
  type Branch,
  type Register,
} from '../dominio/structure.js';
import type {
  BranchRepository,
  DependencyQuery,
  RegisterRepository,
  TenantDirectory,
} from './ports.js';

export interface StructureDependencies {
  uow: UnitOfWork;
  branches: BranchRepository;
  registers: RegisterRepository;
  dependencies: DependencyQuery;
  tenants: TenantDirectory;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface Structure {
  tenantId: string;
  tenantName: string;
  branches: (Branch & { registers: Register[] })[];
}

abstract class StructureUseCase {
  constructor(protected readonly deps: StructureDependencies) {}

  // Abre la unidad de trabajo con el comercio de la sesión, tras verificar el permiso.
  protected async inTenant<T>(
    context: SecurityContext,
    work: (tenantId: string) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, 'organizacion.gestionar');
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(() => work(tenantId), { tenantId });
  }

  protected async branch(context: SecurityContext, tenantId: string, id: string): Promise<Branch> {
    const found = await this.deps.branches.findById(tenantId, id);
    // Inexistente o de otro comercio: se responde igual y el intento queda registrado (RF-002).
    if (!found) return this.deps.access.notFound(context, 'sucursal', id);
    return found;
  }

  protected async register(
    context: SecurityContext,
    tenantId: string,
    id: string,
  ): Promise<Register> {
    const found = await this.deps.registers.findById(tenantId, id);
    if (!found) return this.deps.access.notFound(context, 'caja', id);
    return found;
  }

  protected async recordChange(
    context: SecurityContext,
    tenantId: string,
    entity: { entity: string; id: string; branchId: string | null },
    action: string,
    before: unknown,
    after: unknown,
  ) {
    await this.deps.audit.record({
      tenantId,
      branchId: entity.branchId,
      userId: context.userId,
      activeRole: 'AC',
      action,
      entity: entity.entity,
      entityId: entity.id,
      before,
      after,
    });
  }
}

// Jerarquía Comercio > Sucursales > Cajas (RF-027).
export class GetStructure extends StructureUseCase {
  async execute(context: SecurityContext, includeInactive = false): Promise<Structure> {
    return this.inTenant(context, async (tenantId) => {
      const tenant = await this.deps.tenants.find(tenantId);
      const branches = await this.deps.branches.list(tenantId, includeInactive);
      const registers = await this.deps.registers.list(tenantId, includeInactive);
      return {
        tenantId,
        tenantName: tenant?.name ?? '',
        branches: branches.map((branch) => ({
          ...branch,
          registers: registers.filter((register) => register.branchId === branch.id),
        })),
      };
    });
  }
}

export class CreateBranch extends StructureUseCase {
  async execute(
    context: SecurityContext,
    input: { name: string; address: string | null },
  ): Promise<Branch> {
    return this.inTenant(context, async (tenantId) => {
      const branch: Branch = {
        id: this.deps.ids.next(),
        tenantId,
        name: assertName(input.name, 120, 'El nombre de la sucursal'),
        address: assertAddress(input.address),
        isActive: true,
      };
      await this.deps.branches.insert(branch, this.deps.clock.now());
      await this.recordChange(
        context,
        tenantId,
        { entity: 'sucursal', id: branch.id, branchId: branch.id },
        'sucursal_alta',
        null,
        branch,
      );
      return branch;
    });
  }
}

export class UpdateBranch extends StructureUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: { name?: string; address?: string | null },
  ): Promise<Branch> {
    return this.inTenant(context, async (tenantId) => {
      const current = await this.branch(context, tenantId, id);
      if (!current.isActive) throw inactive('La sucursal');
      const next: Branch = {
        ...current,
        ...(changes.name === undefined
          ? {}
          : { name: assertName(changes.name, 120, 'El nombre de la sucursal') }),
        ...(changes.address === undefined ? {} : { address: assertAddress(changes.address) }),
      };
      await this.deps.branches.update(next);
      await this.recordChange(
        context,
        tenantId,
        { entity: 'sucursal', id, branchId: id },
        'sucursal_modificada',
        current,
        next,
      );
      return next;
    });
  }
}

// RF-025: no se da de baja con turnos abiertos, ventas en curso o transferencias pendientes.
// Sus cajas activas se dan de baja con ella.
export class DeactivateBranch extends StructureUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (tenantId) => {
      const current = await this.branch(context, tenantId, id);
      if (!current.isActive) throw inactive('La sucursal');
      assertNoDependencies('la sucursal', await this.deps.dependencies.forBranch(tenantId, id));
      const now = this.deps.clock.now();
      const registers = (await this.deps.registers.list(tenantId, false)).filter(
        (r) => r.branchId === id,
      );
      for (const register of registers) {
        await this.deps.registers.deactivate(tenantId, register.id, context.userId, now);
      }
      await this.deps.branches.deactivate(tenantId, id, context.userId, now);
      await this.recordChange(
        context,
        tenantId,
        { entity: 'sucursal', id, branchId: id },
        'sucursal_baja',
        current,
        null,
      );
    });
  }
}

export class CreateRegister extends StructureUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    input: { name: string; fiscalPointOfSale: number | null },
  ): Promise<Register> {
    return this.inTenant(context, async (tenantId) => {
      const branch = await this.branch(context, tenantId, branchId);
      if (!branch.isActive) throw inactive('La sucursal');
      const pointOfSale = assertPointOfSale(input.fiscalPointOfSale);
      if (
        pointOfSale !== null &&
        (await this.deps.registers.pointOfSaleInUse(tenantId, pointOfSale))
      ) {
        throw pointOfSaleTaken();
      }
      const register: Register = {
        id: this.deps.ids.next(),
        tenantId,
        branchId,
        name: assertName(input.name, 60, 'El nombre de la caja'),
        fiscalPointOfSale: pointOfSale,
        isActive: true,
      };
      await this.deps.registers.insert(register, this.deps.clock.now());
      await this.recordChange(
        context,
        tenantId,
        { entity: 'caja', id: register.id, branchId },
        'caja_alta',
        null,
        register,
      );
      return register;
    });
  }
}

export class UpdateRegister extends StructureUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: { name?: string; fiscalPointOfSale?: number | null },
  ): Promise<Register> {
    return this.inTenant(context, async (tenantId) => {
      const current = await this.register(context, tenantId, id);
      if (!current.isActive) throw inactive('La caja');
      const pointOfSale =
        changes.fiscalPointOfSale === undefined
          ? current.fiscalPointOfSale
          : assertPointOfSale(changes.fiscalPointOfSale);
      if (
        pointOfSale !== null &&
        pointOfSale !== current.fiscalPointOfSale &&
        (await this.deps.registers.pointOfSaleInUse(tenantId, pointOfSale, id))
      ) {
        throw pointOfSaleTaken();
      }
      const next: Register = {
        ...current,
        ...(changes.name === undefined
          ? {}
          : { name: assertName(changes.name, 60, 'El nombre de la caja') }),
        fiscalPointOfSale: pointOfSale,
      };
      await this.deps.registers.update(next);
      await this.recordChange(
        context,
        tenantId,
        { entity: 'caja', id, branchId: current.branchId },
        'caja_modificada',
        current,
        next,
      );
      return next;
    });
  }
}

export class DeactivateRegister extends StructureUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (tenantId) => {
      const current = await this.register(context, tenantId, id);
      if (!current.isActive) throw inactive('La caja');
      assertNoDependencies('la caja', await this.deps.dependencies.forRegister(tenantId, id));
      await this.deps.registers.deactivate(tenantId, id, context.userId, this.deps.clock.now());
      await this.recordChange(
        context,
        tenantId,
        { entity: 'caja', id, branchId: current.branchId },
        'caja_baja',
        current,
        null,
      );
    });
  }
}

function inactive(what: string): ApplicationError {
  return new ApplicationError('conflict', 'YA_DADO_DE_BAJA', `${what} está dada de baja.`);
}

function pointOfSaleTaken(): ApplicationError {
  return new ApplicationError(
    'conflict',
    'PUNTO_DE_VENTA_EN_USO',
    'Ese punto de venta ya está asignado a otra caja del comercio.',
  );
}
