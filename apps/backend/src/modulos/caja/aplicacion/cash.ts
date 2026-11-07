// Casos de uso de caja (T-130 a T-140; RF-089 a RF-099, RF-112, RF-115, RF-117, RF-118, RF-154):
// apertura de turno y de jornada, movimientos manuales, Corte X y Corte Z ciegos, cierre forzado
// y alertas. El saldo teórico nunca sale hacia un VO (RF-093, RF-112): lo decide el adaptador
// HTTP según el rol, y los rechazos que podrían revelarlo son genéricos.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { Action } from '../../../compartido/aplicacion/permissions.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  type CashCount,
  countCash,
  exceedsTolerance,
  journeyDate,
  journeyExpired,
  normalizeAmount,
  normalizeReason,
  openingDifference,
  theoreticalCash,
  withdrawalCovered,
  withdrawalReference,
} from '../dominio/cash.js';
import type {
  CashAlerts,
  CashAlertType,
  CashRepository,
  CashSettings,
  Journey,
  Register,
  RegisterStatus,
  SalesInProgress,
  Shift,
  ShiftQuota,
  StoredMovement,
  WithdrawalAuthorizations,
} from './ports.js';

export interface CashDependencies {
  uow: UnitOfWork;
  cash: CashRepository;
  settings: CashSettings;
  alerts: CashAlerts;
  sales: SalesInProgress;
  quota: ShiftQuota;
  authorizations: WithdrawalAuthorizations;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

interface Actor {
  tenantId: string;
  userId: string;
  role: 'AC' | 'AS' | 'VO';
  at: Date;
}

export interface RegisterOverview extends RegisterStatus {
  // La jornada abierta pasó las 24 h y la caja exige el Corte Z (RF-097, D-77).
  requiresZ: boolean;
}

export interface ShiftDetail {
  shift: Shift;
  movements: StoredMovement[];
}

export interface ShiftClosure {
  shift: Shift;
  count: CashCount;
}

export interface JourneyClosure {
  journey: Journey;
  registerName: string;
  shifts: number;
  count: CashCount;
}

// Un rechazo que deja constancia (una alerta, una autorización consumida): la transacción se
// confirma y el error se lanza después.
class Rejection {
  constructor(readonly error: Error) {}
}

abstract class CashUseCase {
  constructor(protected readonly deps: CashDependencies) {}

  protected async inTenant<T>(
    context: SecurityContext,
    action: Action,
    work: (actor: Actor) => Promise<T | Rejection>,
  ): Promise<T> {
    await this.deps.access.check(context, action);
    const tenantId = this.deps.access.requireTenant(context);
    const role = context.activeRole === 'SA' ? null : context.activeRole;
    if (role === null) throw new Error('Rol activo inválido después de verificar el permiso.');
    const result = await this.deps.uow.run(
      () => work({ tenantId, userId: context.userId, role, at: this.deps.clock.now() }),
      { tenantId },
    );
    if (result instanceof Rejection) throw result.error;
    return result;
  }

  // Una caja de otro comercio responde como inexistente (RF-002); una del comercio fuera del
  // ámbito del rol se rechaza por permiso (RF-004).
  protected async register(
    context: SecurityContext,
    action: Action,
    actor: Actor,
    id: string,
  ): Promise<Register> {
    const register = await this.deps.cash.lockRegister(actor.tenantId, id);
    if (!register) return this.deps.access.notFound(context, 'caja', id);
    await this.deps.access.check(context, action, { branchId: register.branchId });
    return register;
  }

  protected async branch(context: SecurityContext, action: Action, actor: Actor, id: string) {
    if (!(await this.deps.cash.branchExists(actor.tenantId, id))) {
      return this.deps.access.notFound(context, 'sucursal', id);
    }
    await this.deps.access.check(context, action, { branchId: id });
  }

  protected async ownShift(actor: Actor, lock = true): Promise<Shift> {
    const shift = await this.deps.cash.openShiftOfSeller(actor.tenantId, actor.userId);
    const locked =
      shift && lock ? await this.deps.cash.findShift(actor.tenantId, shift.id, true) : shift;
    if (locked?.status !== 'abierto') {
      throw new DomainError('SIN_TURNO', 'No tenés un turno abierto.');
    }
    return locked;
  }

