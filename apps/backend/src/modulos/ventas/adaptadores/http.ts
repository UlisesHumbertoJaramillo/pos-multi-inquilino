// Rutas HTTP del POS. El contrato está en packages/contracts/openapi.yaml. Los totales los calcula
// siempre el backend (AD-15): el frontend solo los muestra.
import { z } from 'zod';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import { availableCredit, MANUAL_AFTER_CHECKS } from '../../cobros/aplicacion/gateway.js';
import {
  type ChargeElectronic,
  type ConfirmSale,
  type ListPaymentMethods,
  type PaymentAttempt,
  type ResolvePayment,
  type ReversePayment,
  type SearchCustomers,
  type SetSaleCustomer,
  unpaidBalance,
} from '../aplicacion/payments.js';
import type {
  AcceptTransfer,
  AddItem,
  CartView,
  DiscardSale,
  GetSale,
  ListOwnSales,
  ListTransferTargets,
  Receipt,
  RejectTransfer,
  RemoveItem,
  SearchProducts,
  SendTransfer,
  SetManualDiscount,
  StartSale,
  UpdateItemQuantity,
} from '../aplicacion/sales.js';
import type { Payment, SaleCustomer, SearchResult, Transfer } from '../aplicacion/ports.js';

export interface SalesUseCases {
  startSale: StartSale;
  listOwnSales: ListOwnSales;
  getSale: GetSale;
  searchProducts: SearchProducts;
  addItem: AddItem;
  updateItemQuantity: UpdateItemQuantity;
  removeItem: RemoveItem;
  setManualDiscount: SetManualDiscount;
  discardSale: DiscardSale;
  confirmSale: ConfirmSale;
  chargeElectronic: ChargeElectronic;
  reversePayment: ReversePayment;
  resolvePayment: ResolvePayment;
  setSaleCustomer: SetSaleCustomer;
  searchCustomers: SearchCustomers;
  listPaymentMethods: ListPaymentMethods;
  listTransferTargets: ListTransferTargets;
  sendTransfer: SendTransfer;
  acceptTransfer: AcceptTransfer;
  rejectTransfer: RejectTransfer;
}

const quantity = z.string().max(20);
const idParams = z.object({ id: z.uuid() });
const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });
const searchQuery = z.object({ q: z.string().max(100) });
const addBody = z.object({ productoId: z.uuid(), cantidad: quantity }).strict();
const quantityBody = z.object({ cantidad: quantity }).strict();
const discountBody = z
  .object({
    descuento: z
      .object({ tipo: z.enum(['porcentaje', 'monto']), valor: z.string().max(20) })
      .strict()
      .nullable(),
    autorizacionId: z.uuid().nullable().optional(),
  })
  .strict();
const money = z.string().max(20);
const payBody = z
  .object({
    entregado: money.nullable().optional(),
    facturar: z.boolean().nullable().optional(),
    pagos: z
      .array(
        z
          .object({
            metodoPagoId: z.uuid(),
            fraccion: money,
            entregado: money.nullable().optional(),
          })
          .strict(),
      )
      .max(10)
      .optional(),
    autorizacionId: z.uuid().nullable().optional(),
  })
  .strict();
const chargeBody = z
  .object({ metodoPagoId: z.uuid(), fraccion: money, claveIdempotencia: z.uuid() })
  .strict();
const paymentParams = z.object({ id: z.uuid(), pagoId: z.uuid() });
const resolveBody = z
  .object({ resultado: z.enum(['aprobado', 'rechazado']), autorizacionId: z.uuid() })
  .strict();
const customerBody = z.object({ clienteId: z.uuid().nullable() }).strict();
const transferBody = z.object({ receptorId: z.uuid() }).strict();

const transferDto = (t: Transfer) => ({
  id: t.id,
  ventaId: t.saleId,
  emisorId: t.senderId,
  emisor: t.senderName,
  receptorId: t.receiverId,
  receptor: t.receiverName,
  estado: t.state,
  creadoEn: t.createdAt.toISOString(),
  venceEn: t.expiresAt.toISOString(),
});

const paymentDto = (p: Payment) => ({
  id: p.id,
  metodoPagoId: p.methodId,
  metodo: p.methodName,
  tipo: p.type,
  fraccion: p.fraction,
  recargo: p.adjustment,
  entregado: p.tendered,
  vuelto: p.change,
  estado: p.state,
  resolucionManual: p.state === 'por_verificar' && p.checks >= MANUAL_AFTER_CHECKS,
});

