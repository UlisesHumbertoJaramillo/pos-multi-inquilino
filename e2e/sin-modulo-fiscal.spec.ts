// T-247: un comercio sin el módulo de facturación vende, anula y devuelve sin comprobantes.
import { expect, test } from '@playwright/test';
import {
  addProduct,
  AS_PIN,
  authorizeWithPin,
  confirmSale,
  findTicket,
  closeReceipt,
  migrateDatabase,
  openShift,
  ownerSql,
  PRODUCT,
  resetData,
  returnOneUnit,
  sellInCash,
  signIn,
  startSale,
  USERS,
} from './support/app.js';

test.beforeAll(migrateDatabase);
test.beforeEach(resetData);

test('[RF-165] vende, anula y devuelve sin ningún comprobante fiscal', async ({ browser }) => {
  const vo = await signIn(browser, USERS.vo);
  await openShift(vo, '5000');

  // Venta: no se ofrece facturar y el ticket lo aclara.
  await startSale(vo);
  await addProduct(vo, PRODUCT);
  await vo.getByRole('button', { name: 'Cobrar' }).click();
  const payment = vo.getByRole('dialog', { name: 'Cobrar la venta' });
  await expect(payment.getByLabel('Facturar esta venta')).toHaveCount(0);
  const sold = await confirmSale(vo);
  await expect(vo.getByRole('dialog').getByText('Ticket no válido como factura.')).toBeVisible();
  await closeReceipt(vo);

  // Anulación con el PIN del AS.
  await findTicket(vo, sold);
  const returns = vo.getByRole('dialog', { name: 'Devolución o anulación' });
  await returns.getByRole('button', { name: 'Anular venta' }).click();
  await authorizeWithPin(vo, AS_PIN);
  await expect(returns.getByText(/Venta anulada/)).toBeVisible();
  await returns.getByRole('button', { name: 'Cerrar' }).click();
  await expect(returns).toBeHidden();

  // Otra venta, y su devolución parcial.
  const returned = await sellInCash(vo, PRODUCT);
  await returnOneUnit(vo, returned, PRODUCT);

  // Ni comprobantes ni pedidos al servicio fiscal.
  expect(await ownerSql('SELECT id FROM comprobante')).toEqual([]);
  expect(await ownerSql("SELECT id FROM outbox WHERE tipo_evento LIKE 'comprobante%'")).toEqual([]);
  const states = await ownerSql<{ estado_fiscal: string }>(
    'SELECT DISTINCT estado_fiscal FROM venta WHERE estado_fiscal IS NOT NULL',
  );
  expect(states).toEqual([{ estado_fiscal: 'no_se_factura' }]);

  // Las funciones fiscales no se muestran: ni en el menú ni entrando por la dirección.
  const ac = await signIn(browser, USERS.ac);
  const menu = ac.getByRole('navigation', { name: 'Menú principal' });
  await expect(menu.getByText('Catálogo')).toBeVisible();
  await expect(menu.getByText('Comprobantes')).toHaveCount(0);
  await expect(menu.getByText('Configuración fiscal')).toHaveCount(0);

  await ac.goto('/admin/comprobantes');
  await expect(ac).toHaveURL(/\/admin$/);
  await ac.goto('/admin/parametros');
  await expect(ac.getByLabel('Inactividad del carrito (min)')).toBeVisible();
  await expect(ac.getByLabel('Política de facturación')).toHaveCount(0);
  await expect(ac.getByLabel('Facturación posterior (días)')).toHaveCount(0);
});
