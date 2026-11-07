// Rutas HTTP de devoluciones y anulaciones (solo el VO). El contrato está en
// packages/contracts/openapi.yaml. Los importes los calcula el backend.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type {
  ConfirmReturn,
  FindTicket,
  QuoteReturn,
  ReturnPlan,
  TicketView,
  VoidSale,
} from '../aplicacion/returns.js';

export interface ReturnUseCases {
  findTicket: FindTicket;
  quoteReturn: QuoteReturn;
  confirmReturn: ConfirmReturn;
  voidSale: VoidSale;
}

const idParams = z.object({ id: z.uuid() });
const ticketParams = z.object({ numero: z.coerce.number().int().positive() });
const items = z
  .array(z.object({ itemId: z.uuid(), cantidad: z.string().max(20) }).strict())
  .max(100);
const quoteBody = z.object({ items }).strict();
const confirmBody = z.object({ items, autorizacionId: z.uuid().nullable().optional() }).strict();
const voidBody = z
  .object({ autorizacionId: z.uuid().nullable().optional(), items: items.optional() })
  .strict();

const toRequests = (list: z.infer<typeof items>) =>
  list.map((i) => ({ itemId: i.itemId, quantity: i.cantidad }));

const ticketDto = (t: TicketView) => ({
  ventaId: t.sale.id,
  numeroTicket: t.sale.ticket,
  sucursal: t.sale.branchName,
  estado: t.sale.state,
  total: t.sale.total,
  facturada: t.sale.billed === true,
  anulable: t.voidable,
  items: t.returnable.map((r) => ({
    id: r.item.id,
    nombre: r.item.name,
    cantidad: r.item.quantity,
    devuelta: r.item.returned,
    devolvible: r.available,
    importe: r.item.final,
  })),
});

const planDto = (p: ReturnPlan) => ({
  valor: p.value,
  reintegro: p.refund,
  efectivo: p.cash,
  cuentaCorriente: p.creditReduction,
  porMedio: p.parts.map((part) => ({
    metodo: part.payment.methodName,
    tipo: part.payment.type,
    monto: part.amount,
  })),
  requiereAutorizacion: p.requiresAuthorization,
  operacionRef: p.reference,
});

const OPERATE = 'devoluciones.iniciar' as const;

export function returnRoutes(useCases: ReturnUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/devoluciones/tickets/:numero',
      action: OPERATE,
      handler: async (req, res) => {
        const { numero } = parseInput(ticketParams, req.params);
        res.json(ticketDto(await useCases.findTicket.execute(securityContextOf(res), numero)));
      },
    },
    {
      method: 'post',
      path: '/devoluciones/ventas/:id/cotizacion',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(quoteBody, req.body);
        const plan = await useCases.quoteReturn.execute(
          securityContextOf(res),
          id,
          toRequests(body.items),
        );
        res.json(planDto(plan));
      },
    },
    {
      method: 'post',
      path: '/devoluciones/ventas/:id',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(confirmBody, req.body);
        const result = await useCases.confirmReturn.execute(securityContextOf(res), id, {
          items: toRequests(body.items),
          authorizationId: body.autorizacionId ?? null,
        });
        res.status(201).json({ id: result.id, ...planDto(result.plan) });
      },
    },
    {
      method: 'post',
      path: '/devoluciones/ventas/:id/anulacion',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(voidBody, req.body);
        const result = await useCases.voidSale.execute(securityContextOf(res), id, {
          authorizationId: body.autorizacionId ?? null,
          items: body.items ? toRequests(body.items) : null,
        });
        res.status(201).json({ id: result.id, reintegro: result.refund });
      },
    },
  ];
}