  protected async alert(
    actor: Actor,
    branchId: string,
    recipients: readonly ('AS' | 'AC')[],
    type: CashAlertType,
    reference: string,
    detail: Record<string, unknown>,
    severity: 'info' | 'advertencia' | 'critica' = 'advertencia',
  ) {
    for (const recipientRole of recipients) {
      await this.deps.alerts.add({
        tenantId: actor.tenantId,
        branchId,
        recipientRole,
        type,
        severity,
        reference,
        detail,
        at: actor.at,
      });
    }
  }

  // Notifica al AS y al AC un arqueo que supera la tolerancia del comercio (RF-098).
  protected async checkTolerance(
    actor: Actor,
    branchId: string,
    reference: string,
    count: CashCount,
    detail: Record<string, unknown>,
  ) {
    const tolerance = await this.deps.settings.tolerance(actor.tenantId);
    if (!exceedsTolerance(count.difference, tolerance)) return;
    await this.alert(actor, branchId, ['AS', 'AC'], 'arqueo_fuera_de_tolerancia', reference, {
      ...detail,
      resultado: count.result,
      diferencia: count.difference,
      tolerancia: tolerance,
    });
  }

  protected async record(
    actor: Actor,
    branchId: string,
    action: string,
    entity: string,
    entityId: string,
    after: unknown,
    authorizationId: string | null = null,
  ) {
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId,
      userId: actor.userId,
      activeRole: actor.role,
      action,
      entity,
      entityId,
      after,
      authorizationId,
    });
  }

  protected async closeShiftWith(
    actor: Actor,
    shift: Shift,
    declared: string,
    forced: boolean,
  ): Promise<ShiftClosure> {
    const movements = await this.deps.cash.movements(actor.tenantId, [shift.id]);
    const count = countCash(declared, theoreticalCash(shift.initial, movements));
    await this.deps.cash.closeShift(
      actor.tenantId,
      shift.id,
      count,
      actor.userId,
      actor.at,
      forced,
    );
    const detail = { caja: shift.registerName, vendedor: shift.sellerName, turnoId: shift.id };
    await this.checkTolerance(actor, shift.branchId, shift.id, count, detail);
    await this.record(
      actor,
      shift.branchId,
      forced ? 'corte_x_forzado' : 'corte_x',
      'turno',
      shift.id,
      {
        ...count,
        vendedorId: shift.sellerId,
      },
    );
    return {
      shift: {
        ...shift,
        status: 'cerrado',
        count,
        closedAt: actor.at,
        closedBy: actor.userId,
        forced,
      },
      count,
    };
  }
}

const OPERATE = 'ventas.operar' as const;
const MOVEMENTS = 'devoluciones.iniciar' as const;

export class ListRegisters extends CashUseCase {
  async execute(context: SecurityContext, branchId: string): Promise<RegisterOverview[]> {
    return this.inTenant(context, 'caja.corte_z', async (actor) => {
      await this.branch(context, 'caja.corte_z', actor, branchId);
      const registers = await this.deps.cash.registers(actor.tenantId, branchId);
      return registers.map((r) => ({
        ...r,
        requiresZ:
          r.journey !== null &&
          r.openShift === null &&
          journeyExpired(r.journey.openedAt, actor.at),
      }));
    });
  }
}

export class GetOwnShift extends CashUseCase {
  async execute(context: SecurityContext): Promise<ShiftDetail | null> {
    return this.inTenant(context, OPERATE, async (actor) => {
      const shift = await this.deps.cash.openShiftOfSeller(actor.tenantId, actor.userId);
      if (!shift) return null;
      return { shift, movements: await this.deps.cash.movements(actor.tenantId, [shift.id]) };
    });
  }
}

