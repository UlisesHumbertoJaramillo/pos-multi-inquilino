// Datos de demostración para desarrollo (T-026). En pos_dev, o en pos_test con `--db pos_test` para
// las pruebas punta a punta; nunca en producción.
// Se puede volver a ejecutar: actualiza lo que ya existe. Las credenciales están en el README.
import { parseArgs } from 'node:util';
import pg from 'pg';
import { Argon2SecretHasher } from '../src/modulos/identidad/adaptadores/crypto.js';
import { DEFAULT_PARAMETERS as P } from '../src/modulos/organizacion/dominio/parameters.js';
import { seedCatalog } from './db-seed-catalog.js';
import { seedInventory } from './db-seed-inventory.js';
import { seedSuppliers } from './db-seed-suppliers.js';
import { isAllowedDatabase, ownerConnection } from './db/migrations.js';

const DEMO_PASSWORD = 'Demo-2026!';
const AS_DEMO_ID = 'de000000-0000-4000-8000-0000000000a2';
const NOW = new Date();

export const DEMO = {
  tenantId: 'de000000-0000-4000-8000-000000000001',
  branches: {
    centro: 'de000000-0000-4000-8000-0000000000c1',
    norte: 'de000000-0000-4000-8000-0000000000c2',
  },
};

// Sucursales con una caja cada una (T-068).
const BRANCHES = [
  {
    id: DEMO.branches.centro,
    name: 'Centro',
    address: 'San Martín 100',
    register: { id: 'de000000-0000-4000-8000-0000000000d1', name: 'Caja 1', pointOfSale: 1 },
  },
  {
    id: DEMO.branches.norte,
    name: 'Norte',
    address: 'Av. Belgrano 2500',
    register: { id: 'de000000-0000-4000-8000-0000000000d2', name: 'Caja 1', pointOfSale: 2 },
  },
];

const CUSTOMERS = [
  {
    id: 'de000000-0000-4000-8000-0000000000f1',
    name: 'Kiosco Don Pedro',
    document: '20-12345678-9',
    condition: 'monotributista',
    limit: '50000',
  },
  {
    id: 'de000000-0000-4000-8000-0000000000f2',
    name: 'Laura Gómez',
    document: '27-23456789-0',
    condition: 'consumidor_final',
    limit: '10000',
  },
];

const PAYMENT_METHODS = [
  { id: 'de000000-0000-4000-8000-0000000000e1', name: 'Efectivo', type: 'efectivo', pct: '0' },
  { id: 'de000000-0000-4000-8000-0000000000e2', name: 'Débito', type: 'electronico', pct: '0' },
  {
    id: 'de000000-0000-4000-8000-0000000000e3',
    name: 'Tarjeta de crédito',
    type: 'electronico',
    pct: '10',
  },
  {
    id: 'de000000-0000-4000-8000-0000000000e4',
    name: 'Cuenta corriente',
    type: 'cuenta_corriente',
    pct: '0',
  },
];

const DEMO_AC_ID = 'de000000-0000-4000-8000-0000000000a1';

interface DemoUser {
  id: string;
  email: string;
  name: string;
  tenant: boolean;
  validated: boolean;
  roles: { role: 'SA' | 'AC' | 'AS' | 'VO'; branch: string | null }[];
  pin?: string;
}

