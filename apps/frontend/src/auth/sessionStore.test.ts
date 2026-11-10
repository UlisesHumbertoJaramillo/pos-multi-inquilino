import type { SessionTokens } from '@pos/contracts';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/render';
import { clearSession, currentAccessToken, renewSession, storeSession } from './sessionStore';

function tokens(access: string, refresh: string): SessionTokens {
  const later = new Date(Date.now() + 5 * 60_000).toISOString();
  return {
    tokenAcceso: access,
    tokenAccesoVenceEn: later,
    tokenRenovacion: refresh,
    sesionVenceEn: later,
    usuario: {
      id: 'u1',
      email: 'vo@demo.local',
      nombre: 'Valeria',
      comercioId: 'c1',
      moduloFacturacion: true,
      nombreComercio: 'Demo',
      detalleSucursales: [],
      roles: ['VO'],
      rolActivo: 'VO',
      sucursales: [],
    },
    requiereElegirRol: false,
  };
}

describe('sesión en el navegador', () => {
  it('varias renovaciones simultáneas hacen una sola llamada (el token rota)', async () => {
    storeSession(tokens('acceso-1', 'renovacion-1'));
    const api = mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: tokens('acceso-2', 'renovacion-2') }),
    });

    const [a, b] = await Promise.all([renewSession(), renewSession()]);

    expect(api).toHaveBeenCalledTimes(1);
    expect(a.tokenAcceso).toBe('acceso-2');
    expect(b.tokenAcceso).toBe('acceso-2');
    expect(currentAccessToken()).toBe('acceso-2');
    expect(sessionStorage.getItem('pos.tokenRenovacion')).toBe('renovacion-2');
  });

  it('si la renovación falla, borra la sesión', async () => {
    storeSession(tokens('acceso-1', 'renovacion-1'));
    mockApi({
      'POST /auth/renovar': () => ({
        status: 401,
        body: { codigo: 'SESION_INVALIDA', mensaje: 'La sesión no es válida o venció.' },
      }),
    });

    await expect(renewSession()).rejects.toMatchObject({ status: 401 });

    expect(currentAccessToken()).toBeNull();
    expect(sessionStorage.getItem('pos.tokenRenovacion')).toBeNull();
  });

  it('cerrar la sesión olvida los dos tokens', () => {
    storeSession(tokens('acceso-1', 'renovacion-1'));

    clearSession();

    expect(currentAccessToken()).toBeNull();
    expect(sessionStorage.getItem('pos.tokenRenovacion')).toBeNull();
  });
});
