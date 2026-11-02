// Comercio, usuarios y roles (T-024).
import { beforeEach, describe, expect, it } from 'vitest';
import { ownerQuery } from '../support/database.js';
import { seedIdentity, USERS } from '../support/identity-fixtures.js';

async function assignRole(userId: string, role: string, branchId: string | null = null) {
  await ownerQuery(
    `INSERT INTO usuario_rol (id, usuario_id, rol, sucursal_id, creado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, now())`,
    [userId, role, branchId],
  );
}

describe('[RF-012] el rol SA no se combina con roles de un comercio', () => {
  beforeEach(seedIdentity);

  it('la base rechaza asignarle a un SA el rol AC', async () => {
    await expect(assignRole(USERS.sa.id, 'AC')).rejects.toMatchObject({
      code: '23514',
      constraint: 'usuario_rol_sa_exclusivo',
    });
  });

  it('la base rechaza asignarle el rol SA a un usuario de un comercio', async () => {
    await expect(assignRole(USERS.ac.id, 'SA')).rejects.toMatchObject({
      code: '23514',
      constraint: 'usuario_rol_sa_exclusivo',
    });
  });

  it('un usuario con roles de comercio no puede quedar sin comercio', async () => {
    await expect(
      ownerQuery('UPDATE usuario SET tenant_id = NULL WHERE id = $1', [USERS.ac.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('AS y VO exigen una sucursal, y AC no lleva', async () => {
    await expect(assignRole(USERS.vo.id, 'AS')).rejects.toMatchObject({
      constraint: 'usuario_rol_sucursal',
    });
    await expect(
      assignRole(USERS.vo.id, 'AC', 'a1000000-0000-4000-8000-000000000001'),
    ).rejects.toMatchObject({ constraint: 'usuario_rol_sucursal' });
  });

  it('el correo es único y se guarda en minúsculas', async () => {
    await expect(
      ownerQuery(
        `INSERT INTO usuario (id, tenant_id, email, nombre, hash_contrasena, creado_en)
         VALUES (gen_random_uuid(), NULL, 'Mayus@Prueba.local', 'X', 'h', now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
