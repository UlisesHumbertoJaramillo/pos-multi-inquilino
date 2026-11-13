// Casos de uso de la carga desde Excel (T-291 a T-295; RF-170 a RF-174, D-98).
// La vista previa corre la carga completa y la deshace: anuncia exactamente lo que la aplicación
// crea, actualiza y rechaza. La aplicación vuelve a validar el archivo antes de escribir y queda
// en la auditoría como una sola operación (D-49).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { Action } from '../../../compartido/aplicacion/permissions.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import {
  type ImportKind,
  type ImportSummary,
  type RowOutcome,
  type SheetRow,
  sheetRows,
  summarize,
  TEMPLATES,
} from '../dominio/templates.js';
import type {
  ImportActor,
  PriceRows,
  ProductRows,
  SpreadsheetReader,
  SpreadsheetWriter,
  SupplierRows,
} from './ports.js';

export interface ImportDependencies {
  uow: UnitOfWork;
  reader: SpreadsheetReader;
  writer: SpreadsheetWriter;
  products: ProductRows;
  suppliers: SupplierRows;
  prices: PriceRows;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

// Quién carga cada tipo: el AC, con el permiso del catálogo o el de proveedores (§5.18).
export const IMPORT_ACTIONS: Record<ImportKind, Action> = {
  productos: 'catalogo.gestionar',
  proveedores: 'proveedores.gestionar',
  precios: 'catalogo.gestionar',
};

const SHEET_NAMES: Record<ImportKind, string> = {
  productos: 'Productos',
  proveedores: 'Proveedores',
  precios: 'Precios',
};

// Sale de la transacción de la vista previa para deshacerla, con el resumen.
class PreviewDone extends Error {
  constructor(readonly summary: ImportSummary) {
    super('Vista previa');
  }
}

export type ImportMode = 'vista_previa' | 'aplicar';

export class RunImport {
  constructor(private readonly deps: ImportDependencies) {}

  async execute(
    context: SecurityContext,
    kind: ImportKind,
    file: Uint8Array,
    mode: ImportMode,
  ): Promise<ImportSummary> {
    await this.deps.access.check(context, IMPORT_ACTIONS[kind]);
    const tenantId = this.deps.access.requireTenant(context);
    const rows = sheetRows(kind, await this.deps.reader.firstSheet(file));
    const actor: ImportActor = { tenantId, userId: context.userId, at: this.deps.clock.now() };

    if (mode === 'aplicar') {
      return this.deps.uow.run(
        async () => {
          const summary = summarize(await this.apply(kind, actor, rows));
          await this.deps.audit.record({
            tenantId,
            userId: context.userId,
            activeRole: 'AC',
            action: `carga_excel_${kind}`,
            entity: 'carga_excel',
            entityId: this.deps.ids.next(),
            before: null,
            after: {
              tipo: kind,
              creados: summary.created,
              actualizados: summary.updated,
              rechazados: summary.rejected,
              filas: summary.rows.map((r) => ({
                fila: r.line,
                clave: r.key,
                resultado: r.outcome,
                ...(r.outcome === 'error' ? { motivo: r.reason } : {}),
              })),
            },
          });
          return summary;
        },
        { tenantId },
      );
    }

    try {
      await this.deps.uow.run(
        async () => {
          throw new PreviewDone(summarize(await this.apply(kind, actor, rows)));
        },
        { tenantId },
      );
    } catch (error: unknown) {
      if (error instanceof PreviewDone) return error.summary;
      throw error;
    }
    throw new Error('La vista previa terminó sin resumen.');
  }

  private async apply(
    kind: ImportKind,
    actor: ImportActor,
    rows: SheetRow[],
  ): Promise<RowOutcome[]> {
    switch (kind) {
      case 'productos': {
        const { outcomes } = await this.deps.products.importRows(
          actor,
          rows.map(({ line, values: [barcode = '', name = '', category = '', cost = ''] }) => ({
            line,
            barcode,
            name,
            cost,
            category,
          })),
        );
        return outcomes.map((o) =>
          o.outcome === 'error'
            ? { line: o.line, key: o.barcode, outcome: 'error', reason: o.reason }
            : { line: o.line, key: o.barcode, outcome: o.outcome },
        );
      }
      case 'proveedores':
        return this.deps.suppliers.importRows(
          actor,
          rows.map(({ line, values: [cuit = '', name = '', contact = ''] }) => ({
            line,
            cuit,
            name,
            contact,
          })),
        );
      case 'precios':
        return this.deps.prices.importRows(
          actor,
          rows.map(({ line, values: [list = '', barcode = '', price = ''] }) => ({
            line,
            list,
            barcode,
            price,
          })),
        );
    }
  }
}

export class GetTemplate {
  constructor(private readonly deps: ImportDependencies) {}

  async execute(context: SecurityContext, kind: ImportKind): Promise<Uint8Array> {
    await this.deps.access.check(context, IMPORT_ACTIONS[kind]);
    this.deps.access.requireTenant(context);
    return this.deps.writer.template(SHEET_NAMES[kind], TEMPLATES[kind]);
  }
}