export class OpenShift extends CashUseCase {
  async execute(
    context: SecurityContext,
    input: { registerId: string; initial: string },
  ): Promise<Shift> {
    return this.inTenant(context, OPERATE, async (actor) => {
      const register = await this.register(context, OPERATE, actor, input.registerId);
      if (!register.isActive) {
        throw new DomainError('CAJA_INACTIVA', 'La caja está dada de baja.');
      }
      const initial = normalizeAmount(input.initial, 'El saldo inicial', true);
      if (await this.deps.cash.openShiftOfSeller(actor.tenantId, actor.userId)) {
        throw new DomainError(
          'TURNO_YA_ABIERTO',
          'Ya tenés un turno abierto. Cerralo antes de abrir otro.',
        );
      }

      let journey = await this.deps.cash.openJourney(actor.tenantId, register.id);
      const shifts = journey
        ? await this.deps.cash.shiftsOfJourney(actor.tenantId, journey.id)
        : [];
      const open = shifts.find((s) => s.status === 'abierto');
      if (open) {
        throw new DomainError(
          'CAJA_OCUPADA',
          `La caja ya tiene un turno abierto de ${open.sellerName}.`,
        );
      }
      // Una jornada vencida exige el Corte Z antes de abrir otro turno; se alerta al AS una vez.
      if (journey && journeyExpired(journey.openedAt, actor.at)) {
        if (!(await this.deps.alerts.hasPending(actor.tenantId, 'jornada_sin_z', journey.id))) {
          await this.alert(
            actor,
            register.branchId,
            ['AS'],
            'jornada_sin_z',
            journey.id,
            { caja: register.name, fechaJornada: journey.date },
            'critica',
          );
        }
        return new Rejection(
          new DomainError(
            'JORNADA_SIN_CORTE_Z',
            `La jornada del ${journey.date} de ${register.name} no tiene Corte Z. Hacé el Corte Z antes de abrir un turno.`,
          ),
        );
      }
      if (!journey) {
        journey = {
          id: this.deps.ids.next(),
          tenantId: actor.tenantId,
          registerId: register.id,
          branchId: register.branchId,
          date: journeyDate(actor.at, await this.deps.settings.timeZone(actor.tenantId)),
          openedAt: actor.at,
          status: 'abierta',
        };
        await this.deps.cash.insertJourney(journey);
      }

      const previous = shifts
        .filter((s) => s.closedAt !== null)
        .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))[0];
      const previousCash = previous?.count?.declared ?? null;
      const shift: Shift = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        registerId: register.id,
        registerName: register.name,
        branchId: register.branchId,
        journeyId: journey.id,
        journeyDate: journey.date,
        sellerId: actor.userId,
        sellerName: '',
        initial,
        previousCash,
        openingDifference: openingDifference(initial, previousCash),
        openedAt: actor.at,
        status: 'abierto',
        count: null,
        closedAt: null,
        closedBy: null,
        forced: false,
      };
      if (!(await this.deps.cash.insertShift(shift))) {
        throw new DomainError('CAJA_OCUPADA', 'La caja o el vendedor ya tienen un turno abierto.');
      }
      const opened = await this.deps.cash.findShift(actor.tenantId, shift.id, false);
      if (!opened) throw new Error('No se pudo leer el turno abierto.');

      if (opened.openingDifference !== null) {
        await this.alert(actor, register.branchId, ['AS'], 'diferencia_apertura', opened.id, {
          caja: register.name,
          vendedor: opened.sellerName,
          declarado: initial,
          anterior: previousCash,
          diferencia: opened.openingDifference,
        });
      }
      // El primer turno de cada fecha de jornada restablece la cuota del VO (RF-067).
      await this.deps.quota.openDay(actor, register.branchId, journey.date);
      await this.record(actor, register.branchId, 'turno_apertura', 'turno', opened.id, {
        cajaId: register.id,
        jornadaId: journey.id,
        saldoInicial: initial,
        diferenciaInicial: opened.openingDifference,
      });
      return opened;
    });
  }
}

