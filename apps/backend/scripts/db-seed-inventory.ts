// Stock de demostración (T-099): saldo inicial de cada producto en las dos sucursales y umbrales
// mínimos. Cada saldo deja su movimiento de ingreso, como si se hubiera cargado desde la pantalla.
// Volver a ejecutarlo restablece el stock inicial.
import type pg from 'pg';
import { SEED_PRODUCT_IDS } from './db-seed-catalog.js';

const movementId = (branch: number, index: number) =>
  `de000000-0000-4000-8000-0000006${String(branch)}${String(index + 1).padStart(4, '0')}`;

// Centro tiene más stock que Norte; algunos productos de Norte quedan cerca de su umbral.
const centro = (index: number) => 20 + ((index * 7) % 41);
const norte = (index: number) => 6 + ((index * 5) % 19);
const MINIMUM = { centro: '10', norte: '8' };

export async function seedInventory(
  client: pg.Client,
  demo: { tenantId: string; branches: { centro: string; norte: string }; userId: string },
  now: Date,
): Promise<{ rows: number }> {
  const branches = [
    { n: 1, id: demo.branches.centro, quantity: centro, minimum: MINIMUM.centro },
    { n: 2, id: demo.branches.norte, quantity: norte, minimum: MINIMUM.norte },
  ];
  let rows = 0;
  for (const branch of branches) {
    for (const [index, productId] of SEED_PRODUCT_IDS.entries()) {
      const quantity = String(branch.quantity(index));
      await client.query(
        `INSERT INTO inventario (id, tenant_id, sucursal_id, producto_id, disponible, umbral_minimo,
           actualizado_en)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
         ON CONFLICT (sucursal_id, producto_id) DO UPDATE
           SET disponible = EXCLUDED.disponible, reservado = 0, en_revision = 0, en_transito = 0,
               umbral_minimo = EXCLUDED.umbral_minimo, alerta_activa = false,
               actualizado_en = EXCLUDED.actualizado_en`,
        [demo.tenantId, branch.id, productId, quantity, branch.minimum, now],
      );
      await client.query(
        `INSERT INTO movimiento_stock (id, tenant_id, sucursal_id, producto_id, tipo, estado_destino,
           cantidad, motivo, usuario_id, momento)
         VALUES ($1, $2, $3, $4, 'ingreso', 'disponible', $5, 'Stock inicial de demostración', $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          movementId(branch.n, index),
          demo.tenantId,
          branch.id,
          productId,
          quantity,
          demo.userId,
          now,
        ],
      );
      rows++;
    }
  }
  return { rows };
}
