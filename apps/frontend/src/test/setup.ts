// Preparación de las pruebas del frontend.
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Las búsquedas asíncronas (findBy, waitFor) esperan más que el segundo por defecto: con varios
// archivos en paralelo, montar una pantalla con MUI puede tardar más.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
