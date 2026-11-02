// Datos de demostración para desarrollo (T-026). Solo en pos_dev; nunca en producción.
// Se puede volver a ejecutar: actualiza lo que ya existe. Las credenciales están en el README.
import pg from 'pg';
import { Argon2SecretHasher } from '../src/modulos/identidad/adaptadores/crypto.js';
import { ownerConnection } from './db/migrations.js';

const DEMO_PASSWORD = 'Demo-2026!';
const NOW = new Date();

export const DEMO = {
  tenantId: 'de000000-0000-4000-8000-000000000001',
  branches: {
    centro: 'de000000-0000-4000-8000-0000000000c1',
    norte: 'de000000-0000-4000-8000-0000000000c2',
  },
};

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
    id: 'de000000-0000-4000-8000-0000000000a1',
    email: 'ac@demo.local',
    name: 'Ana Comercio',
    tenant: true,
    validated: true,
    roles: [{ role: 'AC', branch: null }],
    pin: '1111',
  },
  {
    id: 'de000000-0000-4000-8000-0000000000a2',
    email: 'as@demo.local',
    name: 'Sergio Sucursal',
    tenant: true,
    validated: true,
    // AS de Centro y también VO de Centro: para probar el cambio de rol y la segregación.
    roles: [
      { role: 'AS', branch: DEMO.branches.centro },
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
  const client = new pg.Client(ownerConnection('pos_dev'));
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO comercio (id, nombre, cuit, moneda, zona_horaria, estado, creado_en)
       VALUES ($1, 'Demo', '30-71234567-8', 'ARS', 'America/Argentina/Buenos_Aires', 'activo', $2)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, estado = 'activo'`,
      [DEMO.tenantId, NOW],
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
           ON CONFLICT (usuario_id, rol, sucursal_id) DO NOTHING`,
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
    // Los intentos fallidos de pruebas anteriores no deben dejar bloqueadas las cuentas demo.
    await client.query("DELETE FROM intento_acceso WHERE identificador LIKE '%@demo.local'");
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  console.log(`Datos de demostración cargados: comercio Demo y ${String(USERS.length)} usuarios.`);
  console.log('Las credenciales están en el README (sección "Usuarios de demostración").');
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
