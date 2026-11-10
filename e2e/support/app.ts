// Ayudas de las pruebas punta a punta: datos, sesiones y los pasos del POS que se repiten.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, request, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { API_URL, DATABASE, WEB_URL } from './env.js';

const ROOT = resolve(import.meta.dirname, '../..');

export const PASSWORD = 'Demo-2026!';
export const AS_PIN = '2222';
export const USERS = {
  sa: 'sa@demo.local',
  ac: 'ac@demo.local',
  as: 'as@demo.local',
  vo: 'vo@demo.local',
  voNorte: 'vo.norte@demo.local',
};
export const DEMO_TENANT = 'de000000-0000-4000-8000-000000000001';
export const PRODUCT = 'Agua mineral 500 ml';

const run = (command: string) => execSync(command, { cwd: ROOT, stdio: 'pipe' });

// Crea las tablas que falten. La pasada completa de `npm test` recrea el esquema de pos_test.
export function migrateDatabase(): void {
  run(`npx tsx apps/backend/scripts/db-migrate.ts up --db ${DATABASE}`);
}

// Deja pos_test con los datos de demostración, sin rastros de la prueba anterior.
export function resetData(): void {
  run('npx tsx apps/backend/test/support/e2e-reset.ts');
  run(`npx tsx apps/backend/scripts/db-seed.ts --db ${DATABASE}`);
}

function ownerConnection(): pg.ClientConfig {
  try {
    process.loadEnvFile(resolve(ROOT, '.env'));
  } catch {
    // Sin .env se usan las variables del entorno.
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? '5432'),
    database: DATABASE,
    user: 'pos_owner',
    password: process.env.DB_OWNER_PASSWORD ?? '',
  };
}

// Consulta como dueño de la base: solo para verificar lo que quedó guardado.
export async function ownerSql<R extends pg.QueryResultRow>(
  sql: string,
  values: unknown[] = [],
): Promise<R[]> {
  const client = new pg.Client(ownerConnection());
  await client.connect();
  try {
    return (await client.query<R>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

interface SignInOptions {
  // Para quien tiene más de un rol: el nombre que muestra la pantalla de elección.
  role?: string;
}

export async function signIn(
  browser: Browser,
  email: string,
  options: SignInOptions = {},
): Promise<Page> {
  const context = await browser.newContext({ baseURL: WEB_URL, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  if (options.role !== undefined) {
    await page.getByRole('button', { name: options.role }).click();
  }
  await page.waitForURL((url) => /\/(pos|admin)/.test(url.pathname));
  return page;
}

// Cliente de la API con la sesión de un usuario, para preparar lo que la prueba no ejercita.
export async function apiAs(email: string): Promise<APIRequestContext> {
  const anonymous = await request.newContext({ baseURL: API_URL, ignoreHTTPSErrors: true });
  const login = await anonymous.post('/auth/login', { data: { email, contrasena: PASSWORD } });
  expect(login.ok(), await login.text()).toBe(true);
  const { tokenAcceso } = (await login.json()) as { tokenAcceso: string };
  await anonymous.dispose();
  return request.newContext({
    baseURL: API_URL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: `Bearer ${tokenAcceso}` },
  });
}

export async function openShift(page: Page, initial: string): Promise<void> {
  await page.getByRole('button', { name: 'Abrir turno' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Saldo inicial').fill(initial);
  await dialog.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(page.getByText('Turno abierto', { exact: true })).toBeVisible();
}

export async function addProduct(page: Page, name: string): Promise<void> {
  const search = page.getByLabel('Buscar por nombre o código');
  await expect(search).toBeEnabled();
  await search.fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.getByRole('table', { name: 'Carrito' }).getByText(name)).toBeVisible();
}

export async function startSale(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nueva venta' }).click();
  await expect(page.getByLabel('Buscar por nombre o código')).toBeEnabled();
}

const moneyOf = (text: string) => {
  const digits = /[\d.,]+/.exec(text)?.[0] ?? '';
  return Number(digits.replace(/\./g, '').replace(',', '.'));
};

// Importe que muestra el diálogo de cobro («Total: $ 1.000,00»).
export async function dialogTotal(page: Page): Promise<number> {
  return moneyOf(
    await page
      .getByRole('dialog')
      .getByText(/^Total:/)
      .innerText(),
  );
}

// Cobra lo que queda en efectivo y devuelve el número del ticket.
export async function confirmSale(page: Page): Promise<number> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirmar venta' }).click();
  const title = page.getByRole('heading', { name: /Venta cobrada · Ticket \d+/ });
  await expect(title).toBeVisible();
  const ticket = Number(/Ticket (\d+)/.exec(await title.innerText())?.[1]);
  expect(ticket).toBeGreaterThan(0);
  return ticket;
}

export async function closeReceipt(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

// Vende una unidad en efectivo, de punta a punta, y devuelve el número del ticket.
export async function sellInCash(page: Page, product: string): Promise<number> {
  await startSale(page);
  await addProduct(page, product);
  await page.getByRole('button', { name: 'Cobrar' }).click();
  const ticket = await confirmSale(page);
  await closeReceipt(page);
  return ticket;
}

export async function authorizeWithPin(page: Page, pin: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Autorización con PIN' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('PIN').fill(pin);
  await dialog.getByRole('button', { name: 'Autorizar' }).click();
  await expect(dialog).toBeHidden();
}

// Busca un ticket en el diálogo de devoluciones del POS.
export async function findTicket(page: Page, ticket: number): Promise<void> {
  await page.getByRole('button', { name: 'Devolución o anulación' }).click();
  const dialog = page.getByRole('dialog', { name: 'Devolución o anulación' });
  await dialog.getByLabel('Número de ticket').fill(String(ticket));
  await dialog.getByRole('button', { name: 'Buscar' }).click();
  await expect(dialog.getByRole('table', { name: 'Ítems del ticket' })).toBeVisible();
}

// Devuelve una unidad y la autoriza con el PIN del AS.
export async function returnOneUnit(page: Page, ticket: number, product: string): Promise<void> {
  await findTicket(page, ticket);
  const dialog = page.getByRole('dialog', { name: 'Devolución o anulación' });
  await dialog.getByLabel(`Devolver ${product}`).fill('1');
  await dialog.getByRole('button', { name: 'Calcular reintegro' }).click();
  await dialog.getByRole('button', { name: 'Confirmar devolución' }).click();
  await authorizeWithPin(page, AS_PIN);
  await expect(dialog.getByText(/Devolución registrada/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await expect(dialog).toBeHidden();
}

export function testCertificate(): string {
  return readFileSync(resolve(ROOT, 'apps/backend/test/support/certificado-prueba.crt'), 'utf8');
}

export interface Traffic {
  // Todo lo recibido hasta ahora de la API y por el canal en vivo.
  received(): Promise<string[]>;
}

// Guarda cada respuesta de la API y cada mensaje en vivo que recibe una página.
export function recordTraffic(page: Page): Traffic {
  const bodies: Promise<string>[] = [];
  const frames: string[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(API_URL)) {
      bodies.push(response.text().catch(() => ''));
    }
  });
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      frames.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString());
    });
  });
  return { received: async () => [...(await Promise.all(bodies)), ...frames] };
}