const customerDto = (c: SaleCustomer) => ({
  id: c.id,
  razonSocial: c.name,
  documento: c.document,
  cuentaCorriente: c.hasAccount,
  saldo: c.balance,
  disponible: availableCredit(c.creditLimit, c.balance),
});

const cartDto = ({ sale, priced, transfer, payments, customer }: CartView) => ({
  id: sale.id,
  estado: sale.state,
  numeroTicket: sale.ticket,
  sucursalId: sale.branchId,
  cajaId: sale.registerId,
  turnoId: sale.shiftId,
  vendedorId: sale.sellerId,
  items: priced.items.map((i) => ({
    id: i.id,
    productoId: i.productId,
    tipo: i.type,
    nombre: i.name,
    cantidad: i.quantity,
    precioUnitario: i.fixedPrice,
    promocion:
      i.promotionId === null
        ? null
        : { id: i.promotionId, nombre: priced.promotionNames.get(i.promotionId) ?? '' },
    descuentoPromocion: i.promoDiscount,
    descuentoManual: i.manualDiscount,
    importeFinal: i.final,
  })),
  subtotal: priced.subtotal,
  descuentoPromociones: priced.promoDiscount,
  descuentoManual: priced.manualDiscount,
  descuento: sale.discount && {
    tipo: sale.discount.type,
    valor: sale.discount.value,
    autorizado: sale.discountAuthorizationId !== null,
  },
  total: priced.total,
  iva: priced.vat.map((v) => ({ tasa: v.rate, base: v.taxed, neto: v.net, iva: v.vat })),
  traspaso: transfer && transferDto(transfer),
  ultimaActividad: sale.lastActivity.toISOString(),
  cliente: customer && customerDto(customer),
  pagos: payments.map(paymentDto),
  porCobrar: unpaidBalance(priced.total, payments),
});

const receiptDto = (r: Receipt) => ({
  venta: cartDto({
    sale: r.sale,
    priced: r.priced,
    transfer: null,
    payments: r.payments,
    customer: r.customer,
  }),
  numeroTicket: r.sale.ticket,
  cobrado: r.charged,
  ajuste: r.adjustment,
  entregado: r.tendered,
  vuelto: r.change,
  seFactura: r.sale.billed,
  estadoFiscal: r.sale.fiscalState,
  estadoCobro: r.sale.paymentState,
  pagos: r.payments.map(paymentDto),
});

const attemptDto = (a: PaymentAttempt) => ({ venta: cartDto(a.cart), pago: paymentDto(a.payment) });

const searchDto = (p: SearchResult) => ({
  id: p.id,
  nombre: p.name,
  tipo: p.type,
  codigoBarras: p.barcode,
  precio: p.price,
  disponible: p.available,
});

const OPERATE = 'ventas.operar' as const;

