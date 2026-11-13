// El dashboard en dos niveles queda dentro de la pantalla (T-287; RF-186, RF-192): ni las gráficas ni
// sus textos alternativos ensanchan o alargan la página.
import { expect, test, type Page } from '@playwright/test';
import {
  migrateDatabase,
  openShift,
  PRODUCT,
  resetData,
  sellInCash,
  signIn,
  USERS,
} from './support/app.js';

test.beforeAll(migrateDatabase);
test.beforeEach(resetData);

// Cuánto se puede desplazar la página más allá de su contenido visible.
async function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector('main');
    const contentBottom = (main?.getBoundingClientRect().bottom ?? 0) + window.scrollY;
    return {
      right: root.scrollWidth - root.clientWidth,
      below: root.scrollHeight - Math.max(root.clientHeight, contentBottom),
    };
  });
}

test('[RF-186] el dashboard no se desborda ni a la derecha ni hacia abajo', async ({ browser }) => {
  const vo = await signIn(browser, USERS.vo);
  await openShift(vo, '1000');
  await sellInCash(vo, PRODUCT);
  await vo.context().close();

  const ac = await signIn(browser, USERS.ac);
  for (const size of [
    { width: 1366, height: 860 },
    { width: 390, height: 844 },
  ]) {
    await ac.setViewportSize(size);
    await ac.goto('/admin/dashboard');
    await expect(ac.getByLabel('Ventas por día')).toBeVisible();
    await expect(ac.getByLabel('Los 5 más vendidos')).toBeVisible();
    const extra = await overflow(ac);
    expect(extra.right, `a la derecha con ${String(size.width)} px`).toBeLessThanOrEqual(0);
    // Solo el margen inferior de la página.
    expect(extra.below, `hacia abajo con ${String(size.width)} px`).toBeLessThanOrEqual(32);
  }
});
