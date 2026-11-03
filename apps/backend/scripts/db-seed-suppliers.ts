// Proveedores de demostración (Fase 6), sin compras ni saldo: las compras se cargan desde la
// pantalla. Volver a ejecutarlo actualiza sus datos pero conserva su saldo.
import type pg from 'pg';

const SUPPLIERS = [
  {
    id: 'de000000-0000-4000-8000-000000070001',
    name: 'Distribuidora del Sur S.A.',
    cuit: '30712345671',
    contact: 'ventas@delsur.local · 11 4000-0001',
  },
  {
    id: 'de000000-0000-4000-8000-000000070002',
    name: 'Lácteos La Pradera S.R.L.',
    cuit: '30500000003',
    contact: 'pedidos@lapradera.local',
  },
] as const;

export async function seedSuppliers(
  client: pg.Client,
  tenantId: string,
  now: Date,
): Promise<{ suppliers: number }> {
  for (const s of SUPPLIERS) {
    await client.query(
      `INSERT INTO proveedor (id, tenant_id, razon_social, cuit, contacto, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET razon_social = EXCLUDED.razon_social, cuit = EXCLUDED.cuit,
         contacto = EXCLUDED.contacto, is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
      [s.id, tenantId, s.name, s.cuit, s.contact, now],
    );
  }
  return { suppliers: SUPPLIERS.length };
}
