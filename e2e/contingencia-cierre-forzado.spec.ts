// T-246: el servicio fiscal se cae, se vende con CAEA, se recupera y la cola se informa. Después, el
// AS fuerza el cierre del turno de un vendedor con una venta en curso.
import { expect, test, type Page } from '@playwright/test';
import {
  addProduct,
  apiAs,
  DEMO_TENANT,
  migrateDatabase,
  openShift,
  ownerSql,
  PRODUCT,
  resetData,
  sellInCash,
  signIn,
  startSale,
  testCertificate,
  USERS,
} from './support/app.js';

test.beforeAll(migrateDatabase);
test.beforeEach(resetData);

async function activateFiscalModule(): Promise<void> {
  const sa = await apiAs(USERS.sa);
  const activation = await sa.put(`/plataforma/comercios/${DEMO_TENANT}/modulo-facturacion`, {
    data: { activo: true },
  });
  expect(activation.ok(), await activation.text()).toBe(true);
  await sa.dispose();

  const ac = await apiAs(USERS.ac);
  const credential = await ac.put('/fiscal/credencial', {
    data: {
      cuit: '20-12345678-9',
      condicionFiscal: 'responsable_inscripto',
      certificado: testCertificate(),
      clave: 'clave-de-prueba',
    },
  });
  expect(credential.ok(), await credential.text()).toBe(true);
  await ac.dispose();
}

async function setFiscalSimulator(page: Page, mode: 'Acepta' | 'Caído'): Promise<void> {
  await page.goto('/dev/simuladores');
  const group = page.getByRole('radiogroup', { name: 'Modo del simulador de ARCA' });
  await group.getByRole('radio', { name: mode }).click();
  await expect(group.getByRole('radio', { name: mode })).toBeChecked();
}

// Los reintentos de la cola esperan minutos: la prueba adelanta esa espera.
const skipRetryWait = () =>
  ownerSql("UPDATE comprobante SET proximo_intento = now() WHERE estado = 'pendiente'");

async function expectVoucherState(page: Page, ticket: number, state: string): Promise<void> {
  await expect(async () => {
    await skipRetryWait();
    await page.goto('/admin/comprobantes');
    const row = page
      .getByRole('table', { name: 'Comprobantes' })
      .getByRole('row')
      .filter({ hasText: new RegExp(`\\b${String(ticket)}\\b`) });
    await expect(row.getByText(state, { exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000, intervals: [2_000] });
}

test('[RF-101] [RF-115] contingencia con CAEA, recuperación y cierre forzado', async ({
  browser,
}) => {
  await activateFiscalModule();
  // El worker pide el CAEA del período mientras el servicio responde.
  await expect
    .poll(async () => (await ownerSql('SELECT id FROM caea')).length, { timeout: 30_000 })
    .toBeGreaterThan(0);

  const ac = await signIn(browser, USERS.ac);
  const vo = await signIn(browser, USERS.vo);
  await openShift(vo, '2000');

  // Con el servicio caído la venta se confirma igual y sale con CAEA.
  await setFiscalSimulator(ac, 'Caído');
  const ticket = await sellInCash(vo, PRODUCT);
  await expectVoucherState(ac, ticket, 'Con CAEA, por informar');

  // Al volver el servicio, la cola se informa sola.
  await setFiscalSimulator(ac, 'Acepta');
  await expectVoucherState(ac, ticket, 'Emitido');

  const voucher = await ownerSql<{ contingencia: boolean; caea_codigo: string | null }>(
    'SELECT contingencia, caea_codigo FROM comprobante',
  );
  expect(voucher).toHaveLength(1);
  expect(voucher[0]?.contingencia).toBe(true);
  expect(voucher[0]?.caea_codigo).not.toBeNull();

  // El vendedor deja una venta a medias y el AS le cierra el turno.
  await startSale(vo);
  await addProduct(vo, PRODUCT);

  const as = await signIn(browser, USERS.as, { role: 'Administrador de Sucursal' });
  await as.goto('/admin/caja');
  const shifts = as.getByRole('table', { name: 'Turnos abiertos' });
  await shifts.getByRole('button', { name: 'Forzar cierre' }).click();
  const force = as.getByRole('dialog', { name: /Forzar el cierre del turno/ });
  await force.getByLabel('Efectivo contado').fill('2000');
  await force.getByRole('button', { name: 'Forzar cierre' }).click();
  await expect(as.getByRole('dialog').getByText(/^Teórico:/)).toBeVisible();
  await as.getByRole('dialog').getByRole('button', { name: 'Listo' }).click();
  await expect(as.getByText('No hay turnos abiertos en la sucursal.')).toBeVisible();

  // La venta en curso se descartó y el vendedor ya no tiene turno.
  const inProgress = await ownerSql("SELECT id FROM venta WHERE estado_comercial = 'en_curso'");
  expect(inProgress).toEqual([]);
  await vo.reload();
  await expect(vo.getByText('Elegí una caja para abrir tu turno.')).toBeVisible();
});
