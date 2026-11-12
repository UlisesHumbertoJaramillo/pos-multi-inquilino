// Repositorios PostgreSQL del módulo de organización. Tablas aisladas por comercio: se usan dentro
// de una unidad de trabajo con el comercio fijado, y además cada consulta filtra por comercio.
import type { ShortcutRepository } from '../aplicacion/shortcuts.js';
import type { ShortcutMap } from '../dominio/shortcuts.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { BillingPolicy, TenantParameters } from '../dominio/parameters.js';
import type { PaymentMethod, PaymentType } from '../dominio/payment-methods.js';
import type { Branch, Register } from '../dominio/structure.js';
import type {
  BranchRepository,
  ParametersRepository,
  PaymentMethodRepository,
  RegisterRepository,
} from '../aplicacion/ports.js';

interface BranchRow {
  id: string;
  tenant_id: string;
  nombre: string;
  direccion: string | null;
  is_active: boolean;
}

const toBranch = (row: BranchRow): Branch => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.nombre,
  address: row.direccion,
  isActive: row.is_active,
});

export class PgBranchRepository implements BranchRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<Branch[]> {
    const result = await this.db.query<BranchRow>(
      `SELECT id, tenant_id, nombre, direccion, is_active FROM sucursal
        WHERE tenant_id = $1 AND ($2 OR is_active) ORDER BY nombre`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toBranch);
  }

  async findById(tenantId: string, id: string): Promise<Branch | undefined> {
    const result = await this.db.query<BranchRow>(
      'SELECT id, tenant_id, nombre, direccion, is_active FROM sucursal WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toBranch(row) : undefined;
  }

  async insert(branch: Branch, at: Date): Promise<void> {
    await this.db.query(
      'INSERT INTO sucursal (id, tenant_id, nombre, direccion, creado_en) VALUES ($1, $2, $3, $4, $5)',
      [branch.id, branch.tenantId, branch.name, branch.address, at],
    );
  }

  async update(branch: Branch): Promise<void> {
    await this.db.query(
      'UPDATE sucursal SET nombre = $3, direccion = $4 WHERE tenant_id = $1 AND id = $2',
      [branch.tenantId, branch.id, branch.name, branch.address],
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE sucursal SET is_active = false, desactivado_en = $3, desactivado_por = $4
        WHERE tenant_id = $1 AND id = $2 AND is_active`,
      [tenantId, id, at, by],
    );
  }
}

interface RegisterRow {
  id: string;
  tenant_id: string;
  sucursal_id: string;
  nombre: string;
  punto_venta_fiscal: number | null;
  is_active: boolean;
}

const toRegister = (row: RegisterRow): Register => ({
  id: row.id,
  tenantId: row.tenant_id,
  branchId: row.sucursal_id,
  name: row.nombre,
  fiscalPointOfSale: row.punto_venta_fiscal,
  isActive: row.is_active,
});

const REGISTER_COLUMNS = 'id, tenant_id, sucursal_id, nombre, punto_venta_fiscal, is_active';

export class PgRegisterRepository implements RegisterRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<Register[]> {
    const result = await this.db.query<RegisterRow>(
      `SELECT ${REGISTER_COLUMNS} FROM caja WHERE tenant_id = $1 AND ($2 OR is_active) ORDER BY nombre`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toRegister);
  }

  async findById(tenantId: string, id: string): Promise<Register | undefined> {
    const result = await this.db.query<RegisterRow>(
      `SELECT ${REGISTER_COLUMNS} FROM caja WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toRegister(row) : undefined;
  }

  async pointOfSaleInUse(
    tenantId: string,
    pointOfSale: number,
    exceptId?: string,
  ): Promise<boolean> {
    const result = await this.db.query<{ used: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM caja WHERE tenant_id = $1 AND punto_venta_fiscal = $2
                        AND id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')) AS used`,
      [tenantId, pointOfSale, exceptId ?? null],
    );
    return result.rows[0]?.used === true;
  }

  async insert(register: Register, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, punto_venta_fiscal, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        register.id,
        register.tenantId,
        register.branchId,
        register.name,
        register.fiscalPointOfSale,
        at,
      ],
    );
  }

  async update(register: Register): Promise<void> {
    await this.db.query(
      'UPDATE caja SET nombre = $3, punto_venta_fiscal = $4 WHERE tenant_id = $1 AND id = $2',
      [register.tenantId, register.id, register.name, register.fiscalPointOfSale],
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE caja SET is_active = false, desactivado_en = $3, desactivado_por = $4
        WHERE tenant_id = $1 AND id = $2 AND is_active`,
      [tenantId, id, at, by],
    );
  }
}

interface ParametersRow {
  inactividad_carrito_min: number;
  inactividad_sesion_min: number;
  plazo_regularizacion_horas: number;
  plazo_devolucion_dias: number;
  tolerancia_arqueo: string;
  politica_facturacion: BillingPolicy;
  plazo_facturacion_posterior_dias: number;
}

export class PgParametersRepository implements ParametersRepository {
  constructor(private readonly db: PgDatabase) {}

  async find(tenantId: string): Promise<TenantParameters | undefined> {
    const result = await this.db.query<ParametersRow>(
      `SELECT inactividad_carrito_min, inactividad_sesion_min, plazo_regularizacion_horas,
              plazo_devolucion_dias, tolerancia_arqueo, politica_facturacion,
              plazo_facturacion_posterior_dias
         FROM parametro_comercio WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      cartIdleMinutes: row.inactividad_carrito_min,
      sessionIdleMinutes: row.inactividad_sesion_min,
      fiscalRegularizationHours: row.plazo_regularizacion_horas,
      returnWindowDays: row.plazo_devolucion_dias,
      cashCountTolerance: row.tolerancia_arqueo,
      billingPolicy: row.politica_facturacion,
      laterInvoicingDays: row.plazo_facturacion_posterior_dias,
    };
  }

  async save(tenantId: string, p: TenantParameters, by: string, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO parametro_comercio
         (tenant_id, inactividad_carrito_min, inactividad_sesion_min, plazo_regularizacion_horas,
          plazo_devolucion_dias, tolerancia_arqueo, politica_facturacion,
          plazo_facturacion_posterior_dias, actualizado_en, actualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id) DO UPDATE SET
         inactividad_carrito_min = EXCLUDED.inactividad_carrito_min,
         inactividad_sesion_min = EXCLUDED.inactividad_sesion_min,
         plazo_regularizacion_horas = EXCLUDED.plazo_regularizacion_horas,
         plazo_devolucion_dias = EXCLUDED.plazo_devolucion_dias,
         tolerancia_arqueo = EXCLUDED.tolerancia_arqueo,
         politica_facturacion = EXCLUDED.politica_facturacion,
         plazo_facturacion_posterior_dias = EXCLUDED.plazo_facturacion_posterior_dias,
         actualizado_en = EXCLUDED.actualizado_en,
         actualizado_por = EXCLUDED.actualizado_por`,
      [
        tenantId,
        p.cartIdleMinutes,
        p.sessionIdleMinutes,
        p.fiscalRegularizationHours,
        p.returnWindowDays,
        p.cashCountTolerance,
        p.billingPolicy,
        p.laterInvoicingDays,
        at,
        by,
      ],
    );
  }
}

interface PaymentMethodRow {
  id: string;
  tenant_id: string;
  nombre: string;
  tipo: PaymentType;
  recargo_pct: string;
  is_active: boolean;
}

const toPaymentMethod = (row: PaymentMethodRow): PaymentMethod => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.nombre,
  type: row.tipo,
  surchargePct: row.recargo_pct,
  isActive: row.is_active,
});

export class PgPaymentMethodRepository implements PaymentMethodRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<PaymentMethod[]> {
    const result = await this.db.query<PaymentMethodRow>(
      `SELECT id, tenant_id, nombre, tipo, recargo_pct, is_active FROM metodo_pago
        WHERE tenant_id = $1 AND ($2 OR is_active) ORDER BY nombre`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toPaymentMethod);
  }

  async findById(tenantId: string, id: string): Promise<PaymentMethod | undefined> {
    const result = await this.db.query<PaymentMethodRow>(
      'SELECT id, tenant_id, nombre, tipo, recargo_pct, is_active FROM metodo_pago WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toPaymentMethod(row) : undefined;
  }

  async insert(m: PaymentMethod, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [m.id, m.tenantId, m.name, m.type, m.surchargePct, at],
    );
  }

  async update(m: PaymentMethod): Promise<void> {
    await this.db.query(
      'UPDATE metodo_pago SET nombre = $3, recargo_pct = $4 WHERE tenant_id = $1 AND id = $2',
      [m.tenantId, m.id, m.name, m.surchargePct],
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE metodo_pago SET is_active = false, desactivado_en = $3, desactivado_por = $4
        WHERE tenant_id = $1 AND id = $2 AND is_active`,
      [tenantId, id, at, by],
    );
  }
}

// Atajos del POS del comercio (T-274, AD-28): una fila por comercio con el mapa, o nulo para la
// distribución por defecto.
export class PgShortcutRepository implements ShortcutRepository {
  constructor(private readonly db: PgDatabase) {}

  async find(tenantId: string): Promise<Partial<Record<string, string | null>> | null> {
    const result = await this.db.query<{ mapa: Record<string, string | null> | null }>(
      'SELECT mapa FROM atajos_comercio WHERE tenant_id = $1',
      [tenantId],
    );
    return result.rows[0]?.mapa ?? null;
  }

  async save(tenantId: string, map: ShortcutMap | null, by: string, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO atajos_comercio (tenant_id, mapa, actualizado_en, actualizado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id) DO UPDATE SET mapa = EXCLUDED.mapa,
         actualizado_en = EXCLUDED.actualizado_en, actualizado_por = EXCLUDED.actualizado_por`,
      [tenantId, map === null ? null : JSON.stringify(map), at, by],
    );
  }
}
