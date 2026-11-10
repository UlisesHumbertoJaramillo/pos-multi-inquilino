// Recursos del comercio A para las pruebas de acceso cruzado (T-243, criterio 2 del spec).
import { ownerQuery } from './database.js';
import { BRANCH_B, BRANCH_CENTRO, BRANCH_NORTE, TENANT_A, USERS } from './identity-fixtures.js';

export const REGISTER_A = 'a2000000-0000-4000-8000-000000000001';
export const PAYMENT_METHOD_A = 'a3000000-0000-4000-8000-000000000001';
export const CATEGORY_A = 'a4000000-0000-4000-8000-000000000001';
export const PRODUCT_A = 'a5000000-0000-4000-8000-000000000001';
export const PRICE_LIST_A = 'a6000000-0000-4000-8000-000000000001';
export const SUPPLIER_A = 'a8000000-0000-4000-8000-000000000001';
export const PURCHASE_A = 'a9000000-0000-4000-8000-000000000001';
export const PROMOTION_A = 'aa000000-0000-4000-8000-000000000001';
export const TRANSFER_A = 'a7000000-0000-4000-8000-000000000001';
export const JOURNEY_A = 'ac000000-0000-4000-8000-000000000001';
export const SHIFT_A = 'ad000000-0000-4000-8000-000000000001';
export const SALE_A = 'ae000000-0000-4000-8000-000000000001';
export const SALE_TRANSFER_A = 'af000000-0000-4000-8000-000000000001';
export const CUSTOMER_A = 'b0000000-0000-4000-8000-000000000001';
export const COLLECTION_A = 'b6000000-0000-4000-8000-000000000001';
export const VOUCHER_A = 'b2000000-0000-4000-8000-000000000001';
export const ALERT_A = 'b3000000-0000-4000-8000-000000000001';
export const CREDIT_NOTE_A = 'b4000000-0000-4000-8000-000000000001';
export const SUPPORT_TICKET_A = 'b5000000-0000-4000-8000-000000000001';
export const CONFIRMED_TICKET_NUMBER_A = 4711;

// Un cuerpo válido: la respuesta tiene que depender del recurso, no de los datos.
export const bodyFor = (path: string): object => {
  if (path.endsWith('/cajas')) return { nombre: 'Intrusa' };
  if (path.endsWith('/roles')) return { roles: [{ rol: 'VO', sucursalId: BRANCH_B }] };
  if (path.endsWith('/precios/:productoId')) return { precio: '1' };
  if (path.endsWith('/lista')) return { listaId: PRICE_LIST_A };
  if (path.endsWith('/ajustes'))
    return { productoId: PRODUCT_A, cantidad: '1', motivo: 'Intrusión' };
  if (path.endsWith('/umbrales/:productoId')) return { umbral: '1' };
  if (path.endsWith('/mermas')) return { productoId: PRODUCT_A, cantidad: '1', motivo: 'rotura' };
  if (path.endsWith('/revision/:productoId')) return { accion: 'reingresar', cantidad: '1' };
  if (path.endsWith('/recepcion')) return { items: [] };
  if (path.endsWith('/corte-z') || path.endsWith('/cierre-forzado')) return { declarado: '0' };
  if (path === '/ventas/:id/items') return { productoId: PRODUCT_A, cantidad: '1' };
  if (path === '/ventas/:id/items/:itemId') return { cantidad: '1' };
  if (path.endsWith('/descuento')) return { descuento: null };
  if (path.endsWith('/traspaso')) return { receptorId: USERS.asVo.id };
  if (path.endsWith('/vendedores/:usuarioId')) return { porcentajeMaximo: '0', monto: '0' };
  if (path === '/ventas/:id/pagos')
    return { metodoPagoId: PAYMENT_METHOD_A, fraccion: '1', claveIdempotencia: TRANSFER_A };
  if (path.endsWith('/pagos')) return { monto: '1', metodo: 'efectivo', comprobante: 'Intrusión' };
  if (path === '/alertas/:id/resolucion') return { nota: 'Intrusión' };
  if (path.endsWith('/resolucion')) return { resultado: 'aprobado', autorizacionId: TRANSFER_A };
  if (path === '/ventas/:id/cliente') return { clienteId: null };
  if (path.startsWith('/devoluciones/ventas/:id'))
    return { items: [{ itemId: SALE_A, cantidad: '1' }] };
  if (path === '/clientes/:id') return { razonSocial: 'X', condicionFiscal: 'exento' };
  if (path.endsWith('/credito')) return { cuentaCorriente: true, limite: '1' };
  if (path.endsWith('/cobros'))
    return { metodoPagoId: PAYMENT_METHOD_A, monto: '1', claveIdempotencia: TRANSFER_A };
  return {};
};

