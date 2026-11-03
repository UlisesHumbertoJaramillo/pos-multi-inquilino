// Repositorios PostgreSQL del módulo de catálogo. Tablas aisladas por comercio: se usan dentro de
// una unidad de trabajo con el comercio fijado, y además cada consulta filtra por comercio.
import { randomUUID } from 'node:crypto';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { Category, ImageType, Product, ProductType } from '../dominio/catalog.js';
import type { ComboComponent } from '../dominio/combos.js';
import type { PriceRule, PriceRuleType } from '../dominio/price-rules.js';
import type {
  BranchPriceList,
  BranchPriceLists,
  CategoryRepository,
  ComboRepository,
  ComponentRow,
  ListPrice,
  PriceChangeCause,
  PriceList,
  PriceListRepository,
  PriceRepository,
  ProductRepository,
} from '../aplicacion/ports.js';

const deactivateSql = (table: string) =>
  `UPDATE ${table} SET is_active = false, desactivado_en = $3, desactivado_por = $4
    WHERE tenant_id = $1 AND id = $2 AND is_active`;

interface CategoryRow {
  id: string;
  tenant_id: string;
  nombre: string;
  tasa_iva: string;
  is_active: boolean;
}

const toCategory = (row: CategoryRow): Category => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.nombre,
  vatRate: row.tasa_iva,
  isActive: row.is_active,
});

