// Carga de proveedores desde Excel (T-293; RF-172, D-98). Identifica por CUIT, crea o actualiza la
// razón social y el contacto de las filas válidas e informa las demás. Nunca toca el saldo
// adeudado. Las reglas son las mismas que en el alta manual.
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  assertSupplierName,
  normalizeContact,
  normalizeCuit,
  type Supplier,
} from '../dominio/suppliers.js';
import type { SupplierRepository } from './ports.js';

export interface SupplierImportRow {
  line: number;
  cuit: string;
  name: string;
  contact: string;
}

export type SupplierImportOutcome =
  | { line: number; key: string; outcome: 'creado' | 'actualizado' }
  | { line: number; key: string; outcome: 'error'; reason: string };

export class SupplierImport {
  constructor(private readonly deps: { suppliers: SupplierRepository; ids: IdGenerator }) {}

  async importRows(
    actor: { tenantId: string; at: Date },
    rows: readonly SupplierImportRow[],
  ): Promise<SupplierImportOutcome[]> {
    const active = await this.deps.suppliers.list(actor.tenantId, false);
    const byCuit = new Map(active.filter((s) => s.cuit !== null).map((s) => [s.cuit ?? '', s]));
    const seen = new Set<string>();
    const outcomes: SupplierImportOutcome[] = [];
    for (const row of rows) {
      try {
        const cuit = normalizeCuit(row.cuit);
        if (cuit === null) throw new DomainError('CUIT_INVALIDO', 'Falta el CUIT.');
        if (seen.has(cuit)) {
          throw new DomainError('FILA_REPETIDA', 'El CUIT ya apareció en otra fila.');
        }
        seen.add(cuit);
        const name = assertSupplierName(row.name);
        const contact = normalizeContact(row.contact === '' ? null : row.contact);
        const existing = byCuit.get(cuit);
        if (existing) {
          await this.deps.suppliers.update({ ...existing, name, contact });
          outcomes.push({ line: row.line, key: cuit, outcome: 'actualizado' });
          continue;
        }
        if (await this.deps.suppliers.cuitInUse(actor.tenantId, cuit)) {
          throw new DomainError(
            'PROVEEDOR_DADO_DE_BAJA',
            'El CUIT es de un proveedor dado de baja: reactivalo antes de cargarlo.',
          );
        }
        const supplier: Supplier = {
          id: this.deps.ids.next(),
          tenantId: actor.tenantId,
          name,
          cuit,
          contact,
          balance: '0.00',
          isActive: true,
        };
        await this.deps.suppliers.insert(supplier, actor.at);
        byCuit.set(cuit, supplier);
        outcomes.push({ line: row.line, key: cuit, outcome: 'creado' });
      } catch (error: unknown) {
        if (!(error instanceof DomainError)) throw error;
        outcomes.push({ line: row.line, key: row.cuit, outcome: 'error', reason: error.message });
      }
    }
    return outcomes;
  }
}
