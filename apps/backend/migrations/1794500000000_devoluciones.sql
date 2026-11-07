-- Up Migration
-- Devoluciones y anulaciones (T-214; plan §2.13, §3.10).

-- Devolución de ítems de una venta, en la sucursal que los recibe (D-28).
CREATE TABLE devolucion (
  id             uuid          PRIMARY KEY,
  tenant_id      uuid          NOT NULL,
  venta_id       uuid          NOT NULL,
  sucursal_id    uuid          NOT NULL,
  turno_id       uuid          NOT NULL,
  vendedor_id    uuid          NOT NULL REFERENCES usuario (id),
  -- Valor de la mercadería devuelta y lo que se reintegra por los medios originales (D-4).
  valor          numeric(14,2) NOT NULL CHECK (valor > 0),
  reintegro      numeric(14,2) NOT NULL CHECK (reintegro >= 0),
  estado         text          NOT NULL CHECK (estado IN ('pendiente', 'confirmada', 'rechazada')),
  autorizacion_id uuid,
  creada_en      timestamptz   NOT NULL,
  resuelta_en    timestamptz,
  CONSTRAINT devolucion_id_comercio UNIQUE (id, tenant_id),
  CONSTRAINT devolucion_venta FOREIGN KEY (venta_id, tenant_id) REFERENCES venta (id, tenant_id)
);
CREATE INDEX devolucion_por_venta ON devolucion (venta_id);
SELECT aplicar_aislamiento_por_comercio('devolucion');

CREATE TABLE devolucion_item (
  id            uuid          PRIMARY KEY,
  tenant_id     uuid          NOT NULL,
  devolucion_id uuid          NOT NULL,
  venta_item_id uuid          NOT NULL,
  producto_id   uuid          NOT NULL,
  cantidad      numeric(12,3) NOT NULL CHECK (cantidad > 0),
  importe       numeric(14,2) NOT NULL CHECK (importe >= 0),
  CONSTRAINT devolucion_item_devolucion FOREIGN KEY (devolucion_id, tenant_id)
    REFERENCES devolucion (id, tenant_id)
);
SELECT aplicar_aislamiento_por_comercio('devolucion_item');
REVOKE UPDATE ON devolucion_item FROM PUBLIC;

-- Anulación total dentro del turno (D-27): una sola por venta.
CREATE TABLE anulacion (
  id              uuid          PRIMARY KEY,
  tenant_id       uuid          NOT NULL,
  venta_id        uuid          NOT NULL,
  turno_id        uuid          NOT NULL,
  solicitante_id  uuid          NOT NULL REFERENCES usuario (id),
  autorizacion_id uuid          NOT NULL,
  reintegro       numeric(14,2) NOT NULL CHECK (reintegro >= 0),
  creada_en       timestamptz   NOT NULL,
  CONSTRAINT anulacion_id_comercio UNIQUE (id, tenant_id),
  CONSTRAINT anulacion_venta_unica UNIQUE (venta_id),
  CONSTRAINT anulacion_venta FOREIGN KEY (venta_id, tenant_id) REFERENCES venta (id, tenant_id)
);
SELECT aplicar_aislamiento_por_comercio('anulacion');

-- Reintegro por cada medio de pago original (RF-085). Solo inserción.
CREATE TABLE reintegro (
  id             uuid          PRIMARY KEY,
  tenant_id      uuid          NOT NULL,
  devolucion_id  uuid,
  anulacion_id   uuid,
  pago_id        uuid          NOT NULL,
  tipo           text          NOT NULL CHECK (tipo IN ('efectivo', 'electronico', 'cuenta_corriente')),
  -- En cuenta corriente: lo que bajó el saldo; el excedente sale en efectivo (D-29).
  monto          numeric(14,2) NOT NULL CHECK (monto >= 0),
  excedente      numeric(14,2) NOT NULL DEFAULT 0 CHECK (excedente >= 0),
  clave          text,
  registrado_en  timestamptz   NOT NULL,
  CONSTRAINT reintegro_origen CHECK ((devolucion_id IS NULL) <> (anulacion_id IS NULL))
);
CREATE UNIQUE INDEX reintegro_clave ON reintegro (tenant_id, clave) WHERE clave IS NOT NULL;
SELECT aplicar_aislamiento_por_comercio('reintegro');
REVOKE UPDATE ON reintegro FROM PUBLIC;

-- La anulación devuelve el stock al disponible.
ALTER TABLE movimiento_stock DROP CONSTRAINT movimiento_stock_tipo_check;
ALTER TABLE movimiento_stock ADD CONSTRAINT movimiento_stock_tipo_check CHECK (tipo IN (
  'ingreso', 'ajuste', 'merma', 'reserva', 'liberacion', 'venta', 'transferencia', 'recepcion',
  'rechazo', 'cancelacion', 'devolucion', 'reingreso', 'anulacion'
));

ALTER TABLE movimiento_cuenta_corriente DROP CONSTRAINT movimiento_cuenta_corriente_tipo_check;
ALTER TABLE movimiento_cuenta_corriente ADD CONSTRAINT movimiento_cuenta_corriente_tipo_check
  CHECK (tipo IN ('venta', 'cobro', 'devolucion', 'anulacion'));

-- La Nota de Crédito conoce su origen (devolución o anulación) y numera aparte de las facturas.
ALTER TABLE comprobante ADD COLUMN origen_id uuid;
CREATE UNIQUE INDEX comprobante_nota_de_origen ON comprobante (tenant_id, origen_id)
  WHERE tipo = 'nota_credito';
DROP INDEX comprobante_numero;
CREATE UNIQUE INDEX comprobante_numero ON comprobante (tenant_id, tipo, punto_venta, clase, numero)
  WHERE numero IS NOT NULL;

-- Down Migration
DROP INDEX comprobante_numero;
CREATE UNIQUE INDEX comprobante_numero ON comprobante (tenant_id, punto_venta, clase, numero)
  WHERE numero IS NOT NULL;
DROP INDEX comprobante_nota_de_origen;
ALTER TABLE comprobante DROP COLUMN origen_id;
ALTER TABLE movimiento_cuenta_corriente DROP CONSTRAINT movimiento_cuenta_corriente_tipo_check;
ALTER TABLE movimiento_cuenta_corriente ADD CONSTRAINT movimiento_cuenta_corriente_tipo_check
  CHECK (tipo IN ('venta', 'cobro'));
ALTER TABLE movimiento_stock DROP CONSTRAINT movimiento_stock_tipo_check;
ALTER TABLE movimiento_stock ADD CONSTRAINT movimiento_stock_tipo_check CHECK (tipo IN (
  'ingreso', 'ajuste', 'merma', 'reserva', 'liberacion', 'venta', 'transferencia', 'recepcion',
  'rechazo', 'cancelacion', 'devolucion', 'reingreso'
));
DROP TABLE reintegro;
DROP TABLE anulacion;
DROP TABLE devolucion_item;
DROP TABLE devolucion;
