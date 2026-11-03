// Rutas HTTP del módulo de proveedores. El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import { MAX_IMPORT_BYTES } from '../dominio/catalog-import.js';
import { PAYMENT_METHODS, type Supplier } from '../dominio/suppliers.js';
import type { Payment, Purchase, StatementEntry } from '../aplicacion/ports.js';
import type {
  CreateSupplier,
  DeactivateSupplier,
  GetPurchase,
  GetSupplierStatement,
  ImportCatalog,
  ImportResult,
  ListPendingReceptions,
  ListPurchases,
  ListSuppliers,
  ReceivePurchase,
  RegisterPayment,
  RegisterPurchase,
  UpdateSupplier,
} from '../aplicacion/suppliers.js';

export interface SupplierUseCases {
  listSuppliers: ListSuppliers;
  createSupplier: CreateSupplier;
  updateSupplier: UpdateSupplier;
  deactivateSupplier: DeactivateSupplier;
  getStatement: GetSupplierStatement;
  importCatalog: ImportCatalog;
  registerPayment: RegisterPayment;
  listPurchases: ListPurchases;
  getPurchase: GetPurchase;
  registerPurchase: RegisterPurchase;
  listPendingReceptions: ListPendingReceptions;
  receivePurchase: ReceivePurchase;
}

const CSV_TYPES = ['text/csv', 'text/plain', 'application/vnd.ms-excel'] as const;

const idParams = z.object({ id: z.uuid() });
const includeQuery = z.object({ incluirBajas: z.enum(['true', 'false']).optional() });
const purchasesQuery = z.object({ proveedorId: z.uuid().optional() });
const decimal = z.string().max(20);
const optionalText = (max: number) => z.string().max(max).nullable().optional();

const supplierBody = z
  .object({ razonSocial: z.string().max(200), cuit: optionalText(20), contacto: optionalText(300) })
  .strict();
const paymentBody = z
  .object({
    monto: decimal,
    metodo: z.enum(PAYMENT_METHODS),
    comprobante: z.string().max(100),
    confirmarExceso: z.boolean().optional(),
  })
  .strict();
const purchaseBody = z
  .object({
    proveedorId: z.uuid(),
    sucursalId: z.uuid(),
    comprobante: optionalText(100),
    items: z
      .array(z.object({ productoId: z.uuid(), cantidad: decimal, costoUnitario: decimal }).strict())
      .max(200),
  })
  .strict();
const receptionBody = z
  .object({
    items: z.array(z.object({ productoId: z.uuid(), recibida: decimal }).strict()).max(200),
  })
  .strict();

const supplierDto = (s: Supplier) => ({
  id: s.id,
  razonSocial: s.name,
  cuit: s.cuit,
  contacto: s.contact,
  saldoAdeudado: s.balance,
  activo: s.isActive,
});
const statementDto = (e: StatementEntry) => ({
  tipo: e.type,
  id: e.id,
  momento: e.at.toISOString(),
  importe: e.amount,
  referencia: e.reference,
});
const paymentDto = (p: Payment) => ({
  id: p.id,
  monto: p.amount,
  metodo: p.method,
  comprobante: p.reference,
  confirmadoExceso: p.confirmedExcess,
  momento: p.at.toISOString(),
});
const purchaseDto = (p: Purchase) => ({
  id: p.id,
  proveedor: { id: p.supplierId, razonSocial: p.supplierName },
  sucursal: { id: p.branchId, nombre: p.branchName },
  estado: p.state,
  comprobante: p.invoice,
  total: p.total,
  registradaEn: p.registeredAt.toISOString(),
  recibidaEn: p.receivedAt?.toISOString() ?? null,
  items: p.items.map((item) => ({
    productoId: item.productId,
    nombre: item.productName,
    cantidad: item.quantity,
    costoUnitario: item.unitCost,
    subtotal: item.subtotal,
    recibida: item.received,
    diferencia: item.difference,
  })),
});
const importDto = (r: ImportResult) => ({
  id: r.id,
  filasOk: r.ok,
  creados: r.created,
  actualizados: r.updated,
  preciosRecalculados: r.recalculated,
  errores: r.errors.map((e) => ({ fila: e.line, codigoBarras: e.barcode, motivo: e.reason })),
});