export class RecordCashIn extends CashUseCase {
  async execute(
    context: SecurityContext,
    input: { amount: string; reason: string },
  ): Promise<StoredMovement> {
    return this.inTenant(context, MOVEMENTS, async (actor) => {
      const shift = await this.ownShift(actor);
      const movement: StoredMovement = {
        id: this.deps.ids.next(),
        shiftId: shift.id,
        type: 'ingreso',
        inCash: true,
        amount: normalizeAmount(input.amount, 'El monto', false),
        reason: normalizeReason(input.reason),
        authorizationId: null,
        userId: actor.userId,
        at: actor.at,
      };
      await this.deps.cash.addMovement(actor.tenantId, movement);
      await this.record(actor, shift.branchId, 'caja_ingreso', 'turno', shift.id, {
        monto: movement.amount,
        motivo: movement.reason,
      });
      return movement;
    });
  }
}

export class RecordWithdrawal extends CashUseCase {
  async execute(
    context: SecurityContext,
    input: { amount: string; reason: string; authorizationId: string },
  ): Promise<StoredMovement> {
    return this.inTenant(context, MOVEMENTS, async (actor) => {
      const shift = await this.ownShift(actor);
      const amount = normalizeAmount(input.amount, 'El monto', false);
      const reason = normalizeReason(input.reason);
      await this.deps.authorizations.consume({
        id: input.authorizationId,
        type: 'retiro',
        operationRef: withdrawalReference(shift.id, amount),
        requesterId: actor.userId,
      });
      const movements = await this.deps.cash.movements(actor.tenantId, [shift.id]);
      const theoretical = theoreticalCash(shift.initial, movements);
      if (!withdrawalCovered(amount, theoretical)) {
        // El motivo va solo al AS (D-7, D-78): el VO recibe un mensaje que no revela el teórico.
        await this.alert(actor, shift.branchId, ['AS'], 'retiro_rechazado', shift.id, {
          caja: shift.registerName,
          vendedor: shift.sellerName,
          monto: amount,
          efectivoTeorico: theoretical,
          autorizacionId: input.authorizationId,
        });
        await this.record(
          actor,
          shift.branchId,
          'caja_retiro_rechazado',
          'turno',
          shift.id,
          { monto: amount, motivo: reason },
          input.authorizationId,
        );
        return new Rejection(
          new DomainError(
            'RETIRO_RECHAZADO',
            'No se pudo registrar el retiro. El AS que lo autorizó recibió el detalle.',
          ),
        );
      }
      const movement: StoredMovement = {
        id: this.deps.ids.next(),
        shiftId: shift.id,
        type: 'retiro',
        inCash: true,
        amount,
        reason,
        authorizationId: input.authorizationId,
        userId: actor.userId,
        at: actor.at,
      };
      await this.deps.cash.addMovement(actor.tenantId, movement);
      await this.record(
        actor,
        shift.branchId,
        'caja_retiro',
        'turno',
        shift.id,
        { monto: amount, motivo: reason },
        input.authorizationId,
      );
      return movement;
    });
  }
}

function salesInProgressError(sales: readonly { label: string }[], what: string): DomainError {
  return new DomainError(
    'VENTAS_EN_CURSO',
    `${what}: cobrá, descartá o traspasá estas ventas en curso: ${sales.map((s) => s.label).join(', ')}.`,
  );
}

// Corte X ciego del propio turno (RF-094, RF-117).
export class CloseOwnShift extends CashUseCase {
  async execute(context: SecurityContext, input: { declared: string }): Promise<ShiftClosure> {
    return this.inTenant(context, 'caja.corte_x', async (actor) => {
      const shift = await this.ownShift(actor);
      const declared = normalizeAmount(input.declared, 'Lo declarado', true);
      const sales = await this.deps.sales.forShift(actor.tenantId, shift.id);
      if (sales.length > 0) throw salesInProgressError(sales, 'No se puede cerrar el turno');
      return this.closeShiftWith(actor, shift, declared, false);
    });
  }
}

// Turnos abiertos de una sucursal, para el cierre forzado (RF-115). Sin el saldo teórico: el AS
// también declara a ciegas.
export class ListOpenShifts extends CashUseCase {
  async execute(context: SecurityContext, branchId: string): Promise<Shift[]> {
    return this.inTenant(context, 'caja.cierre_forzado', async (actor) => {
      await this.branch(context, 'caja.cierre_forzado', actor, branchId);
      return this.deps.cash.openShifts(actor.tenantId, branchId);
    });
  }
}

