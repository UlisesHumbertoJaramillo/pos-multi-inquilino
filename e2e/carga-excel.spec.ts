// Carga desde Excel con los archivos de ejemplo de docs/ejemplos (T-296, T-297; RF-170 a RF-173).
// Los ejemplos traen filas válidas y filas con errores a propósito, contra los datos de demostración.
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { migrateDatabase, ownerSql, resetData, signIn, USERS } from './support/app.js';

test.beforeAll(migrateDatabase);
test.beforeEach(resetData);

const EXAMPLES = resolve(import.meta.dirname, '../docs/ejemplos');
const SCREENSHOT = process.env.E2E_CAPTURAS;

async function load(page: Page, tab: string, file: string, expected: [number, number, number]) {
  await page.getByRole('tab', { name: tab }).click();
  await page.getByLabel('Archivo de Excel').setInputFiles(resolve(EXAMPLES, file));
  const preview = page.getByLabel('Vista previa');
  await expect(preview.getByText('Vista previa: todavía no se cargó nada.')).toBeVisible();
  const [created, updated, rejected] = expected;
  const counts = await preview.locator('table[aria-label="Filas del archivo"] tbody tr').count();
  expect(counts).toBe(created + updated + rejected);
  await expect(preview.getByRole('status', { name: 'Crítica: Se rechaza' })).toHaveCount(rejected);
  await expect(preview.getByRole('status', { name: 'Correcta: Se crea' })).toHaveCount(created);
  await expect(preview.getByRole('status', { name: 'Informativa: Se actualiza' })).toHaveCount(
    updated,
  );
  if (SCREENSHOT)
    await page.screenshot({ path: `${SCREENSHOT}/carga-${file}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Confirmar la carga' }).click();
  await expect(
    page.getByText(
      new RegExp(`Carga hecha: ${String(created)} creados y ${String(updated)} actualizados`),
    ),
  ).toBeVisible();
}

test('[RF-170] [RF-171] [RF-172] los archivos de ejemplo se cargan desde la pantalla', async ({
  browser,
}) => {
  const ac = await signIn(browser, USERS.ac);
  await ac.goto('/admin/carga-excel');

  await load(ac, 'Productos', 'productos.xlsx', [3, 2, 3]);
  expect(
    await ownerSql("SELECT nombre FROM producto WHERE codigo_barras = '7790005000031'"),
  ).toEqual([{ nombre: 'Dulce de leche 400 g' }]);

  await load(ac, 'Proveedores', 'proveedores.xlsx', [2, 1, 1]);
  await load(ac, 'Precios', 'precios.xlsx', [3, 0, 2]);
  const prices = await ownerSql<{ total: string }>(
    `SELECT count(*)::text AS total FROM precio_lista pl JOIN lista_precio l ON l.id = pl.lista_id
      WHERE l.nombre = 'Precios especiales'`,
  );
  expect(prices).toEqual([{ total: '3' }]);
});
