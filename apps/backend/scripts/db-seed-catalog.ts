// Catálogo de demostración (T-084): categorías, unos 20 productos con código de barras, dos listas
// asignadas a las sucursales y un combo. Los precios se calculan con las mismas reglas del dominio.
import type pg from 'pg';
import { normalizeVatRate } from '../src/modulos/catalogo/dominio/catalog.js';
import {
  computePrice,
  normalizeRule,
  type PriceRule,
} from '../src/modulos/catalogo/dominio/price-rules.js';

const id = (prefix: string, n: number) =>
  `de000000-0000-4000-8000-000000${prefix}${String(n).padStart(4, '0')}`;

const CATEGORIES = [
  { id: id('01', 1), name: 'Bebidas', vat: '21' },
  { id: id('01', 2), name: 'Almacén', vat: '21' },
  { id: id('01', 3), name: 'Lácteos', vat: '10.5' },
  { id: id('01', 4), name: 'Limpieza', vat: '21' },
  { id: id('01', 5), name: 'Libros', vat: '0' },
] as const;

type CategoryName = (typeof CATEGORIES)[number]['name'];

// [nombre, categoría, costo sin IVA, código de barras]
const PRODUCTS: [string, CategoryName, string, string][] = [
  ['Agua mineral 500 ml', 'Bebidas', '420.00', '7790001000011'],
  ['Gaseosa cola 1,5 l', 'Bebidas', '1450.00', '7790001000028'],
  ['Jugo de naranja 1 l', 'Bebidas', '980.00', '7790001000035'],
  ['Cerveza rubia 473 ml', 'Bebidas', '1100.00', '7790001000042'],
  ['Café molido 250 g', 'Almacén', '3200.00', '7790002000010'],
  ['Yerba mate 1 kg', 'Almacén', '2900.00', '7790002000027'],
  ['Galletitas dulces 300 g', 'Almacén', '850.00', '7790002000034'],
  ['Arroz largo fino 1 kg', 'Almacén', '1250.00', '7790002000041'],
  ['Fideos tallarín 500 g', 'Almacén', '780.00', '7790002000058'],
  ['Aceite de girasol 900 ml', 'Almacén', '1900.00', '7790002000065'],
  ['Azúcar 1 kg', 'Almacén', '1050.00', '7790002000072'],
  ['Leche entera 1 l', 'Lácteos', '1050.00', '7790003000019'],
  ['Yogur bebible 1 l', 'Lácteos', '1600.00', '7790003000026'],
  ['Queso cremoso 1 kg', 'Lácteos', '7800.00', '7790003000033'],
  ['Manteca 200 g', 'Lácteos', '1700.00', '7790003000040'],
  ['Detergente 750 ml', 'Limpieza', '1350.00', '7790004000018'],
  ['Lavandina 1 l', 'Limpieza', '650.00', '7790004000025'],
  ['Esponja multiuso', 'Limpieza', '400.00', '7790004000032'],
  ['Novela de bolsillo', 'Libros', '6500.00', '9789870000011'],
  ['Libro de cocina', 'Libros', '12000.00', '9789870000028'],
];

const productId = (index: number) => id('02', index + 1);

// Productos simples del seed, para el stock de demostración.
export const SEED_PRODUCT_IDS = PRODUCTS.map((_, index) => productId(index));
const categoryId = (name: CategoryName) => CATEGORIES.find((c) => c.name === name)?.id ?? '';

const COMBO = {
  id: id('04', 1),
  name: 'Combo merienda',
  barcode: '7790009000016',
  price: '3500.00',
  // Leche entera ×1 y galletitas ×2.
  components: [
    { id: id('05', 1), productIndex: 11, quantity: '1' },
    { id: id('05', 2), productIndex: 6, quantity: '2' },
  ],
};

