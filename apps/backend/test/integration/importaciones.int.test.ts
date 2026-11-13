// Carga desde Excel (T-290 a T-295; RF-170 a RF-174, D-98).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import readXlsxFile from 'read-excel-file/node';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import { seedIdentity, signIn, TENANT_A, USERS } from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BEBIDAS = 'a4000000-0000-4000-8000-000000000001';
const AGUA = 'a5000000-0000-4000-8000-000000000001';
const FIJA = 'a6000000-0000-4000-8000-000000000001';
const MINORISTA = 'a6000000-0000-4000-8000-000000000002';
const SUR = 'a8000000-0000-4000-8000-000000000001';

let ac: string;

beforeEach(async () => {
  api.clock.set('2026-11-13T12:00:00Z');
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en) VALUES ($1, $2, 'Bebidas', 21, now())`,
    [BEBIDAS, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, codigo_barras, categoria_id, costo, creado_en)
     VALUES ($1, $2, 'simple', 'Agua', '7790001', $3, 100, now())`,
    [AGUA, TENANT_A, BEBIDAS],
  );
  await ownerQuery(
    `INSERT INTO lista_precio (id, tenant_id, nombre, regla, parametros, creado_en) VALUES
       ($1, $3, 'Especiales', 'fijo', '{}', now()),
       ($2, $3, 'Minorista', 'porcentaje_costo', '{"porcentaje": "40"}', now())`,
    [FIJA, MINORISTA, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO proveedor (id, tenant_id, razon_social, cuit, saldo_adeudado, creado_en)
     VALUES ($1, $2, 'Sur', '30712345671', 5000, now())`,
    [SUR, TENANT_A],
  );
  ac = (await signIn(api.app, USERS.ac.email, 'AC')).authorization;
});

const book = async (rows: (string | number | null)[][]) =>
  writeXlsxFile(
    rows.map((row) => row.map((value) => (value === null ? null : { value }))),
  ).toBuffer();

const upload = (path: string, file: Buffer, token = ac) =>
  request(api.app).post(path).set('Authorization', token).set('Content-Type', XLSX).send(file);

interface Summary {
  creados: number;
  actualizados: number;
  rechazados: number;
  filas: { fila: number; clave: string; resultado: string; motivo: string | null }[];
}

describe('[RF-170] [RF-173] carga de productos', () => {
  const rows = [
    ['Código de barras', 'Nombre', 'Categoría', 'Costo sin IVA'],
    ['7790001', 'Agua mineral', 'Bebidas', 150],
    ['7790002', 'Gaseosa', 'bebidas', 300.5],
    ['7790003', 'Jamón', 'Fiambrería', 900],
    [null, 'Sin código', 'Bebidas', 10],
  ];

  it('la vista previa no escribe nada y la aplicación hace exactamente lo que anunció', async () => {
    const file = await book(rows);
    const preview = await upload('/importaciones/productos/vista-previa', file);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expectToMatchContract(preview, 'post', '/importaciones/productos/vista-previa');
    const announced = preview.body as Summary;
    expect(announced).toMatchObject({ creados: 1, actualizados: 1, rechazados: 2 });
    expect(announced.filas.map((f) => [f.fila, f.resultado])).toEqual([
      [2, 'actualizado'],
      [3, 'creado'],
      [4, 'error'],
      [5, 'error'],
    ]);
    expect(announced.filas[2]?.motivo).toMatch(/Fiambrería/);
    expect(
      await ownerSelect("SELECT nombre FROM producto WHERE codigo_barras = '7790002'"),
    ).toEqual([]);
    expect(await ownerSelect('SELECT id FROM auditoria_comercial')).toEqual([]);

    const applied = await upload('/importaciones/productos', file);
    expect(applied.status).toBe(200);
    expect(applied.body).toEqual(announced);
    expect(
      await ownerSelect<{ nombre: string; costo: string }>(
        'SELECT nombre, costo::text FROM producto ORDER BY codigo_barras',
      ),
    ).toEqual([
      { nombre: 'Agua mineral', costo: '150.00' },
      { nombre: 'Gaseosa', costo: '300.50' },
    ]);
    const audit = await ownerSelect<{ accion: string }>(
      "SELECT accion FROM auditoria_comercial WHERE entidad = 'carga_excel'",
    );
    expect(audit).toEqual([{ accion: 'carga_excel_productos' }]);
  });

  it('el AS no carga productos', async () => {
    const as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
    expect((await upload('/importaciones/productos', await book(rows), as)).status).toBe(403);
  });
});

describe('[RF-172] carga de proveedores', () => {
  it('identifica por CUIT, actualiza sin tocar el saldo y rechaza un CUIT inválido', async () => {
    const file = await book([
      ['CUIT', 'Razón social', 'Contacto'],
      ['30-71234567-1', 'Distribuidora del Sur', 'ventas@sur.com.ar'],
      ['30-70011223-9', 'Bebidas del Litoral', null],
      ['20-11111111-1', 'Mal escrito', null],
    ]);
    const applied = await upload('/importaciones/proveedores', file);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body).toMatchObject({ creados: 1, actualizados: 1, rechazados: 1 });
    expect(
      await ownerSelect<{ razon_social: string; saldo: string; contacto: string | null }>(
        'SELECT razon_social, saldo_adeudado::text AS saldo, contacto FROM proveedor ORDER BY cuit DESC',
      ),
    ).toEqual([
      { razon_social: 'Distribuidora del Sur', saldo: '5000.00', contacto: 'ventas@sur.com.ar' },
      { razon_social: 'Bebidas del Litoral', saldo: '0.00', contacto: null },
    ]);
  });
});

describe('[RF-171] carga de precios', () => {
  it('carga precios en una lista de precio fijo, con historial, y rechaza las otras listas', async () => {
    const file = await book([
      ['Lista', 'Código de barras', 'Precio final'],
      ['Especiales', '7790001', 650],
      ['Minorista', '7790001', 700],
      ['Especiales', '9999999', 100],
    ]);
    const applied = await upload('/importaciones/precios', file);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const summary = applied.body as Summary;
    expect(summary).toMatchObject({ creados: 1, actualizados: 0, rechazados: 2 });
    expect(summary.filas[1]?.motivo).toMatch(/precio fijo/);
    expect(
      await ownerSelect<{ precio: string }>(
        'SELECT precio_final::text AS precio FROM precio_lista WHERE lista_id = $1',
        [FIJA],
      ),
    ).toEqual([{ precio: '650.00' }]);
    expect(
      await ownerSelect<{ causa: string }>(
        'SELECT causa FROM historial_precio WHERE lista_id = $1',
        [FIJA],
      ),
    ).toEqual([{ causa: 'manual' }]);
  });
});

describe('[RF-173] [RF-174] plantillas y archivos inválidos', () => {
  it('la plantilla descargada tiene el encabezado de cada carga', async () => {
    const response = await request(api.app)
      .get('/importaciones/precios/plantilla')
      .set('Authorization', ac)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          done(null, Buffer.concat(chunks));
        });
      });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(XLSX);
    const sheets = await readXlsxFile(response.body as Buffer);
    expect(sheets[0]?.data).toEqual([['Lista', 'Código de barras', 'Precio final']]);
  });

  it('un archivo que no es un Excel se rechaza completo, sin cambiar nada', async () => {
    const response = await upload('/importaciones/productos', Buffer.from('codigo;nombre\n1;Agua'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ codigo: 'ARCHIVO_INVALIDO' });
  });

  it('la plantilla de otra carga se rechaza con su motivo', async () => {
    const wrong = await book([
      ['CUIT', 'Razón social', 'Contacto'],
      ['30-71234567-1', 'Sur', null],
    ]);
    const response = await upload('/importaciones/productos/vista-previa', wrong);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'PLANTILLA_INVALIDA' });
  });
});