const USERS: DemoUser[] = [
  {
    id: 'de000000-0000-4000-8000-0000000000a0',
    email: 'sa@demo.local',
    name: 'Super Administrador',
    tenant: false,
    validated: true,
    roles: [{ role: 'SA', branch: null }],
  },
  {
    id: DEMO_AC_ID,
    email: 'ac@demo.local',
    name: 'Ana Comercio',
    tenant: true,
    validated: true,
    roles: [{ role: 'AC', branch: null }],
    pin: '1111',
  },
  {
    id: AS_DEMO_ID,
    email: 'as@demo.local',
    name: 'Sergio Sucursal',
    tenant: true,
    validated: true,
    // AS de Centro y de Norte, y también VO de Centro: para probar el cambio de rol, la
    // segregación y las transferencias entre las dos sucursales.
    roles: [
      { role: 'AS', branch: DEMO.branches.centro },
      { role: 'AS', branch: DEMO.branches.norte },
      { role: 'VO', branch: DEMO.branches.centro },
    ],
    pin: '2222',
  },
  {
    id: 'de000000-0000-4000-8000-0000000000a3',
    email: 'vo@demo.local',
    name: 'Valeria Vendedora',
    tenant: true,
    validated: true,
    roles: [{ role: 'VO', branch: DEMO.branches.centro }],
  },
  {
    id: 'de000000-0000-4000-8000-0000000000a4',
    email: 'vo.norte@demo.local',
    name: 'Victor Norte',
    tenant: true,
    validated: true,
    roles: [{ role: 'VO', branch: DEMO.branches.norte }],
  },
  {
    id: 'de000000-0000-4000-8000-0000000000a5',
    email: 'pendiente@demo.local',
    name: 'Pablo Pendiente',
    tenant: true,
    validated: false,
    roles: [{ role: 'VO', branch: DEMO.branches.centro }],
  },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed no se ejecuta en producción.');
  }
  const hasher = new Argon2SecretHasher();
  const { values } = parseArgs({ options: { db: { type: 'string', default: 'pos_dev' } } });
  if (!isAllowedDatabase(values.db)) throw new Error(`Base no permitida: ${values.db}.`);
  const client = new pg.Client(ownerConnection(values.db));
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO comercio (id, nombre, cuit, moneda, zona_horaria, estado, creado_en)
       VALUES ($1, 'Demo', '30-71234567-1', 'ARS', 'America/Argentina/Buenos_Aires', 'activo', $2)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, estado = 'activo'`,
      [DEMO.tenantId, NOW],
    );

    // Las sucursales existen antes que los roles AS y VO que apuntan a ellas.
    for (const branch of BRANCHES) {
      await client.query(
        `INSERT INTO sucursal (id, tenant_id, nombre, direccion, creado_en)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, direccion = EXCLUDED.direccion,
           is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
        [branch.id, DEMO.tenantId, branch.name, branch.address, NOW],
      );
      await client.query(
        `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, punto_venta_fiscal, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre,
           punto_venta_fiscal = EXCLUDED.punto_venta_fiscal,
           is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
        [
          branch.register.id,
          DEMO.tenantId,
          branch.id,
          branch.register.name,
          branch.register.pointOfSale,
          NOW,
        ],
      );
    }
    for (const method of PAYMENT_METHODS) {
      await client.query(
        `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, recargo_pct = EXCLUDED.recargo_pct,
           is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
        [method.id, DEMO.tenantId, method.name, method.type, method.pct, NOW],
      );
    }
    for (const customer of CUSTOMERS) {
      await client.query(
        `INSERT INTO cliente (id, tenant_id, razon_social, documento, condicion_fiscal,
           tiene_cuenta_corriente, limite_credito, creado_en)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          customer.id,
          DEMO.tenantId,
          customer.name,
          customer.document,
          customer.condition,
          customer.limit,
          NOW,
        ],
      );
    }
    // Los valores por defecto, guardados para que el AC los vea y los modifique.
    await client.query(
      `INSERT INTO parametro_comercio
         (tenant_id, inactividad_carrito_min, inactividad_sesion_min, plazo_regularizacion_horas,
          plazo_devolucion_dias, tolerancia_arqueo, politica_facturacion,
          plazo_facturacion_posterior_dias, actualizado_en, actualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [
        DEMO.tenantId,
        P.cartIdleMinutes,
        P.sessionIdleMinutes,
        P.fiscalRegularizationHours,
        P.returnWindowDays,
        P.cashCountTolerance,
        P.billingPolicy,
        P.laterInvoicingDays,
        NOW,
        DEMO_AC_ID,
      ],
    );

    const passwordHash = await hasher.hash(DEMO_PASSWORD);
    for (const user of USERS) {
      await client.query(
        `INSERT INTO usuario (id, tenant_id, email, nombre, email_validado, hash_contrasena, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, nombre = EXCLUDED.nombre,
           email_validado = EXCLUDED.email_validado, hash_contrasena = EXCLUDED.hash_contrasena,
           ultimo_rol_activo = NULL, is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
        [
          user.id,
          user.tenant ? DEMO.tenantId : null,
          user.email,
          user.name,
          user.validated,
          passwordHash,
          NOW,
        ],
      );
      for (const { role, branch } of user.roles) {
        await client.query(
          `INSERT INTO usuario_rol (id, usuario_id, rol, sucursal_id, creado_en)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           ON CONFLICT (usuario_id, rol, sucursal_id) WHERE is_active DO NOTHING`,
          [user.id, role, branch, NOW],
        );
      }
      if (user.pin !== undefined) {
        await client.query(
          `INSERT INTO credencial_autorizacion (id, tenant_id, usuario_id, hash_pin, actualizado_en)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           ON CONFLICT (usuario_id) DO UPDATE SET hash_pin = EXCLUDED.hash_pin,
                                                  actualizado_en = EXCLUDED.actualizado_en`,
          [DEMO.tenantId, user.id, await hasher.hash(user.pin), NOW],
        );
      }
    }
    const catalog = await seedCatalog(
      client,
      { tenantId: DEMO.tenantId, branches: DEMO.branches },
      NOW,
    );
    const stock = await seedInventory(
      client,
      { tenantId: DEMO.tenantId, branches: DEMO.branches, userId: AS_DEMO_ID },
      NOW,
    );
    const suppliers = await seedSuppliers(client, DEMO.tenantId, NOW);
    // Tope de cuota de descuento (Fase 8): sin él, el AS no puede asignar cuotas. Si el AC ya lo
    // cambió desde la pantalla, se conserva.
    await client.query(
      `INSERT INTO tope_cuota (tenant_id, pct_max_venta, monto_max, actualizado_en, actualizado_por)
       VALUES ($1, 15, 20000, $2, $3) ON CONFLICT (tenant_id) DO NOTHING`,
      [DEMO.tenantId, NOW, DEMO_AC_ID],
    );
    // Los intentos fallidos de pruebas anteriores no deben dejar bloqueadas las cuentas demo.
    await client.query("DELETE FROM intento_acceso WHERE identificador LIKE '%@demo.local'");
    await client.query('COMMIT');
    console.log(
      `Datos de demostración cargados: comercio Demo, ${String(BRANCHES.length)} sucursales, ${String(USERS.length)} usuarios y ${String(catalog.products)} productos con stock en ${String(stock.rows)} saldos y ${String(suppliers.suppliers)} proveedores.`,
    );
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  console.log('Las credenciales están en el README (sección "Usuarios de demostración").');
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
