// Concurrencia de reservas (T-098; RF-057, RF-152, criterio 4 del spec): N reservas en paralelo
// contra M < N unidades terminan con exactamente M reservas y el disponible en cero.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import { BRANCH_CENTRO, seedIdentity, TENANT_A, USERS } from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const CATEGORY = 'a4000000-0000-4000-8000-000000000001';
const PRODUCT = 'a5000000-0000-4000-8000-000000000001';
const UNITS = 5;
const ATTEMPTS = 12;
const ROUNDS = 50;

beforeEach(async () => {
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Bebidas', 21, now())`,
    [CATEGORY, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, categoria_id, costo, creado_en)
     VALUES ($1, $2, 'simple', 'Agua', $3, 100, now())`,
    [PRODUCT, TENANT_A, CATEGORY],
  );
});

// Cada reserva en su propia transacción, como dos VO en dos POS.
const reserve = () =>
  api.db.run(
    () =>
      api.inventory.ledger.apply(
        { tenantId: TENANT_A, userId: USERS.vo.id, at: api.clock.now() },
        {
          branchId: BRANCH_CENTRO,
          product: { id: PRODUCT, name: 'Agua' },
          operation: 'reservar',
          quantity: '1',
        },
      ),
    { tenantId: TENANT_A },
  );

describe('[RF-057] [RF-152] reservas simultáneas', () => {
  it(`${String(ATTEMPTS)} reservas contra ${String(UNITS)} unidades, ${String(ROUNDS)} veces`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await ownerQuery('DELETE FROM movimiento_stock');
      await ownerQuery('DELETE FROM inventario');
      await ownerQuery(
        `INSERT INTO inventario (id, tenant_id, sucursal_id, producto_id, disponible, actualizado_en)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`,
        [TENANT_A, BRANCH_CENTRO, PRODUCT, UNITS],
      );

      const results = await Promise.allSettled(Array.from({ length: ATTEMPTS }, reserve));

      const granted = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter(
        (r) =>
          r.status === 'rejected' && (r.reason as { code?: string }).code === 'STOCK_INSUFICIENTE',
      ).length;
      expect({ round, granted, rejected }).toStrictEqual({
        round,
        granted: UNITS,
        rejected: ATTEMPTS - UNITS,
      });
      expect(await ownerSelect('SELECT disponible, reservado FROM inventario')).toStrictEqual([
        { disponible: '0.000', reservado: `${String(UNITS)}.000` },
      ]);
      expect(
        await ownerSelect<{ total: number }>(
          "SELECT count(*)::int AS total FROM movimiento_stock WHERE tipo = 'reserva'",
        ),
      ).toStrictEqual([{ total: UNITS }]);
    }
  }, 120_000);
});
