// T-244: venta con pago mixto y cierre ciego, mirando todo lo que llega al navegador del VO.
import { expect, test } from '@playwright/test';
import {
  addProduct,
  confirmSale,
  dialogTotal,
  closeReceipt,
  migrateDatabase,
  openShift,
  PRODUCT,
  recordTraffic,
  resetData,
  signIn,
  startSale,
  USERS,
} from './support/app.js';

test.beforeAll(migrateDatabase);
test.beforeEach(resetData);

const INITIAL = 1234;
const DEBIT_PART = 100;

test('[RF-068] [RF-093] [RF-112] el teórico del arqueo no viaja hacia el VO', async ({
  browser,
}) => {
  const vo = await signIn(browser, USERS.vo);
  const traffic = recordTraffic(vo);
  await openShift(vo, String(INITIAL));

  // Pago mixto: una parte con débito por la pasarela y el resto en efectivo.
  await startSale(vo);
  await addProduct(vo, PRODUCT);
  await vo.getByRole('button', { name: 'Cobrar' }).click();
  const dialog = vo.getByRole('dialog', { name: 'Cobrar la venta' });
  const total = await dialogTotal(vo);
  expect(total).toBeGreaterThan(DEBIT_PART);
  const debit = dialog.getByRole('textbox', { name: 'Débito' });
  await debit.fill(String(DEBIT_PART));
  await debit
    .locator('xpath=ancestor::div[contains(@class,"MuiStack-root")][1]')
    .getByRole('button', { name: 'Cobrar' })
    .click();
  await expect(dialog.getByText(/^Falta cobrar:/)).not.toHaveText(/Falta cobrar: \$\s*0,00/);

  await confirmSale(vo);
  const receipt = vo.getByRole('dialog');
  await expect(receipt.getByText(/^Débito:/)).toBeVisible();
  await expect(receipt.getByText(/^Efectivo:/)).toBeVisible();
  await closeReceipt(vo);

  // Cierre ciego: el VO declara lo que contó y no ve el resultado.
  const cash = total - DEBIT_PART;
  const theoretical = INITIAL + cash;
  const declared = theoretical - 50;
  await vo.getByRole('button', { name: 'Corte X' }).click();
  const closing = vo.getByRole('dialog', { name: 'Corte X' });
  await closing.getByLabel('Efectivo contado').fill(String(declared));
  await closing.getByRole('button', { name: 'Cerrar turno' }).click();

  const result = vo.getByRole('dialog', { name: 'Turno cerrado' });
  await expect(
    result.getByText('El resultado del arqueo lo ven el AS y el AC.', { exact: false }),
  ).toBeVisible();
  await expect(result.getByText(/Teórico/)).toHaveCount(0);
  await expect(result.getByText(/Diferencia/)).toHaveCount(0);
  await result.getByRole('button', { name: 'Listo' }).click();

  // Ni en pantalla ni en el tráfico: ninguna respuesta ni mensaje en vivo lo trae.
  const received = await traffic.received();
  expect(received.length).toBeGreaterThan(5);
  const leaks = received.filter(
    (body) =>
      /"teorico"|"diferencia"|"resultado"\s*:\s*"(cuadrado|sobrante|faltante)/.test(body) ||
      body.includes(`"${theoretical.toFixed(2)}"`),
  );
  expect(leaks).toEqual([]);
  await expect(vo.getByText(/Teórico/)).toHaveCount(0);

  // Testigo: el mismo arqueo sí llega al AS, con el teórico que el VO nunca recibió.
  const as = await signIn(browser, USERS.as, { role: 'Administrador de Sucursal' });
  const asTraffic = recordTraffic(as);
  await as.goto('/admin/caja');
  await as.getByRole('button', { name: 'Corte Z' }).first().click();
  const journey = as.getByRole('dialog', { name: /Corte Z/ });
  await journey.getByLabel('Efectivo total contado').fill(String(declared));
  await journey.getByRole('button', { name: 'Cerrar jornada' }).click();
  await expect(as.getByRole('dialog').getByText(/^Teórico:/)).toBeVisible();
  const seenByAs = await asTraffic.received();
  expect(seenByAs.some((body) => body.includes('"teorico"'))).toBe(true);
  expect(seenByAs.some((body) => body.includes(`"${theoretical.toFixed(2)}"`))).toBe(true);
});
