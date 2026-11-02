// Puertos de salida del módulo de organización. Los repositorios trabajan dentro de una unidad
// de trabajo con el comercio fijado (seguridad a nivel de fila) y además filtran por comercio.
import type { Role } from '../../../compartido/dominio/roles.js';
import type { TenantParameters } from '../dominio/parameters.js';
import type { PaymentMethod } from '../dominio/payment-methods.js';
import type { Branch, Dependencies, Register } from '../dominio/structure.js';

export interface BranchRepository {
  list(tenantId: string, includeInactive: boolean): Promise<Branch[]>;
  findById(tenantId: string, id: string): Promise<Branch | undefined>;
  insert(branch: Branch, at: Date): Promise<void>;
  update(branch: Branch): Promise<void>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
}

export interface RegisterRepository {
  list(tenantId: string, includeInactive: boolean): Promise<Register[]>;
  findById(tenantId: string, id: string): Promise<Register | undefined>;
  // Una caja activa con ese punto de venta, o dada de baja: ARCA no reutiliza puntos de venta.
  pointOfSaleInUse(tenantId: string, pointOfSale: number, exceptId?: string): Promise<boolean>;
  insert(register: Register, at: Date): Promise<void>;
  update(register: Register): Promise<void>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
}

export interface ParametersRepository {
  find(tenantId: string): Promise<TenantParameters | undefined>;
  save(tenantId: string, parameters: TenantParameters, by: string, at: Date): Promise<void>;
}

export interface PaymentMethodRepository {
  list(tenantId: string, includeInactive: boolean): Promise<PaymentMethod[]>;
  findById(tenantId: string, id: string): Promise<PaymentMethod | undefined>;
  insert(method: PaymentMethod, at: Date): Promise<void>;
  update(method: PaymentMethod): Promise<void>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
}

// Puerto ConsultaDependencias (T-063): lo que impide dar de baja una sucursal, una caja o un
// usuario. Simulado hasta las Fases 9 y 10, cuando existan turnos, ventas y transferencias.
export interface DependencyQuery {
  forBranch(tenantId: string, branchId: string): Promise<Dependencies>;
  forRegister(tenantId: string, registerId: string): Promise<Dependencies>;
  forUser(tenantId: string, userId: string): Promise<Dependencies>;
}

// Lo provee plataforma.
export interface TenantDirectory {
  find(tenantId: string): Promise<{ name: string; billingModule: boolean } | undefined>;
}

export interface RoleAssignment {
  role: Role;
  branchId: string | null;
}

export interface TenantUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  emailValidated: boolean;
  assignments: RoleAssignment[];
}

// Lo provee identidad.
export interface TenantUsers {
  listByTenant(tenantId: string): Promise<TenantUser[]>;
  findInTenant(tenantId: string, id: string): Promise<TenantUser | undefined>;
  replaceRoles(userId: string, assignments: RoleAssignment[], by: string, at: Date): Promise<void>;
  deactivate(userId: string, by: string, at: Date): Promise<void>;
  revokeSessions(userId: string, at: Date): Promise<void>;
}

export interface AccountRegistry {
  execute(input: {
    tenantId: string | null;
    email: string;
    name: string;
    roles: RoleAssignment[];
    createdBy: string;
  }): Promise<{ userId: string }>;
}
