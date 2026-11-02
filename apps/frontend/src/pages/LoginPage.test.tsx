import type { SessionTokens, SessionUser } from '@pos/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '../test/render';

const IN_FIVE_MINUTES = () => new Date(Date.now() + 5 * 60_000).toISOString();

function session(user: Partial<SessionUser>, requiresRole = false): SessionTokens {
  return {
    tokenAcceso: 'a.b.c',
    tokenAccesoVenceEn: IN_FIVE_MINUTES(),
    tokenRenovacion: 'renovacion-de-prueba-0123456789',
    sesionVenceEn: IN_FIVE_MINUTES(),
    usuario: {
      id: 'u1',
      email: 'vo@demo.local',
      nombre: 'Valeria',
      comercioId: 'c1',
      roles: ['VO'],
      rolActivo: 'VO',
      sucursales: ['s1'],
      ...user,
    },
    requiereElegirRol: requiresRole,
  };
}

async function signIn(email = 'vo@demo.local') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/correo/i), email);
  await user.type(screen.getByLabelText(/contraseña/i), 'Demo-2026!');
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
  return user;
}

describe('[RF-005] pantalla de inicio de sesión', () => {
  it('ingresa con el VO y lleva al punto de venta con su rol activo', async () => {
    mockApi({ 'POST /auth/login': () => ({ status: 200, body: session({}) }) });
    const router = renderApp('/login');

    await signIn();

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pos');
    });
    expect(await screen.findByRole('heading', { name: 'Punto de venta' })).toBeInTheDocument();
    expect(screen.getByTestId('rol-activo')).toHaveTextContent('Vendedor');
    // El token de renovación queda para la pestaña; el de acceso, solo en memoria.
    expect(sessionStorage.getItem('pos.tokenRenovacion')).toBe('renovacion-de-prueba-0123456789');
  });

  it('muestra el mensaje del backend ante credenciales incorrectas', async () => {
    mockApi({
      'POST /auth/login': () => ({
        status: 401,
        body: {
          codigo: 'CREDENCIALES_INVALIDAS',
          mensaje: 'El correo o la contraseña no son correctos.',
        },
      }),
    });
    renderApp('/login');

    await signIn();

    expect(
      await screen.findByText('El correo o la contraseña no son correctos.'),
    ).toBeInTheDocument();
  });

  it('[RF-006] con el correo sin validar ofrece reenviar la validación', async () => {
    const api = mockApi({
      'POST /auth/login': () => ({
        status: 403,
        body: {
          codigo: 'CORREO_SIN_VALIDAR',
          mensaje: 'Tenés que validar tu correo antes de ingresar.',
        },
      }),
      'POST /auth/validacion/reenviar': () => ({
        status: 202,
        body: { mensaje: 'Si la cuenta existe y falta validarla, te enviamos un nuevo correo.' },
      }),
    });
    renderApp('/login');

    const user = await signIn('pendiente@demo.local');
    await user.click(await screen.findByRole('button', { name: 'Reenviar' }));

    expect(await screen.findByText(/te enviamos un nuevo correo/)).toBeInTheDocument();
    const resend = api.mock.calls.find(
      ([input]) => typeof input === 'string' && input.endsWith('/auth/validacion/reenviar'),
    );
    expect(resend?.[1]?.body).toBe(JSON.stringify({ email: 'pendiente@demo.local' }));
  });
});

describe('[RF-010] rol activo en la interfaz', () => {
  it('en el primer ingreso con varios roles pide elegir, y el menú cambia con el rol', async () => {
    const multi = { email: 'as@demo.local', nombre: 'Sergio', roles: ['AS', 'VO'] as const };
    mockApi({
      'POST /auth/login': () => ({
        status: 200,
        body: session({ ...multi, roles: [...multi.roles], rolActivo: null, sucursales: [] }, true),
      }),
      'PUT /auth/rol-activo': (body) => {
        const rol = (body as { rol: 'AS' | 'VO' }).rol;
        return {
          status: 200,
          body: {
            tokenAcceso: 'a.b.c',
            tokenAccesoVenceEn: IN_FIVE_MINUTES(),
            usuario: session({ ...multi, roles: [...multi.roles], rolActivo: rol }).usuario,
          },
        };
      },
    });
    const router = renderApp('/login');

    const user = await signIn('as@demo.local');
    await user.click(await screen.findByRole('button', { name: 'Administrador de Sucursal' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin');
    });
    expect(await screen.findByText('Inventario')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cambiar rol' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Vendedor' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/pos');
    });
    expect(await screen.findByTestId('rol-activo')).toHaveTextContent('Vendedor');
    expect(screen.queryByText('Inventario')).not.toBeInTheDocument();
  });
});