export function salesRoutes(useCases: SalesUseCases): HttpRoute[] {
  return [
    {
      method: 'get',
      path: '/ventas',
      action: OPERATE,
      handler: async (_req, res) => {
        const own = await useCases.listOwnSales.execute(securityContextOf(res));
        res.json({
          ventas: own.sales.map(cartDto),
          traspasosRecibidos: own.incoming.map(transferDto),
        });
      },
    },
    {
      method: 'post',
      path: '/ventas',
      action: OPERATE,
      handler: async (_req, res) => {
        res.status(201).json(cartDto(await useCases.startSale.execute(securityContextOf(res))));
      },
    },
    {
      // Antes de /ventas/:id, para que "productos" no se tome como un id.
      method: 'get',
      path: '/ventas/productos',
      action: OPERATE,
      handler: async (req, res) => {
        const { q } = parseInput(searchQuery, req.query);
        const found = await useCases.searchProducts.execute(securityContextOf(res), q);
        res.json(found.map(searchDto));
      },
    },
    {
      method: 'get',
      path: '/ventas/clientes',
      action: OPERATE,
      handler: async (req, res) => {
        const { q } = parseInput(searchQuery, req.query);
        const found = await useCases.searchCustomers.execute(securityContextOf(res), q);
        res.json(found.map(customerDto));
      },
    },
    {
      method: 'get',
      path: '/ventas/metodos-pago',
      action: OPERATE,
      handler: async (_req, res) => {
        const methods = await useCases.listPaymentMethods.execute(securityContextOf(res));
        res.json(
          methods.map((m) => ({
            id: m.id,
            nombre: m.name,
            tipo: m.type,
            recargoPct: m.adjustmentPct,
          })),
        );
      },
    },
    {
      method: 'post',
      path: '/ventas/traspasos/:id/aceptacion',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(cartDto(await useCases.acceptTransfer.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'post',
      path: '/ventas/traspasos/:id/rechazo',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.rejectTransfer.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/ventas/:id',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        res.json(cartDto(await useCases.getSale.execute(securityContextOf(res), id)));
      },
    },
    {
      method: 'post',
      path: '/ventas/:id/items',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(addBody, req.body);
        const cart = await useCases.addItem.execute(securityContextOf(res), id, {
          productId: body.productoId,
          quantity: body.cantidad,
        });
        res.json(cartDto(cart));
      },
    },
    {
      method: 'patch',
      path: '/ventas/:id/items/:itemId',
      action: OPERATE,
      handler: async (req, res) => {
        const { id, itemId } = parseInput(itemParams, req.params);
        const body = parseInput(quantityBody, req.body);
        const cart = await useCases.updateItemQuantity.execute(
          securityContextOf(res),
          id,
          itemId,
          body.cantidad,
        );
        res.json(cartDto(cart));
      },
    },
    {
      method: 'post',
      path: '/ventas/:id/items/:itemId/baja',
      action: OPERATE,
      handler: async (req, res) => {
        const { id, itemId } = parseInput(itemParams, req.params);
        res.json(cartDto(await useCases.removeItem.execute(securityContextOf(res), id, itemId)));
      },
    },
    {
      method: 'put',
      path: '/ventas/:id/descuento',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(discountBody, req.body);
        const cart = await useCases.setManualDiscount.execute(securityContextOf(res), id, {
          discount: body.descuento && { type: body.descuento.tipo, value: body.descuento.valor },
          authorizationId: body.autorizacionId ?? null,
        });
        res.json(cartDto(cart));
      },
    },
    {
      method: 'post',
      path: '/ventas/:id/descarte',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.discardSale.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'post',
      path: '/ventas/:id/cobro',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(payBody, req.body);
        const receipt = await useCases.confirmSale.execute(securityContextOf(res), id, {
          lines:
            body.pagos?.map((p) => ({
              methodId: p.metodoPagoId,
              fraction: p.fraccion,
              tendered: p.entregado ?? null,
            })) ?? null,
          tendered: body.entregado ?? null,
          invoice: body.facturar ?? null,
          authorizationId: body.autorizacionId ?? null,
        });
        res.json(receiptDto(receipt));
      },
    },
    {
      method: 'put',
      path: '/ventas/:id/cliente',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(customerBody, req.body);
        const cart = await useCases.setSaleCustomer.execute(
          securityContextOf(res),
          id,
          body.clienteId,
        );
        res.json(cartDto(cart));
      },
    },
    {
      method: 'post',
      path: '/ventas/:id/pagos',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(chargeBody, req.body);
        const attempt = await useCases.chargeElectronic.execute(securityContextOf(res), id, {
          methodId: body.metodoPagoId,
          fraction: body.fraccion,
          key: body.claveIdempotencia,
        });
        res.status(201).json(attemptDto(attempt));
      },
    },
    {
      method: 'post',
      path: '/ventas/:id/pagos/:pagoId/reversion',
      action: OPERATE,
      handler: async (req, res) => {
        const { id, pagoId } = parseInput(paymentParams, req.params);
        res.json(
          cartDto(await useCases.reversePayment.execute(securityContextOf(res), id, pagoId)),
        );
      },
    },
    {
      method: 'post',
      path: '/ventas/:id/pagos/:pagoId/resolucion',
      action: OPERATE,
      handler: async (req, res) => {
        const { id, pagoId } = parseInput(paymentParams, req.params);
        const body = parseInput(resolveBody, req.body);
        const cart = await useCases.resolvePayment.execute(securityContextOf(res), id, pagoId, {
          result: body.resultado,
          authorizationId: body.autorizacionId,
        });
        res.json(cartDto(cart));
      },
    },
    {
      method: 'get',
      path: '/ventas/:id/receptores',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const targets = await useCases.listTransferTargets.execute(securityContextOf(res), id);
        res.json(targets.map((t) => ({ id: t.id, nombre: t.name })));
      },
    },
    {
      method: 'post',
      path: '/ventas/:id/traspaso',
      action: OPERATE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(transferBody, req.body);
        const transfer = await useCases.sendTransfer.execute(
          securityContextOf(res),
          id,
          body.receptorId,
        );
        res.status(201).json(transferDto(transfer));
      },
    },
  ];
}