// Cierre forzado de un turno ajeno por un AS de la sucursal (RF-115, D-10).
export class ForceCloseShift extends CashUseCase {
  async execute(
    context: SecurityContext,
    shiftId: string,
    input: { declared: string },
  ): Promise<ShiftClosure> {
    return this.inTenant(context, 'caja.cierre_forzado', async (actor) => {
      const shift = await this.deps.cash.findShift(actor.tenantId, shiftId, true);
      if (!shift) return this.deps.access.notFound(context, 'turno', shiftId);
      await this.deps.access.check(context, 'caja.cierre_forzado', { branchId: shift.branchId });
      if (shift.status !== 'abierto') {
        throw new ApplicationError('conflict', 'TURNO_CERRADO', 'El turno ya está cerrado.');
      }
      if (shift.sellerId === actor.userId) {
        throw new DomainError(
          'TURNO_PROPIO',
          'No podés forzar el cierre de tu propio turno: cerralo con un Corte X.',
        );
      }
      const declared = normalizeAmount(input.declared, 'Lo declarado', true);
      await this.deps.sales.discardForShift(actor, shift.id);
      const closure = await this.closeShiftWith(actor, shift, declared, true);
      await this.alert(actor, shift.branchId, ['AC'], 'cierre_forzado', shift.id, {
        caja: shift.registerName,
        vendedor: shift.sellerName,
        resultado: closure.count.result,
        diferencia: closure.count.difference,
      });
      return closure;
    });
  }
}

// Corte Z ciego de una caja (RF-095, RF-096, D-14, D-76): sin turnos abiertos ni ventas en curso,
// consolida los turnos de la jornada y la cierra.
export class CloseJourney extends CashUseCase {
  async execute(
    context: SecurityContext,
    registerId: string,
    input: { declared: string },
  ): Promise<JourneyClosure> {
    return this.inTenant(context, 'caja.corte_z', async (actor) => {
      const register = await this.register(context, 'caja.corte_z', actor, registerId);
      const journey = await this.deps.cash.openJourney(actor.tenantId, register.id);
      if (!journey) {
        throw new DomainError('SIN_JORNADA', `${register.name} no tiene una jornada abierta.`);
      }
      const declared = normalizeAmount(input.declared, 'Lo declarado', true);
      const shifts = await this.deps.cash.shiftsOfJourney(actor.tenantId, journey.id);
      const open = shifts.filter((s) => s.status === 'abierto');
      if (open.length > 0) {
        throw new DomainError(
          'TURNOS_ABIERTOS',
          `No se puede hacer el Corte Z: falta cerrar el turno de ${open.map((s) => s.sellerName).join(', ')}.`,
        );
      }
      const sales = await this.deps.sales.forRegister(actor.tenantId, register.id);
      if (sales.length > 0) throw salesInProgressError(sales, 'No se puede hacer el Corte Z');

      // El teórico de la jornada: el saldo inicial del primer turno más todos los movimientos en
      // efectivo de la jornada (D-76).
      const first = [...shifts].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())[0];
      const movements = await this.deps.cash.movements(
        actor.tenantId,
        shifts.map((s) => s.id),
      );
      const count = countCash(declared, theoreticalCash(first?.initial ?? '0', movements));
      await this.deps.cash.closeJourney(actor.tenantId, journey.id, count, actor.userId, actor.at);
      // El Corte Z resuelve la alerta de jornada sin Z, si la había.
      await this.deps.alerts.resolve(
        actor.tenantId,
        'jornada_sin_z',
        journey.id,
        actor.userId,
        actor.at,
      );
      await this.checkTolerance(actor, register.branchId, journey.id, count, {
        caja: register.name,
        fechaJornada: journey.date,
        corte: 'Z',
      });
      await this.record(actor, register.branchId, 'corte_z', 'jornada', journey.id, {
        ...count,
        turnos: shifts.length,
      });
      return {
        journey: { ...journey, status: 'cerrada' },
        registerName: register.name,
        shifts: shifts.length,
        count,
      };
    });
  }
}

// Lo que la caja ofrece a ventas, dentro de la transacción de la venta (plan §2.10): el turno
// abierto de un VO, los VO con turno en una sucursal y el ingreso del cobro en efectivo.
export class ShiftSales {
  constructor(private readonly deps: Pick<CashDependencies, 'cash' | 'ids' | 'alerts'>) {}

