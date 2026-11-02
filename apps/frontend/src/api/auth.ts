// Llamadas de acceso a la API, tipadas con el contrato (packages/contracts).
import type { ActiveRoleChange, Message, Role, SessionTokens, SessionUser } from '@pos/contracts';
import { apiRequest } from './httpClient';

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export function login(email: string, contrasena: string): Promise<SessionTokens> {
  return apiRequest<SessionTokens>('/auth/login', json({ email, contrasena }));
}

export function refreshSession(tokenRenovacion: string): Promise<SessionTokens> {
  return apiRequest<SessionTokens>('/auth/renovar', json({ tokenRenovacion }));
}

export function logout(accessToken: string): Promise<void> {
  return apiRequest<undefined>('/auth/cerrar-sesion', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function selectActiveRole(accessToken: string, rol: Role): Promise<ActiveRoleChange> {
  return apiRequest<ActiveRoleChange>('/auth/rol-activo', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ rol }),
  });
}

export function getCurrentSession(accessToken: string): Promise<SessionUser> {
  return apiRequest<SessionUser>('/auth/sesion', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function resendEmailValidation(email: string): Promise<Message> {
  return apiRequest<Message>('/auth/validacion/reenviar', json({ email }));
}

export function confirmEmail(token: string): Promise<Message> {
  return apiRequest<Message>('/auth/validacion/confirmar', json({ token }));
}

export function requestPasswordReset(email: string): Promise<Message> {
  return apiRequest<Message>('/auth/recuperacion/solicitar', json({ email }));
}

export function resetPassword(token: string, nuevaContrasena: string): Promise<Message> {
  return apiRequest<Message>('/auth/recuperacion/restablecer', json({ token, nuevaContrasena }));
}

export function activateAccount(token: string, nuevaContrasena: string): Promise<Message> {
  return apiRequest<Message>('/auth/activacion', json({ token, nuevaContrasena }));
}