export async function seedForeignResources(): Promise<void> {
  await ownerQuery(
    `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, creado_en)
     VALUES ($1, $2, $3, 'Caja A', now())`,
    [REGISTER_A, TENANT_A, BRANCH_CENTRO],
  );
  await ownerQuery(
    `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en)
     VALUES ($1, $2, 'Efectivo', 'efectivo', 0, now())`,
    [PAYMENT_METHOD_A, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Bebidas', 21, now())`,
    [CATEGORY_A, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, categoria_id, costo, creado_en)
     VALUES ($1, $2, 'simple', 'Agua', $3, 100, now())`,
    [PRODUCT_A, TENANT_A, CATEGORY_A],
  );
  await ownerQuery(
    `INSERT INTO lista_precio (id, tenant_id, nombre, regla, creado_en)
     VALUES ($1, $2, 'Minorista', 'fijo', now())`,
    [PRICE_LIST_A, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO transferencia (id, tenant_id, sucursal_origen_id, sucursal_destino_id, estado,
       emitida_por, emitida_en)
     VALUES ($1, $2, $3, $4, 'enviada', $5, now())`,
    [TRANSFER_A, TENANT_A, BRANCH_CENTRO, BRANCH_NORTE, USERS.asVo.id],
  );
  await ownerQuery(
    `INSERT INTO proveedor (id, tenant_id, razon_social, creado_en) VALUES ($1, $2, 'Sur', now())`,
    [SUPPLIER_A, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO compra (id, tenant_id, proveedor_id, sucursal_destino_id, estado, total,
       registrada_por, registrada_en)
     VALUES ($1, $2, $3, $4, 'pendiente', 0, $5, now())`,
    [PURCHASE_A, TENANT_A, SUPPLIER_A, BRANCH_CENTRO, USERS.ac.id],
  );
  await ownerQuery(
    `INSERT INTO promocion (id, tenant_id, nombre, tipo, alcance, categoria_id, parametros,
       vigente_desde, vigente_hasta, creado_en)
     VALUES ($1, $2, '2x1', 'nxm', 'categoria', $3, '{"lleva": 2, "paga": 1}', now(),
       now() + interval '30 days', now())`,
    [PROMOTION_A, TENANT_A, CATEGORY_A],
  );
  await ownerQuery(
    `INSERT INTO jornada (id, tenant_id, caja_id, sucursal_id, fecha_jornada, abierta_en)
     VALUES ($1, $2, $3, $4, '2026-11-02', now())`,
    [JOURNEY_A, TENANT_A, REGISTER_A, BRANCH_CENTRO],
  );
  await ownerQuery(
    `INSERT INTO turno (id, tenant_id, caja_id, sucursal_id, jornada_id, vendedor_id,
       saldo_inicial, abierto_en)
     VALUES ($1, $2, $3, $4, $5, $6, 0, now())`,
    [SHIFT_A, TENANT_A, REGISTER_A, BRANCH_CENTRO, JOURNEY_A, USERS.vo.id],
  );
  await ownerQuery(
    `INSERT INTO venta (id, tenant_id, sucursal_id, caja_id, turno_id, vendedor_id, creada_en,
       ultima_actividad)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
    [SALE_A, TENANT_A, BRANCH_CENTRO, REGISTER_A, SHIFT_A, USERS.vo.id],
  );
  await ownerQuery(
    `INSERT INTO traspaso (id, tenant_id, venta_id, emisor_id, receptor_id, creado_en, vence_en)
     VALUES ($1, $2, $3, $4, $5, now(), now() + interval '15 minutes')`,
    [SALE_TRANSFER_A, TENANT_A, SALE_A, USERS.vo.id, USERS.asVo.id],
  );
  await ownerQuery(
    `INSERT INTO cliente (id, tenant_id, razon_social, condicion_fiscal, creado_en)
     VALUES ($1, $2, 'Cliente A', 'consumidor_final', now())`,
    [CUSTOMER_A, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO cobro_cuenta_corriente (id, tenant_id, cliente_id, sucursal_id, turno_id,
       vendedor_id, monto, estado, creado_en)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 'por_verificar', now())`,
    [COLLECTION_A, TENANT_A, CUSTOMER_A, BRANCH_CENTRO, SHIFT_A, USERS.vo.id],
  );
  await ownerQuery(
    `INSERT INTO comprobante (id, tenant_id, tipo, venta_id, sucursal_id, caja_id, total, estado,
       proximo_intento, plazo_vence, emitido_en)
     VALUES ($1, $2, 'factura', $3, $4, $5, 1, 'rechazado', now(), now(), now())`,
    [VOUCHER_A, TENANT_A, SALE_A, BRANCH_CENTRO, REGISTER_A],
  );
  await ownerQuery(
    `INSERT INTO alerta (id, tenant_id, sucursal_id, destinatario_rol, tipo, severidad, creada_en)
     VALUES ($1, $2, $3, 'AC', 'transferencia_faltante', 'advertencia', now())`,
    [ALERT_A, TENANT_A, BRANCH_CENTRO],
  );
  await ownerQuery(
    `INSERT INTO comprobante (id, tenant_id, tipo, venta_id, sucursal_id, caja_id, original_id, total,
       estado, proximo_intento, plazo_vence, emitido_en)
     VALUES ($1, $2, 'nota_credito', $3, $4, $5, $6, 1, 'rechazado', now(), now(), now())`,
    [CREDIT_NOTE_A, TENANT_A, SALE_A, BRANCH_CENTRO, REGISTER_A, VOUCHER_A],
  );
  await ownerQuery(
    `INSERT INTO ticket_soporte (id, tenant_id, autor_id, asunto, creado_en, actualizado_en)
     VALUES ($1, $2, $3, 'Consulta de A', now(), now())`,
    [SUPPORT_TICKET_A, TENANT_A, USERS.ac.id],
  );
}
