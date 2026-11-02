// Llamadas de organización del comercio (AC), tipadas con el contrato.
import type {
  Branch,
  BranchCreateRequest,
  CreatedAccount,
  PaymentMethod,
  PaymentMethodCreateRequest,
  PaymentMethodUpdateRequest,
  Register,
  RegisterCreateRequest,
  RoleAssignment,
  Structure,
  TenantParameters,
  TenantParametersUpdateRequest,
  TenantUser,
  TenantUserCreateRequest,
} from '@pos/contracts';
import type { Request } from './platform';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const organizationApi = (request: Request) => ({
  getStructure: (includeInactive = false) =>
    request<Structure>(`/organizacion/estructura${includeInactive ? '?incluirBajas=true' : ''}`),
  createBranch: (body: BranchCreateRequest) =>
    request<Branch>('/organizacion/sucursales', send('POST', body)),
  deactivateBranch: (id: string) =>
    request<undefined>(`/organizacion/sucursales/${id}/baja`, send('POST')),
  createRegister: (branchId: string, body: RegisterCreateRequest) =>
    request<Register>(`/organizacion/sucursales/${branchId}/cajas`, send('POST', body)),
  deactivateRegister: (id: string) =>
    request<undefined>(`/organizacion/cajas/${id}/baja`, send('POST')),
  listUsers: () => request<TenantUser[]>('/organizacion/usuarios'),
  createUser: (body: TenantUserCreateRequest) =>
    request<CreatedAccount>('/organizacion/usuarios', send('POST', body)),
  changeRoles: (id: string, roles: RoleAssignment[]) =>
    request<TenantUser>(`/organizacion/usuarios/${id}/roles`, send('PUT', { roles })),
  deactivateUser: (id: string) =>
    request<undefined>(`/organizacion/usuarios/${id}/baja`, send('POST')),
  getParameters: () => request<TenantParameters>('/organizacion/parametros'),
  updateParameters: (body: TenantParametersUpdateRequest) =>
    request<TenantParameters>('/organizacion/parametros', send('PATCH', body)),
  listPaymentMethods: () => request<PaymentMethod[]>('/organizacion/metodos-pago'),
  createPaymentMethod: (body: PaymentMethodCreateRequest) =>
    request<PaymentMethod>('/organizacion/metodos-pago', send('POST', body)),
  updatePaymentMethod: (id: string, body: PaymentMethodUpdateRequest) =>
    request<PaymentMethod>(`/organizacion/metodos-pago/${id}`, send('PATCH', body)),
  deactivatePaymentMethod: (id: string) =>
    request<undefined>(`/organizacion/metodos-pago/${id}/baja`, send('POST')),
});
