// Datos de identidad para las pruebas: dos comercios y un usuario por cada caso.
// Se cargan como pos_owner, porque la aplicación todavía no tiene casos de uso de alta (E2).
import type { ActiveRoleChange, Role, SessionTokens } from '@pos/contracts';
import type { Express } from 'express';
import request from 'supertest';
import { FAST_HASHER } from './app.js';
import { ownerQuery } from './database.js';

export const TENANT_A = 'a0000000-0000-4000-8000-00000000000a';
export const TENANT_B = 'b0000000-0000-4000-8000-00000000000b';
export const BRANCH_CENTRO = 'a1000000-0000-4000-8000-000000000001';
export const BRANCH_NORTE = 'a1000000-0000-4000-8000-000000000002';
export const BRANCH_B = 'b1000000-0000-4000-8000-000000000001';

export const PASSWORD = 'Clave-de-prueba-1';
export const PIN = '4321';

export const USERS = {
  sa: { id: '00000000-0000-4000-8000-0000000000aa', email: 'sa@prueba.local' },
  ac: { id: 'a0000000-0000-4000-8000-0000000000ac', email: 'ac@prueba.local' },
  // AS de Centro y Norte, y también VO de Centro: sirve para el cambio de rol y la segregación.
  asVo: { id: 'a0000000-0000-4000-8000-0000000000a5', email: 'as@prueba.local' },
  vo: { id: 'a0000000-0000-4000-8000-0000000000f0', email: 'vo@prueba.local' },
  // AS solo de Norte: no puede autorizar en Centro.
  asNorte: { id: 'a0000000-0000-4000-8000-0000000000a6', email: 'as.norte@prueba.local' },
  voB: { id: 'b0000000-0000-4000-8000-0000000000f0', email: 'vo@otro.local' },
  acB: { id: 'b0000000-0000-4000-8000-0000000000ac', email: 'ac@otro.local' },
  asB: { id: 'b0000000-0000-4000-8000-0000000000a5', email: 'as@otro.local' },
  pendiente: { id: 'a0000000-0000-4000-8000-0000000000e0', email: 'pendiente@prueba.local' },
} as const;

let passwordHash: Promise<string> | undefined;
let pinHash: Promise<string> | undefined;

const CREATED_AT = '2026-11-01T00:00:00Z';

export async function seedIdentity(): Promise<void> {
  passwordHash ??= FAST_HASHER.hash(PASSWORD);
  pinHash ??= FAST_HASHER.hash(PIN);
  const hash = await passwordHash;

  await ownerQuery(
    `INSERT INTO comercio (id, nombre, moneda, zona_horaria, creado_en) VALUES
       ($1, 'Comercio A', 'ARS', 'America/Argentina/Buenos_Aires', $3),
       ($2, 'Comercio B', 'ARS', 'America/Argentina/Buenos_Aires', $3)`,
    [TENANT_A, TENANT_B, CREATED_AT],
  );

  // Las sucursales existen antes que los roles AS y VO que apuntan a ellas.
  await ownerQuery(
    `INSERT INTO sucursal (id, tenant_id, nombre, creado_en) VALUES
       ($1, $4, 'Centro', $6), ($2, $4, 'Norte', $6), ($3, $5, 'Única', $6)`,
    [BRANCH_CENTRO, BRANCH_NORTE, BRANCH_B, TENANT_A, TENANT_B, CREATED_AT],
  );

  const users: [string, string | null, string, string, boolean][] = [
    [USERS.sa.id, null, USERS.sa.email, 'Super Admin', true],
    [USERS.ac.id, TENANT_A, USERS.ac.email, 'Admin Comercio', true],
    [USERS.asVo.id, TENANT_A, USERS.asVo.email, 'Admin Sucursal', true],
    [USERS.vo.id, TENANT_A, USERS.vo.email, 'Vendedor', true],
    [USERS.asNorte.id, TENANT_A, USERS.asNorte.email, 'Admin Norte', true],
    [USERS.voB.id, TENANT_B, USERS.voB.email, 'Vendedor B', true],
    [USERS.acB.id, TENANT_B, USERS.acB.email, 'Admin Comercio B', true],
    [USERS.pendiente.id, TENANT_A, USERS.pendiente.email, 'Pendiente', false],
    [USERS.asB.id, TENANT_B, USERS.asB.email, 'Admin Sucursal B', true],
  ];
  for (const [id, tenant, email, name, validated] of users) {
    await ownerQuery(
      `INSERT INTO usuario (id, tenant_id, email, nombre, email_validado, hash_contrasena, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, tenant, email, name, validated, hash, CREATED_AT],
    );
  }

  const roles: [string, string, string | null][] = [
    [USERS.sa.id, 'SA', null],
    [USERS.ac.id, 'AC', null],
    [USERS.asVo.id, 'AS', BRANCH_CENTRO],
    [USERS.asVo.id, 'AS', BRANCH_NORTE],
    [USERS.asVo.id, 'VO', BRANCH_CENTRO],
    [USERS.vo.id, 'VO', BRANCH_CENTRO],
    [USERS.asNorte.id, 'AS', BRANCH_NORTE],
    [USERS.voB.id, 'VO', BRANCH_B],
    [USERS.acB.id, 'AC', null],
    [USERS.pendiente.id, 'VO', BRANCH_CENTRO],
    [USERS.asB.id, 'AS', BRANCH_B],
  ];
  for (const [index, [userId, role, branch]] of roles.entries()) {
    await ownerQuery(
      `INSERT INTO usuario_rol (id, usuario_id, rol, sucursal_id, creado_en)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        userId,
        role,
        branch,
        CREATED_AT,
      ],
    );
  }

  const pin = await pinHash;
  for (const [index, userId] of [USERS.ac.id, USERS.asVo.id, USERS.asNorte.id].entries()) {
    await ownerQuery(
      `INSERT INTO credencial_autorizacion (id, tenant_id, usuario_id, hash_pin, actualizado_en)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        TENANT_A,
        userId,
        pin,
        CREATED_AT,
      ],
    );
  }
}

export interface SignedIn {
  authorization: string;
  refreshToken: string;
  session: SessionTokens;
}

// Inicia sesión con un usuario de prueba y, si se indica, activa ese rol.
export async function signIn(app: Express, email: string, role?: Role): Promise<SignedIn> {
  const login = await request(app).post('/auth/login').send({ email, contrasena: PASSWORD });
  if (login.status !== 200) {
    throw new Error(`No se pudo iniciar sesión con ${email}: ${String(login.status)}`);
  }
  const session = login.body as SessionTokens;
  let accessToken = session.tokenAcceso;
  if (role !== undefined && session.usuario.rolActivo !== role) {
    const change = await request(app)
      .put('/auth/rol-activo')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ rol: role });
    accessToken = (change.body as ActiveRoleChange).tokenAcceso;
  }
  return { authorization: `Bearer ${accessToken}`, refreshToken: session.tokenRenovacion, session };
}