export class PgCategoryRepository implements CategoryRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<Category[]> {
    const result = await this.db.query<CategoryRow>(
      `SELECT id, tenant_id, nombre, tasa_iva, is_active FROM categoria
        WHERE tenant_id = $1 AND ($2 OR is_active) ORDER BY nombre`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toCategory);
  }

  async findById(tenantId: string, id: string): Promise<Category | undefined> {
    const result = await this.db.query<CategoryRow>(
      'SELECT id, tenant_id, nombre, tasa_iva, is_active FROM categoria WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toCategory(row) : undefined;
  }

  async insert(c: Category, at: Date): Promise<void> {
    await this.db.query(
      'INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en) VALUES ($1, $2, $3, $4, $5)',
      [c.id, c.tenantId, c.name, c.vatRate, at],
    );
  }

  async update(c: Category): Promise<void> {
    await this.db.query(
      'UPDATE categoria SET nombre = $3, tasa_iva = $4 WHERE tenant_id = $1 AND id = $2',
      [c.tenantId, c.id, c.name, c.vatRate],
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(deactivateSql('categoria'), [tenantId, id, at, by]);
  }

  async hasActiveProducts(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db.query<{ used: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM producto
                       WHERE tenant_id = $1 AND categoria_id = $2 AND is_active) AS used`,
      [tenantId, id],
    );
    return result.rows[0]?.used === true;
  }
}

interface ProductRow {
  id: string;
  tenant_id: string;
  tipo: ProductType;
  nombre: string;
  codigo_barras: string | null;
  categoria_id: string | null;
  costo: string | null;
  precio_combo: string | null;
  is_active: boolean;
  tiene_imagen: boolean;
}

const toProduct = (row: ProductRow): Product => ({
  id: row.id,
  tenantId: row.tenant_id,
  type: row.tipo,
  name: row.nombre,
  barcode: row.codigo_barras,
  categoryId: row.categoria_id,
  cost: row.costo,
  comboPrice: row.precio_combo,
  isActive: row.is_active,
  hasImage: row.tiene_imagen,
});

const PRODUCT_SELECT = `
  SELECT p.id, p.tenant_id, p.tipo, p.nombre, p.codigo_barras, p.categoria_id, p.costo,
         p.precio_combo, p.is_active, (i.producto_id IS NOT NULL) AS tiene_imagen
    FROM producto p
    LEFT JOIN producto_imagen i ON i.producto_id = p.id`;

export class PgProductRepository implements ProductRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<Product[]> {
    const result = await this.db.query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.tenant_id = $1 AND ($2 OR p.is_active) ORDER BY p.nombre`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toProduct);
  }

  async findById(tenantId: string, id: string): Promise<Product | undefined> {
    const result = await this.db.query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toProduct(row) : undefined;
  }

  async findMany(tenantId: string, ids: readonly string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const result = await this.db.query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return result.rows.map(toProduct);
  }

  async barcodeInUse(tenantId: string, barcode: string, exceptId?: string): Promise<boolean> {
    const result = await this.db.query<{ used: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM producto
                       WHERE tenant_id = $1 AND codigo_barras = $2 AND is_active
                         AND id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')) AS used`,
      [tenantId, barcode, exceptId ?? null],
    );
    return result.rows[0]?.used === true;
  }

  async insert(p: Product, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO producto
         (id, tenant_id, tipo, nombre, codigo_barras, categoria_id, costo, precio_combo, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [p.id, p.tenantId, p.type, p.name, p.barcode, p.categoryId, p.cost, p.comboPrice, at],
    );
  }

  async update(p: Product): Promise<void> {
    await this.db.query(
      `UPDATE producto SET nombre = $3, codigo_barras = $4, categoria_id = $5, costo = $6,
                           precio_combo = $7
        WHERE tenant_id = $1 AND id = $2`,
      [p.tenantId, p.id, p.name, p.barcode, p.categoryId, p.cost, p.comboPrice],
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(deactivateSql('producto'), [tenantId, id, at, by]);
  }

  async saveImage(
    tenantId: string,
    id: string,
    image: { type: ImageType; bytes: Uint8Array },
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO producto_imagen (producto_id, tenant_id, tipo_mime, contenido, actualizado_en, actualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (producto_id) DO UPDATE SET tipo_mime = EXCLUDED.tipo_mime,
         contenido = EXCLUDED.contenido, actualizado_en = EXCLUDED.actualizado_en,
         actualizado_por = EXCLUDED.actualizado_por`,
      [id, tenantId, image.type, Buffer.from(image.bytes), at, by],
    );
  }

  async findImage(
    tenantId: string,
    id: string,
  ): Promise<{ type: ImageType; bytes: Uint8Array } | undefined> {
    const result = await this.db.query<{ tipo_mime: ImageType; contenido: Buffer }>(
      'SELECT tipo_mime, contenido FROM producto_imagen WHERE tenant_id = $1 AND producto_id = $2',
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? { type: row.tipo_mime, bytes: new Uint8Array(row.contenido) } : undefined;
  }
}

interface ComponentDbRow {
  combo_id: string;
  producto_id: string;
  cantidad: string;
  nombre: string;
  is_active: boolean;
}

export class PgComboRepository implements ComboRepository {
  constructor(private readonly db: PgDatabase) {}

  async components(tenantId: string, comboId?: string): Promise<ComponentRow[]> {
    const result = await this.db.query<ComponentDbRow>(
      `SELECT c.combo_id, c.producto_id, c.cantidad, p.nombre, p.is_active
         FROM combo_componente c
         JOIN producto p ON p.id = c.producto_id
        WHERE c.tenant_id = $1 AND c.is_active AND ($2::uuid IS NULL OR c.combo_id = $2)
        ORDER BY p.nombre`,
      [tenantId, comboId ?? null],
    );
    return result.rows.map((row) => ({
      comboId: row.combo_id,
      productId: row.producto_id,
      quantity: row.cantidad,
      productName: row.nombre,
      productActive: row.is_active,
    }));
  }

  async replaceComponents(
    tenantId: string,
    comboId: string,
    components: readonly ComboComponent[],
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE combo_componente SET is_active = false, desactivado_en = $3, desactivado_por = $4
        WHERE tenant_id = $1 AND combo_id = $2 AND is_active`,
      [tenantId, comboId, at, by],
    );
    for (const component of components) {
      await this.db.query(
        `INSERT INTO combo_componente (id, tenant_id, combo_id, producto_id, cantidad, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), tenantId, comboId, component.productId, component.quantity, at],
      );
    }
  }
}

interface PriceListRow {
  id: string;
  tenant_id: string;
  nombre: string;
  regla: PriceRuleType;
  parametros: { porcentaje?: string; porCategoria?: Record<string, string> };
  is_active: boolean;
}

// La regla se guarda como tipo más parámetros JSON (plan §3, `lista_precio`).
const toRule = (row: PriceListRow): PriceRule => {
  switch (row.regla) {
    case 'fijo':
      return { type: 'fijo' };
    case 'porcentaje_costo':
      return { type: 'porcentaje_costo', markupPct: row.parametros.porcentaje ?? '0.0000' };
    case 'por_grupo':
      return {
        type: 'por_grupo',
        markupPct: row.parametros.porcentaje ?? '0.0000',
        byCategory: row.parametros.porCategoria ?? {},
      };
  }
};

const ruleParameters = (rule: PriceRule) => {
  switch (rule.type) {
    case 'fijo':
      return {};
    case 'porcentaje_costo':
      return { porcentaje: rule.markupPct };
    case 'por_grupo':
      return { porcentaje: rule.markupPct, porCategoria: rule.byCategory };
  }
};

const toPriceList = (row: PriceListRow): PriceList => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.nombre,
  rule: toRule(row),
  isActive: row.is_active,
});

export class PgPriceListRepository implements PriceListRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<PriceList[]> {
    const result = await this.db.query<PriceListRow>(
      `SELECT id, tenant_id, nombre, regla, parametros, is_active FROM lista_precio
        WHERE tenant_id = $1 AND ($2 OR is_active) ORDER BY nombre`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toPriceList);
  }

  async findById(tenantId: string, id: string): Promise<PriceList | undefined> {
    const result = await this.db.query<PriceListRow>(
      'SELECT id, tenant_id, nombre, regla, parametros, is_active FROM lista_precio WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toPriceList(row) : undefined;
  }

  async insert(list: PriceList, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO lista_precio (id, tenant_id, nombre, regla, parametros, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [list.id, list.tenantId, list.name, list.rule.type, ruleParameters(list.rule), at],
    );
  }

  async update(list: PriceList): Promise<void> {
    await this.db.query(
      'UPDATE lista_precio SET nombre = $3, regla = $4, parametros = $5 WHERE tenant_id = $1 AND id = $2',
      [list.tenantId, list.id, list.name, list.rule.type, ruleParameters(list.rule)],
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(deactivateSql('lista_precio'), [tenantId, id, at, by]);
  }
}

export class PgPriceRepository implements PriceRepository {
  constructor(private readonly db: PgDatabase) {}

  async current(
    tenantId: string,
    scope: { listIds?: readonly string[]; productIds?: readonly string[] },
  ): Promise<ListPrice[]> {
    const result = await this.db.query<{
      lista_id: string;
      producto_id: string;
      precio_final: string | null;
    }>(
      `SELECT lista_id, producto_id, precio_final FROM precio_lista
        WHERE tenant_id = $1
          AND ($2::uuid[] IS NULL OR lista_id = ANY($2::uuid[]))
          AND ($3::uuid[] IS NULL OR producto_id = ANY($3::uuid[]))`,
      [tenantId, scope.listIds ?? null, scope.productIds ?? null],
    );
    return result.rows.map((row) => ({
      listId: row.lista_id,
      productId: row.producto_id,
      price: row.precio_final,
    }));
  }

  async save(
    tenantId: string,
    change: ListPrice & { previous: string | null; cause: PriceChangeCause },
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO precio_lista (id, tenant_id, lista_id, producto_id, precio_final, calculado_en)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lista_id, producto_id) DO UPDATE SET
         precio_final = EXCLUDED.precio_final, calculado_en = EXCLUDED.calculado_en`,
      [randomUUID(), tenantId, change.listId, change.productId, change.price, at],
    );
    await this.db.query(
      `INSERT INTO historial_precio
         (id, tenant_id, lista_id, producto_id, precio_anterior, precio_nuevo, causa, usuario_id, momento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        tenantId,
        change.listId,
        change.productId,
        change.previous,
        change.price,
        change.cause,
        by,
        at,
      ],
    );
  }
}

// La lista activa vive en la tabla de sucursales (plan §3, `sucursal`). Solo sucursales activas.
export class PgBranchPriceLists implements BranchPriceLists {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string): Promise<BranchPriceList[]> {
    const result = await this.db.query<{
      id: string;
      nombre: string;
      lista_precio_activa_id: string | null;
    }>(
      `SELECT id, nombre, lista_precio_activa_id FROM sucursal
        WHERE tenant_id = $1 AND is_active ORDER BY nombre`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      branchId: row.id,
      branchName: row.nombre,
      priceListId: row.lista_precio_activa_id,
    }));
  }

  async find(tenantId: string, branchId: string): Promise<BranchPriceList | undefined> {
    return (await this.list(tenantId)).find((branch) => branch.branchId === branchId);
  }

  async assign(tenantId: string, branchId: string, priceListId: string): Promise<void> {
    await this.db.query(
      'UPDATE sucursal SET lista_precio_activa_id = $3 WHERE tenant_id = $1 AND id = $2 AND is_active',
      [tenantId, branchId, priceListId],
    );
  }

  async countUsing(tenantId: string, priceListId: string): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM sucursal
        WHERE tenant_id = $1 AND lista_precio_activa_id = $2 AND is_active`,
      [tenantId, priceListId],
    );
    return result.rows[0]?.total ?? 0;
  }
}
