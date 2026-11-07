// Simulador de ARCA (T-194). Se controla desde /dev/simuladores y solo existe fuera de producción.
// En producción, hasta integrar ARCA (T-206 a T-208), el servicio figura no disponible: los
// comprobantes esperan en la cola y nunca se dan por emitidos.
import { randomUUID } from 'node:crypto';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type {
  FiscalResult,
  FiscalService,
  SimulatorFiscalMode,
  VoucherRequest,
} from '../aplicacion/ports.js';

export class FiscalSimulator implements FiscalService {
  constructor(private readonly db: PgDatabase) {}

  async mode(tenantId: string): Promise<SimulatorFiscalMode> {
    const result = await this.db.run(
      () =>
        this.db.query<{ modo: SimulatorFiscalMode }>(
          'SELECT modo FROM simulador_fiscal WHERE tenant_id = $1',
          [tenantId],
        ),
      { tenantId },
    );
    return result.rows[0]?.modo ?? 'acepta';
  }

  async setMode(tenantId: string, mode: SimulatorFiscalMode): Promise<void> {
    await this.db.run(
      () =>
        this.db.query(
          `INSERT INTO simulador_fiscal (tenant_id, modo) VALUES ($1, $2)
           ON CONFLICT (tenant_id) DO UPDATE SET modo = EXCLUDED.modo`,
          [tenantId, mode],
        ),
      { tenantId },
    );
  }

  private async answer(request: VoucherRequest): Promise<FiscalResult> {
    const mode = await this.mode(request.tenantId);
    if (mode === 'caido') return { outcome: 'no_disponible' };
    if (mode === 'rechaza') return { outcome: 'rechazado', reason: 'Rechazado por el simulador.' };
    return { outcome: 'aceptado', cae: `SIM${randomUUID().replace(/-/g, '').slice(0, 11)}` };
  }

  authorize(request: VoucherRequest) {
    return this.answer(request);
  }

  report(request: VoucherRequest) {
    return this.answer(request);
  }

  async requestCaea(tenantId: string, period: string) {
    return (await this.mode(tenantId)) === 'caido'
      ? { outcome: 'no_disponible' as const }
      : { outcome: 'aceptado' as const, code: `CAEA${period}` };
  }
}

export const unavailableFiscalService: FiscalService = {
  authorize: () => Promise.resolve({ outcome: 'no_disponible' }),
  report: () => Promise.resolve({ outcome: 'no_disponible' }),
  requestCaea: () => Promise.resolve({ outcome: 'no_disponible' }),
};
