// Preparación de las pruebas del frontend.
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { FakeWebSocket } from './realtime';

// Las búsquedas asíncronas (findBy, waitFor) esperan más que el segundo por defecto: con varios
// archivos en paralelo, montar una pantalla con MUI puede tardar más.
configure({ asyncUtilTimeout: 5000 });

// El canal en vivo usa un WebSocket simulado: jsdom intentaría conectarse de verdad.
globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  FakeWebSocket.reset();
});