export async function seedCatalog(
  client: pg.Client,
  demo: { tenantId: string; branches: { centro: string; norte: string } },
  now: Date,
): Promise<{ products: number }> {
  const { tenantId } = demo;
  for (const c of CATEGORIES) {
    await client.query(
      `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, tasa_iva = EXCLUDED.tasa_iva,
         is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
      [c.id, tenantId, c.name, c.vat, now],
    );
  }
  for (const [index, [name, category, cost, barcode]] of PRODUCTS.entries()) {
    await client.query(
      `INSERT INTO producto (id, tenant_id, tipo, nombre, codigo_barras, categoria_id, costo, creado_en)
       VALUES ($1, $2, 'simple', $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, codigo_barras = EXCLUDED.codigo_barras,
         categoria_id = EXCLUDED.categoria_id, costo = EXCLUDED.costo,
         is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
      [productId(index), tenantId, name, barcode, categoryId(category), cost, now],
    );
  }
  await client.query(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, codigo_barras, precio_combo, creado_en)
     VALUES ($1, $2, 'combo', $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, precio_combo = EXCLUDED.precio_combo,
       is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
    [COMBO.id, tenantId, COMBO.name, COMBO.barcode, COMBO.price, now],
  );
  for (const component of COMBO.components) {
    await client.query(
      `INSERT INTO combo_componente (id, tenant_id, combo_id, producto_id, cantidad, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [
        component.id,
        tenantId,
        COMBO.id,
        productId(component.productIndex),
        component.quantity,
        now,
      ],
    );
  }

  const lists: { id: string; name: string; rule: PriceRule; branch: string }[] = [
    {
      id: id('03', 1),
      name: 'Minorista',
      rule: { type: 'porcentaje_costo', markupPct: '40' },
      branch: demo.branches.centro,
    },
    {
      id: id('03', 2),
      name: 'Mayorista',
      rule: {
        type: 'por_grupo',
        markupPct: '20',
        byCategory: { [categoryId('Bebidas')]: '15', [categoryId('Limpieza')]: '25' },
      },
      branch: demo.branches.norte,
    },
  ];
  for (const list of lists) {
    const rule = normalizeRule(list.rule);
    const parameters =
      rule.type === 'porcentaje_costo'
        ? { porcentaje: rule.markupPct }
        : rule.type === 'por_grupo'
          ? { porcentaje: rule.markupPct, porCategoria: rule.byCategory }
          : {};
    await client.query(
      `INSERT INTO lista_precio (id, tenant_id, nombre, regla, parametros, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, regla = EXCLUDED.regla,
         parametros = EXCLUDED.parametros, is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
      [list.id, tenantId, list.name, rule.type, parameters, now],
    );
    const prices: [string, string | null][] = PRODUCTS.map(([, category, cost], index) => [
      productId(index),
      computePrice(rule, {
        cost,
        categoryId: categoryId(category),
        vatRate: normalizeVatRate(CATEGORIES.find((c) => c.name === category)?.vat ?? '0'),
      }),
    ]);
    prices.push([COMBO.id, COMBO.price]);
    for (const [product, price] of prices) {
      await client.query(
        `INSERT INTO precio_lista (id, tenant_id, lista_id, producto_id, precio_final, calculado_en)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
         ON CONFLICT (lista_id, producto_id) DO UPDATE SET precio_final = EXCLUDED.precio_final,
           calculado_en = EXCLUDED.calculado_en`,
        [tenantId, list.id, product, price, now],
      );
    }
    await client.query(
      'UPDATE sucursal SET lista_precio_activa_id = $2 WHERE tenant_id = $1 AND id = $3',
      [tenantId, list.id, list.branch],
    );
  }
  // Lista de precio fijo, sin sucursal: sus precios se cargan a mano o desde Excel (RF-171).
  await client.query(
    `INSERT INTO lista_precio (id, tenant_id, nombre, regla, parametros, creado_en)
     VALUES ($1, $2, 'Precios especiales', 'fijo', '{}', $3)
     ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, regla = EXCLUDED.regla,
       parametros = EXCLUDED.parametros, is_active = true, desactivado_en = NULL, desactivado_por = NULL`,
    [id('03', 3), tenantId, now],
  );
  return { products: PRODUCTS.length };
}
