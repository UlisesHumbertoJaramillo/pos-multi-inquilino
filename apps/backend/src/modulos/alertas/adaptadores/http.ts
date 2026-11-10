// Rutas HTTP de las alertas del rol activo (T-227). El contrato está en
// packages/contracts/openapi.yaml.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type { ListMyAlerts, ResolveAlert, SummarizeMyAlerts } from '../aplicacion/alerts.js';
import type { AlertView } from '../aplicacion/ports.js';
import { MAX_NOTE_LENGTH, SELF_RESOLVING_ALERTS } from '../dominio/alerts.js';

export interface AlertUseCases {
  listMyAlerts: ListMyAlerts;
  summarizeMyAlerts: SummarizeMyAlerts;
  resolveAlert: ResolveAlert;
}

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({ sucursalId: z.uuid().optional() }).strict();
const resolveBody = z
  .object({ nota: z.string().max(MAX_NOTE_LENGTH).nullable().optional() })
  .strict();

export const alertDto = (a: AlertView) => ({
  id: a.id,
  tipo: a.type,
  severidad: a.severity,
  persistente: a.persistent,
  sucursalId: a.branchId,
  sucursal: a.branchName,
  destinatarioRol: a.recipientRole,
  referencia: a.reference,
  detalle: a.detail,
  creadaEn: a.createdAt.toISOString(),
  ultimoRecordatorio: a.lastReminder?.toISOString() ?? null,
  // Las que se resuelven solas no ofrecen la acción de resolver.
  resolubleAMano: !SELF_RESOLVING_ALERTS.includes(a.type),
});

const ACTION = 'alertas.consultar' as const;

export function alertRoutes(useCases: AlertUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/alertas',
      action: ACTION,
      handler: async (req, res) => {
        const query = parseInput(listQuery, req.query);
        const list = await useCases.listMyAlerts.execute(
          securityContextOf(res),
          query.sucursalId ?? null,
        );
        res.json(list.map(alertDto));
      },
    },
    {
      method: 'get',
      path: '/alertas/resumen',
      action: ACTION,
      handler: async (_req, res) => {
        const summary = await useCases.summarizeMyAlerts.execute(securityContextOf(res));
        res.json({ cantidad: summary.count, severidadMaxima: summary.highest });
      },
    },
    {
      method: 'post',
      path: '/alertas/:id/resolucion',
      action: ACTION,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(resolveBody, req.body);
        await useCases.resolveAlert.execute(securityContextOf(res), id, body.nota ?? null);
        res.status(204).end();
      },
    },
  ];
}
