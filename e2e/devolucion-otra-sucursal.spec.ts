// T-245: un ticket de una sucursal se devuelve en otra y el AS revisa lo que volvió.
import { expect, test } from '@playwright/test';
import {
  migrateDatabase,
  openShift,
  ownerSql,
  PRODUCT,
  resetData,
  returnOneUnit,
  sellInCash,
  signIn,
  USERS,
} from './support/app.js';

test.beforeAll(migrateDatabase);
test.beforeEach(resetData);

const NORTE = 'de000000-0000-4000-8000-0000000000c2';

async function stockInReview(product: string): Promise<number> {
  const rows = await ownerSql<{ cantidad: string }>(
    `SELECT s.en_revision AS cantidad
       FROM inventario s JOIN producto p ON p.id = s.producto_id
      WHERE s.sucursal_id = $1 AND p.nombre = $2`,
    [NORTE, product],
  );
  return Number(rows[0]?.cantidad ?? 0);
}

test('[RF-083] [RF-087] [RF-088] devolución en otra sucursal y revisión del stock', async ({
  browser,
}) => {
  const centro = await signIn(browser, USERS.vo);
  await openShift(centro, '1000');
  const ticket = await sellInCash(centro, PRODUCT);

  // Vuelve por Norte: el ticket se encuentra aunque se haya vendido en Centro.
  const norte = await signIn(browser, USERS.voNorte);
  await openShift(norte, '5000');
  await returnOneUnit(norte, ticket, PRODUCT);

  // Lo devuelto queda en revisión en la sucursal que lo recibió, no se vende.
  expect(await stockInReview(PRODUCT)).toBe(1);

  const as = await signIn(browser, USERS.as, { role: 'Administrador de Sucursal' });
  await as.goto('/admin/inventario');
  await as.getByRole('combobox', { name: 'Sucursal' }).click();
  await as.getByRole('option', { name: 'Norte' }).click();
  await as.getByRole('button', { name: `Revisar ${PRODUCT}` }).click();
  const review = as.getByRole('dialog', { name: 'Resolver stock en revisión' });
  await expect(review.getByLabel('Cantidad')).toHaveValue('1');
  await review.getByRole('button', { name: 'Guardar' }).click();
  await expect(as.getByText(`Stock en revisión de ${PRODUCT} resuelto.`)).toBeVisible();

  expect(await stockInReview(PRODUCT)).toBe(0);
});
