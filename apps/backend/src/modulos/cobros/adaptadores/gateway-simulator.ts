// Simulador local de la pasarela (T-174). Se controla desde /dev/simuladores y solo existe fuera de
// producción. El estado vive en la base porque la API y el worker son procesos distintos.
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { GatewayResult, PaymentGateway } from '../aplicacion/gateway.js';
import type { SimulatorMode } from '../aplicacion/ports.js';

// Demora de una aprobación tardía: llega después de que un AS pueda resolver a mano.
export const LATE_APPROVAL_MS = 4 * 60_000;

const reference = (key: string) => `sim-${key}`;

export class GatewaySimulator implements PaymentGateway {
  readonly configured = true;

  constructor(
    private readonly db: PgDatabase,
    private readonly clock: Clock,
  ) {}

  async mode(tenantId: string): Promise<SimulatorMode> {
    const result = await this.db.run(
      () =>
        this.db.query<{ modo: SimulatorMode }>(
          'SELECT modo FROM simulador_pasarela WHERE tenant_id = $1',
          [tenantId],
        ),
      { tenantId },
    );
    return result.rows[0]?.modo ?? 'aprobar';
  }

  async setMode(tenantId: string, mode: SimulatorMode): Promise<void> {
    await this.db.run(
      () =>
        this.db.query(
          `INSERT INTO simulador_pasarela (tenant_id, modo) VALUES ($1, $2)
           ON CONFLICT (tenant_id) DO UPDATE SET modo = EXCLUDED.modo`,
          [tenantId, mode],
        ),
      { tenantId },
    );
  }

  private answer(mode: string, key: string): GatewayResult {
    if (mode === 'aprobar') return { outcome: 'aprobado', reference: reference(key) };
    if (mode === 'rechazar') return { outcome: 'rechazado', reference: null };
    return { outcome: 'sin_respuesta', reference: null };
  }

  // Repetir una clave devuelve lo mismo y nunca genera otro cobro.
  async charge(input: Parameters<PaymentGateway['charge']>[0]): Promise<GatewayResult> {
    const { tenantId, key } = input;
    const mode = await this.mode(tenantId);
    const stored = await this.db.run(
      () =>
        this.db.query<{ modo: string }>(
          `INSERT INTO simulador_pago (tenant_id, clave, modo, creado_en)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, clave) DO UPDATE SET clave = EXCLUDED.clave
           RETURNING modo`,
          [tenantId, key, mode, this.clock.now()],
        ),
      { tenantId },
    );
    return this.answer(stored.rows[0]?.modo ?? mode, key);
  }

  async check(input: { tenantId: string; key: string }): Promise<GatewayResult> {
    const { tenantId, key } = input;
    const result = await this.db.run(
      () =>
        this.db.query<{ modo: string; creado_en: Date }>(
          'SELECT modo, creado_en FROM simulador_pago WHERE tenant_id = $1 AND clave = $2',
          [tenantId, key],
        ),
      { tenantId },
    );
    const row = result.rows[0];
    if (!row) return { outcome: 'rechazado', reference: null };
    if (row.modo === 'aprobar_tarde') {
      const elapsed = this.clock.now().getTime() - row.creado_en.getTime();
      return elapsed >= LATE_APPROVAL_MS
        ? { outcome: 'aprobado', reference: reference(key) }
        : { outcome: 'sin_respuesta', reference: null };
    }
    // Un cobro sin respuesta se conoce cuando el simulador vuelve a responder.
    if (row.modo === 'no_responder') return this.answer(await this.mode(tenantId), key);
    return this.answer(row.modo, key);
  }

  // El reintegro parcial responde según el modo del simulador (T-219).
  async refundPart(input: { tenantId: string; key: string; refundKey: string; amount: string }) {
    const mode = await this.mode(input.tenantId);
    if (mode === 'no_responder' || mode === 'aprobar_tarde') {
      return { outcome: 'sin_respuesta' as const };
    }
    return { outcome: mode === 'rechazar' ? ('rechazado' as const) : ('revertido' as const) };
  }

  async refund(input: { tenantId: string; key: string }) {
    const { tenantId, key } = input;
    const mode = await this.mode(tenantId);
    if (mode === 'no_responder') return { outcome: 'sin_respuesta' as const };
    if (mode === 'rechazar') return { outcome: 'rechazado' as const };
    await this.db.run(
      () =>
        this.db.query(
          'UPDATE simulador_pago SET revertido = true WHERE tenant_id = $1 AND clave = $2',
          [tenantId, key],
        ),
      { tenantId },
    );
    return { outcome: 'revertido' as const };
  }
}

// En producción no hay pasarela hasta integrar Mercado Pago (T-180): un cobro electrónico se
// rechaza antes de empezar, nunca se simula.
export const unavailableGateway: PaymentGateway = {
  configured: false,
  charge: () => Promise.reject(notConfigured()),
  check: () => Promise.reject(notConfigured()),
  refund: () => Promise.reject(notConfigured()),
  refundPart: () => Promise.reject(notConfigured()),
};

const notConfigured = () =>
  new ApplicationError('conflict', 'PASARELA_NO_CONFIGURADA', 'No hay una pasarela configurada.');