  async openShiftOf(tenantId: string, sellerId: string) {
    const shift = await this.deps.cash.openShiftOfSeller(tenantId, sellerId);
    return (
      shift && {
        id: shift.id,
        registerId: shift.registerId,
        branchId: shift.branchId,
        journeyDate: shift.journeyDate,
        sellerName: shift.sellerName,
      }
    );
  }

  async sellersWithOpenShift(tenantId: string, branchId: string) {
    return (await this.deps.cash.openShifts(tenantId, branchId)).map((s) => ({
      id: s.sellerId,
      name: s.sellerName,
    }));
  }

  // Ingreso de una venta en el turno (RF-076). El turno tiene que seguir abierto.
  async recordSale(
    actor: { tenantId: string; userId: string; at: Date },
    input: { shiftId: string; amount: string; methodId: string | null; inCash: boolean },
  ): Promise<void> {
    await this.record(actor, 'venta', input);
  }

  // Cobro de cuenta corriente: entra en la caja del turno y forma parte del arqueo (RF-128).
  async recordCollection(
    actor: { tenantId: string; userId: string; at: Date },
    input: { shiftId: string; amount: string; methodId: string; inCash: boolean },
  ): Promise<void> {
    await this.record(actor, 'cobro', input);
  }

  // Efectivo teórico del turno, para decidir si alcanza un reintegro. Nunca llega a un VO (AD-20).
  async cashOnHand(tenantId: string, shiftId: string): Promise<string> {
    const shift = await this.deps.cash.findShift(tenantId, shiftId, false);
    if (!shift) throw new DomainError('SIN_TURNO', 'No se encontró el turno.');
    return theoreticalCash(shift.initial, await this.deps.cash.movements(tenantId, [shift.id]));
  }

  // Reintegro de una devolución o de una anulación (RF-082, RF-137).
  async recordReturn(
    actor: { tenantId: string; userId: string; at: Date },
    input: {
      shiftId: string;
      amount: string;
      methodId: string | null;
      inCash: boolean;
      type: 'reintegro' | 'anulacion';
      authorizationId: string | null;
    },
  ): Promise<void> {
    await this.record(actor, input.type, input, input.authorizationId);
  }

  // Sin efectivo para el reintegro: el motivo va solo al AS que autoriza (D-28, D-7).
  async refundRejected(
    actor: { tenantId: string; userId: string; at: Date },
    input: { shiftId: string; amount: string; authorizationId: string | null },
  ): Promise<void> {
    const shift = await this.deps.cash.findShift(actor.tenantId, input.shiftId, false);
    if (!shift) return;
    const theoretical = await this.cashOnHand(actor.tenantId, shift.id);
    await this.deps.alerts.add({
      tenantId: actor.tenantId,
      branchId: shift.branchId,
      recipientRole: 'AS',
      type: 'reintegro_rechazado',
      severity: 'advertencia',
      reference: shift.id,
      detail: {
        caja: shift.registerName,
        vendedor: shift.sellerName,
        monto: input.amount,
        efectivoTeorico: theoretical,
        autorizacionId: input.authorizationId,
      },
      at: actor.at,
    });
  }

  private async record(
    actor: { tenantId: string; userId: string; at: Date },
    type: 'venta' | 'cobro' | 'reintegro' | 'anulacion',
    input: { shiftId: string; amount: string; methodId: string | null; inCash: boolean },
    authorizationId: string | null = null,
  ) {
    const shift = await this.deps.cash.findShift(actor.tenantId, input.shiftId, true);
    if (shift?.status !== 'abierto') {
      throw new DomainError('SIN_TURNO', 'El turno ya está cerrado.');
    }
    await this.deps.cash.addMovement(actor.tenantId, {
      id: this.deps.ids.next(),
      shiftId: shift.id,
      type,
      inCash: input.inCash,
      amount: input.amount,
      methodId: input.methodId,
      reason: null,
      authorizationId,
      userId: actor.userId,
      at: actor.at,
    });
  }
}