// Excel en español suele guardar el CSV en Latin-1: si no es UTF-8 válido, se lee así.
function decodeCsv(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

const MANAGE = 'proveedores.gestionar' as const;
const RECEIVE = 'compras.recibir' as const;

export function supplierRoutes(useCases: SupplierUseCases): HttpRoute[] {
  return [
    // Proveedores (RF-034).
    {
      method: 'get',
      path: '/proveedores',
      action: MANAGE,
      handler: async (req, res) => {
        const { incluirBajas } = parseInput(includeQuery, req.query);
        const list = await useCases.listSuppliers.execute(
          securityContextOf(res),
          incluirBajas === 'true',
        );
        res.json(list.map(supplierDto));
      },
    },
    {
      method: 'post',
      path: '/proveedores',
      action: MANAGE,
      handler: async (req, res) => {
        const body = parseInput(supplierBody, req.body);
        const supplier = await useCases.createSupplier.execute(securityContextOf(res), {
          name: body.razonSocial,
          cuit: body.cuit ?? null,
          contact: body.contacto ?? null,
        });
        res.status(201).json(supplierDto(supplier));
      },
    },
    {
      method: 'patch',
      path: '/proveedores/:id',
      action: MANAGE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(supplierBody.partial().strict(), req.body);
        const supplier = await useCases.updateSupplier.execute(securityContextOf(res), id, {
          ...(body.razonSocial === undefined ? {} : { name: body.razonSocial }),
          ...(body.cuit === undefined ? {} : { cuit: body.cuit }),
          ...(body.contacto === undefined ? {} : { contact: body.contacto }),
        });
        res.json(supplierDto(supplier));
      },
    },
    {
      method: 'post',
      path: '/proveedores/:id/baja',
      action: MANAGE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        await useCases.deactivateSupplier.execute(securityContextOf(res), id);
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/proveedores/:id/cuenta',
      action: MANAGE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const { supplier, entries } = await useCases.getStatement.execute(
          securityContextOf(res),
          id,
        );
        res.json({ proveedor: supplierDto(supplier), movimientos: entries.map(statementDto) });
      },
    },
    // Importación de catálogo (RF-035).
    {
      method: 'post',
      path: '/proveedores/:id/importaciones',
      action: MANAGE,
      binaryBody: { types: CSV_TYPES, maxBytes: MAX_IMPORT_BYTES },
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body: unknown = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          throw new ApplicationError(
            'invalid_request',
            'CSV_INVALIDO',
            'Enviá el catálogo como un archivo CSV de hasta 1 MB.',
          );
        }
        const result = await useCases.importCatalog.execute(
          securityContextOf(res),
          id,
          decodeCsv(body),
        );
        res.json(importDto(result));
      },
    },
    // Pagos (RF-037, RF-038).
    {
      method: 'post',
      path: '/proveedores/:id/pagos',
      action: MANAGE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(paymentBody, req.body);
        const { payment, balance } = await useCases.registerPayment.execute(
          securityContextOf(res),
          id,
          {
            amount: body.monto,
            method: body.metodo,
            reference: body.comprobante,
            confirmExcess: body.confirmarExceso ?? false,
          },
        );
        res.status(201).json({ pago: paymentDto(payment), saldoAdeudado: balance });
      },
    },
    // Compras (RF-036).
    {
      method: 'get',
      path: '/compras',
      action: MANAGE,
      handler: async (req, res) => {
        const { proveedorId } = parseInput(purchasesQuery, req.query);
        const list = await useCases.listPurchases.execute(securityContextOf(res), proveedorId);
        res.json(list.map(purchaseDto));
      },
    },
    {
      method: 'post',
      path: '/compras',
      action: MANAGE,
      handler: async (req, res) => {
        const body = parseInput(purchaseBody, req.body);
        const purchase = await useCases.registerPurchase.execute(securityContextOf(res), {
          supplierId: body.proveedorId,
          branchId: body.sucursalId,
          invoice: body.comprobante ?? null,
          items: body.items.map((item) => ({
            productId: item.productoId,
            quantity: item.cantidad,
            unitCost: item.costoUnitario,
          })),
        });
        res.status(201).json(purchaseDto(purchase));
      },
    },
    {
      method: 'get',
      path: '/compras/:id',
      action: MANAGE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const purchase = await useCases.getPurchase.execute(securityContextOf(res), id);
        res.json(purchaseDto(purchase));
      },
    },
    // Recepción en la sucursal de destino (RF-133).
    {
      method: 'get',
      path: '/recepciones',
      action: RECEIVE,
      handler: async (_req, res) => {
        const list = await useCases.listPendingReceptions.execute(securityContextOf(res));
        res.json(list.map(purchaseDto));
      },
    },
    {
      method: 'post',
      path: '/compras/:id/recepcion',
      action: RECEIVE,
      handler: async (req, res) => {
        const { id } = parseInput(idParams, req.params);
        const body = parseInput(receptionBody, req.body);
        const purchase = await useCases.receivePurchase.execute(
          securityContextOf(res),
          id,
          body.items.map((item) => ({ productId: item.productoId, quantity: item.recibida })),
        );
        res.json(purchaseDto(purchase));
      },
    },
  ];
}
