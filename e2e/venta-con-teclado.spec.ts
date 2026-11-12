// T-282: ventas completas solo con el teclado, con la mano derecha y sin clics antes del primer
// producto (RF-175, RF-176, RF-182; criterio 14 del spec).
import { expect, test, type Page } from '@playwright/test';
import { migrateDatabase, PASSWORD, PRODUCT, resetData, USERS } from './support/app.js';
import { WEB_URL } from './support/env.js';

test.beforeAll(migrateDatabase);
test.beforeEach(resetData);

// Mitad derecha del teclado: el numérico, el bloque de edición, las flechas, Enter y las teclas de
// función de la derecha. Las letras y los números del nombre o del importe son datos.
const RIGHT_HAND_KEYS = new Set([
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'Enter',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'F8',
  'F9',
]);

// Solo teclas sueltas: ninguna combinación que requiera las dos manos.
function keyboardOnly(page: Page) {
  const pressed: string[] = [];
  return {
    pressed,
    press: async (key: string) => {
      expect(RIGHT_HAND_KEYS.has(key), key).toBe(true);
      pressed.push(key);
      await page.keyboard.press(key);
    },
    type: (text: string) => page.keyboard.type(text),
  };
}

test('[RF-175] [RF-176] [RF-182] venta en efectivo y con pago mixto solo con el teclado', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: WEB_URL, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  let clicks = 0;
  await page.exposeFunction('contarClic', () => {
    clicks += 1;
  });
  await page.addInitScript(() => {
    window.addEventListener(
      'click',
      (event) => {
        // Los clics de verdad tienen coordenadas; los que genera Enter sobre un botón, no.
        if (event.detail > 0) (window as unknown as { contarClic: () => void }).contarClic();
      },
      true,
    );
  });
  const keys = keyboardOnly(page);

  // Ingreso con el teclado.
  await page.goto('/login');
  await page.getByLabel('Correo').fill(USERS.vo);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await keys.press('Enter');
  await page.waitForURL(/\/pos/);

  // La única caja libre se propone: solo se escribe el saldo inicial.
  const open = page.getByRole('dialog', { name: /Abrir turno/ });
  await expect(open).toBeVisible();
  await keys.type('1000');
  await keys.press('Enter');

  // La búsqueda queda lista: 2 * producto, Enter, + para cobrar y Enter para confirmar en efectivo.
  const search = page.getByLabel('Buscar por nombre o código');
  await expect(search).toBeFocused();
  await keys.type('2');
  await keys.press('NumpadMultiply');
  await expect(page.getByTestId('cantidad-pendiente')).toContainText('2');
  await keys.type(PRODUCT);
  await expect(page.getByRole('option', { name: new RegExp(PRODUCT) })).toBeVisible();
  await keys.press('Enter');
  const cart = page.getByRole('table', { name: 'Carrito' });
  await expect(cart.getByText(PRODUCT)).toBeVisible();
  await expect(cart.getByText('2', { exact: true })).toBeVisible();

  await keys.press('NumpadAdd');
  const payment = page.getByRole('dialog', { name: 'Cobrar la venta' });
  await expect(payment.getByLabel('Efectivo')).toBeFocused();
  await keys.press('Enter');
  const receipt = page.getByRole('dialog', { name: /Venta cobrada · Ticket/ });
  await expect(receipt).toBeVisible();
  await keys.press('Enter');
  await expect(receipt).toBeHidden();

  // Pago mixto: una parte con débito (flechas hasta el débito, importe y Enter) y el resto en
  // efectivo (Enter).
  await expect(search).toBeFocused();
  await keys.type(PRODUCT);
  await expect(page.getByRole('option', { name: new RegExp(PRODUCT) })).toBeVisible();
  await keys.press('Enter');
  await expect(cart.getByText(PRODUCT)).toBeVisible();
  await keys.press('NumpadAdd');
  await expect(payment.getByLabel('Efectivo')).toBeFocused();
  await keys.press('ArrowUp');
  await keys.press('ArrowUp');
  await expect(payment.getByLabel('Débito')).toBeFocused();
  await keys.type('100');
  await keys.press('Enter');
  await expect(payment.getByLabel('Efectivo')).toBeFocused();
  await keys.press('Enter');
  await expect(receipt.getByText(/^Débito:/)).toBeVisible();
  await expect(receipt.getByText(/^Efectivo:/)).toBeVisible();
  await keys.press('Enter');
  await expect(receipt).toBeHidden();

  expect(clicks).toBe(0);
  expect(keys.pressed.length).toBeGreaterThan(10);
  await context.close();
});
