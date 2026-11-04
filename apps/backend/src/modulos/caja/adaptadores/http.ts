// Rutas HTTP de caja. El contrato está en packages/contracts/openapi.yaml.
// DTO por rol (RF-093, RF-112, D-80): ninguna respuesta dirigida a un VO incluye el saldo teórico
// ni el resultado del arqueo.
import type { Response } from 'express';
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type { CashCount } from '../dominio/cash.js';
import type {
  CloseJourney,
  CloseOwnShift,
  ForceCloseShift,
  GetOwnShift,
  JourneyClosure,
  ListOpenShifts,
  ListRegisters,
  OpenShift,
  RecordCashIn,
  RecordWithdrawal,
  RegisterOverview,
  ShiftClosure,
} from '../aplicacion/cash.js';
import type { Shift, StoredMovement } from '../aplicacion/ports.js';

export interface CashUseCases {
  listRegisters: ListRegisters;
  getOwnShift: GetOwnShift;
  openShift: OpenShift;
  recordCashIn: RecordCashIn;
  recordWithdrawal: RecordWithdrawal;
  closeOwnShift: CloseOwnShift;
  listOpenShifts: ListOpenShifts;
  forceCloseShift: ForceCloseShift;
  closeJourney: CloseJourney;
}

const amount = z.string().max(20);
const idParams = z.object({ id: z.uuid() });
const openBody = z.object({ cajaId: z.uuid(), saldoInicial: amount }).strict();
const cashInBody = z.object({ monto: amount, motivo: z.string().max(400) }).strict();
const withdrawalBody = z
  .object({ monto: amount, motivo: z.string().max(400), autorizacionId: z.uuid() })
  .strict();
const declarationBody = z.object({ declarado: amount }).strict();

const registerDto = (r: RegisterOverview) => ({
  id: r.id,
  nombre: r.name,
  jornada: r.journey && {
    id: r.journey.id,
    fecha: r.journey.date,
    abiertaEn: r.journey.openedAt.toISOString(),
  },
  turnoAbierto: r.openShift && {
    id: r.openShift.id,
    vendedorId: r.openShift.sellerId,
    vendedor: r.openShift.sellerName,
    abiertoEn: r.openShift.openedAt.toISOString(),
  },
  requiereCorteZ: r.requiresZ,
});

const shiftDto = (s: Shift) => ({
  id: s.id,
  cajaId: s.registerId,
  caja: s.registerName,
  sucursalId: s.branchId,
  jornadaId: s.journeyId,
  fechaJornada: s.journeyDate,
  vendedorId: s.sellerId,
  vendedor: s.sellerName,
  saldoInicial: s.initial,
  diferenciaInicial: s.openingDifference,
  abiertoEn: s.openedAt.toISOString(),
  estado: s.status,
  forzado: s.forced,
});

const movementDto = (m: StoredMovement) => ({
  id: m.id,
  tipo: m.type,
  enEfectivo: m.inCash,
  monto: m.amount,
  motivo: m.reason,
  registradoEn: m.at.toISOString(),
});

// Un VO solo recibe lo que declaró: el resultado, la diferencia y el teórico viajan hacia un AS o
// un AC (D-80).
function countDto(res: Response, count: CashCount) {
  if (securityContextOf(res).activeRole === 'VO') return { declarado: count.declared };
  return {
    declarado: count.declared,
    diferencia: count.difference,
    resultado: count.result,
    teorico: count.theoretical,
  };
}

const closureDto = (res: Response, c: ShiftClosure) => ({
  turno: shiftDto(c.shift),
  arqueo: countDto(res, c.count),
});

const journeyClosureDto = (res: Response, c: JourneyClosure) => ({
  jornadaId: c.journey.id,
  cajaId: c.journey.registerId,
  caja: c.registerName,
  fechaJornada: c.journey.date,
  turnos: c.shifts,
  arqueo: countDto(res, c.count),
});

export function cashRoutes(useCases: CashUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/caja/sucursales/:id/cajas',
      action: 'caja.corte_z',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const list = await useCases.listRegisters.execute(securityContextOf(res), id);
        res.json(list.map(registerDto));
      },
    },
    {
      method: 'get',
      path: '/caja/turno',
      action: 'ventas.operar',
      handler: async (_req, res) => {
        const detail = await useCases.getOwnShift.execute(securityContextOf(res));
        res.json({
          turno: detail && shiftDto(detail.shift),
          movimientos: (detail?.movements ?? []).map(movementDto),
        });
      },
    },
    {
      method: 'post',
      path: '/caja/turnos',
      action: 'ventas.operar',
      handler: async (req, res) => {
        const body = parseInput(openBody, req.body);
        const shift = await useCases.openShift.execute(securityContextOf(res), {
          registerId: body.cajaId,
          initial: body.saldoInicial,
        });
        res.status(201).json(shiftDto(shift));
      },
    },
    {
      method: 'post',
      path: '/caja/turno/ingresos',
      action: 'devoluciones.iniciar',
      handler: async (req, res) => {
        const body = parseInput(cashInBody, req.body);
        const movement = await useCases.recordCashIn.execute(securityContextOf(res), {
          amount: body.monto,
          reason: body.motivo,
        });
        res.status(201).json(movementDto(movement));
      },
    },
    {
      method: 'post',
      path: '/caja/turno/retiros',
      action: 'devoluciones.iniciar',
      handler: async (req, res) => {
        const body = parseInput(withdrawalBody, req.body);
        const movement = await useCases.recordWithdrawal.execute(securityContextOf(res), {
          amount: body.monto,
          reason: body.motivo,
          authorizationId: body.autorizacionId,
        });
        res.status(201).json(movementDto(movement));
      },
    },
    {
      method: 'post',
      path: '/caja/turno/corte-x',
      action: 'caja.corte_x',
      handler: async (req, res) => {
        const body = parseInput(declarationBody, req.body);
        const closure = await useCases.closeOwnShift.execute(securityContextOf(res), {
          declared: body.declarado,
        });
        res.json(closureDto(res, closure));
      },
    },
    {
      method: 'get',
      path: '/caja/sucursales/:id/turnos-abiertos',
      action: 'caja.cierre_forzado',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const shifts = await useCases.listOpenShifts.execute(securityContextOf(res), id);
        res.json(shifts.map(shiftDto));
      },
    },
    {
      method: 'post',
      path: '/caja/turnos/:id/cierre-forzado',
      action: 'caja.cierre_forzado',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(declarationBody, req.body);
        const closure = await useCases.forceCloseShift.execute(securityContextOf(res), id, {
          declared: body.declarado,
        });
        res.json(closureDto(res, closure));
      },
    },
    {
      method: 'post',
      path: '/caja/cajas/:id/corte-z',
      action: 'caja.corte_z',
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(declarationBody, req.body);
        const closure = await useCases.closeJourney.execute(securityContextOf(res), id, {
          declared: body.declarado,
        });
        res.json(journeyClosureDto(res, closure));
      },
    },
  ];
}
