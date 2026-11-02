// Monta la aplicación completa en memoria, con una API simulada.
import { ThemeProvider } from '@mui/material/styles';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { routes } from '../router';
import { theme } from '../theme';

export type ApiHandler = (body: unknown) => { status: number; body?: unknown };

// Simula la API: cada clave es "MÉTODO /ruta". Devuelve el mock para revisar las llamadas.
export function mockApi(handlers: Record<string, ApiHandler>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = handlers[key];
    if (!handler) return Promise.reject(new TypeError(`Sin respuesta simulada para ${key}`));
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const response = handler(body);
    return Promise.resolve(
      new Response(response.body === undefined ? null : JSON.stringify(response.body), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider theme={theme}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>,
  );
  return router;
}
