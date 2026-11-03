-- Up Migration
-- Proveedores, importación de catálogo, compras, recepción y pagos (T-104; RF-034 a RF-038,
-- RF-133). Tablas comerciales, aisladas por comercio con la política plantilla (AD-03).

-- Proveedor con su saldo adeudado materializado: sube con cada compra y baja con cada pago.
CREATE TABLE proveedor (
  id              uuid          PRIMARY KEY,
  tenant_id       uuid          NOT NULL REFERENCES comercio (id),
  razon_social    text          NOT NULL CHECK (length(trim(razon_social)) BETWEEN 1 AND 120),
  cuit            text          CHECK (cuit ~ '^[0-9]{11}$'),
  contacto        text          CHECK (length(contacto) <= 200),
  saldo_adeudado  numeric(14,2) NOT NULL DEFAULT 0,
  creado_en       timestamptz   NOT NULL,
  is_active       boolean       NOT NULL DEFAULT true,
  desactivado_en  timestamptz,
  desactivado_por uuid,
  CONSTRAINT proveedor_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  ),
  CONSTRAINT proveedor_id_comercio UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX proveedor_cuit_activo ON proveedor (tenant_id, cuit)
  WHERE is_active AND cuit IS NOT NULL;
SELECT aplicar_aislamiento_por_comercio('proveedor');

-- Importación de catálogo de un proveedor, con el detalle de las filas rechazadas (RF-035, D-49).
CREATE TABLE importacion_catalogo (
  id            uuid        PRIMARY KEY,
  tenant_id     uuid        NOT NULL,
  proveedor_id  uuid        NOT NULL,
  filas_ok      integer     NOT NULL CHECK (filas_ok >= 0),
  creados       integer     NOT NULL CHECK (creados >= 0),
  actualizados  integer     NOT NULL CHECK (actualizados >= 0),
  filas_error   jsonb       NOT NULL DEFAULT '[]',
  usuario_id    uuid        NOT NULL,
  momento       timestamptz NOT NULL,
  CONSTRAINT importacion_catalogo_proveedor FOREIGN KEY (proveedor_id, tenant_id)
    REFERENCES proveedor (id, tenant_id)
);
CREATE INDEX importacion_catalogo_proveedor_idx ON importacion_catalogo (proveedor_id, momento DESC);
REVOKE UPDATE ON importacion_catalogo FROM pos_app;
SELECT aplicar_aislamiento_por_comercio('importacion_catalogo');

-- Compra a crédito con su sucursal de destino, pendiente hasta que un AS de esa sucursal la
-- recibe (RF-036, RF-133, D-25).
CREATE TABLE compra (
  id                  uuid          PRIMARY KEY,
  tenant_id           uuid          NOT NULL,
  proveedor_id        uuid          NOT NULL,
  sucursal_destino_id uuid          NOT NULL,
  estado              text          NOT NULL CHECK (estado IN ('pendiente', 'recibida')),
  comprobante         text          CHECK (length(comprobante) <= 60),
  total               numeric(14,2) NOT NULL CHECK (total >= 0),
  registrada_por      uuid          NOT NULL,
  registrada_en       timestamptz   NOT NULL,
  recibida_por        uuid,
  recibida_en         timestamptz,
  CONSTRAINT compra_proveedor FOREIGN KEY (proveedor_id, tenant_id)
    REFERENCES proveedor (id, tenant_id),
  CONSTRAINT compra_sucursal FOREIGN KEY (sucursal_destino_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT compra_recepcion CHECK (
    (estado = 'pendiente') = (recibida_en IS NULL) AND (recibida_en IS NULL) = (recibida_por IS NULL)
  ),
  CONSTRAINT compra_id_comercio UNIQUE (id, tenant_id)
);
CREATE INDEX compra_proveedor_idx ON compra (proveedor_id, registrada_en DESC);
CREATE INDEX compra_pendiente_idx ON compra (sucursal_destino_id) WHERE estado = 'pendiente';
SELECT aplicar_aislamiento_por_comercio('compra');

CREATE TABLE compra_item (
  id             uuid          PRIMARY KEY,
  tenant_id      uuid          NOT NULL,
  compra_id      uuid          NOT NULL,
  producto_id    uuid          NOT NULL,
  cantidad       numeric(12,3) NOT NULL CHECK (cantidad > 0),
  costo_unitario numeric(14,2) NOT NULL CHECK (costo_unitario >= 0),
  subtotal       numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  CONSTRAINT compra_item_unico UNIQUE (compra_id, producto_id),
  CONSTRAINT compra_item_id_comercio UNIQUE (id, tenant_id),
  CONSTRAINT compra_item_compra FOREIGN KEY (compra_id, tenant_id)
    REFERENCES compra (id, tenant_id),
  CONSTRAINT compra_item_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id)
);
CREATE INDEX compra_item_producto_idx ON compra_item (producto_id);
SELECT aplicar_aislamiento_por_comercio('compra_item');

-- Lo recibido de cada ítem y la diferencia con lo comprado (RF-133). Solo inserción.
CREATE TABLE recepcion_compra_item (
  id                uuid          PRIMARY KEY,
  tenant_id         uuid          NOT NULL,
  compra_item_id    uuid          NOT NULL UNIQUE,
  cantidad_recibida numeric(12,3) NOT NULL CHECK (cantidad_recibida >= 0),
  diferencia        numeric(12,3) NOT NULL CHECK (diferencia >= 0),
  CONSTRAINT recepcion_compra_item_item FOREIGN KEY (compra_item_id, tenant_id)
    REFERENCES compra_item (id, tenant_id)
);
REVOKE UPDATE ON recepcion_compra_item FROM pos_app;
SELECT aplicar_aislamiento_por_comercio('recepcion_compra_item');

-- Lo recibido más la diferencia es lo comprado: nunca se recibe más (plan §3.5), aunque el código
-- tenga un error.
CREATE FUNCTION recepcion_compra_item_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cantidad_recibida + NEW.diferencia <> (SELECT cantidad FROM compra_item WHERE id = NEW.compra_item_id) THEN
    RAISE EXCEPTION 'Lo recibido más la diferencia tiene que ser lo comprado.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'recepcion_compra_item_cuadra';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER recepcion_compra_item_validar
  BEFORE INSERT ON recepcion_compra_item
  FOR EACH ROW EXECUTE FUNCTION recepcion_compra_item_validar();

-- Pago a un proveedor con su comprobante de referencia (RF-037). Si superó la deuda, queda
-- registrado que se confirmó el exceso (RF-038). Solo inserción.
CREATE TABLE pago_proveedor (
  id                uuid          PRIMARY KEY,
  tenant_id         uuid          NOT NULL,
  proveedor_id      uuid          NOT NULL,
  monto             numeric(14,2) NOT NULL CHECK (monto > 0),
  metodo            text          NOT NULL CHECK (metodo IN ('efectivo', 'transferencia', 'cheque', 'otro')),
  comprobante_ref   text          NOT NULL CHECK (length(trim(comprobante_ref)) BETWEEN 1 AND 60),
  confirmado_exceso boolean       NOT NULL DEFAULT false,
  usuario_id        uuid          NOT NULL,
  momento           timestamptz   NOT NULL,
  CONSTRAINT pago_proveedor_proveedor FOREIGN KEY (proveedor_id, tenant_id)
    REFERENCES proveedor (id, tenant_id)
);
CREATE INDEX pago_proveedor_proveedor_idx ON pago_proveedor (proveedor_id, momento DESC);
REVOKE UPDATE ON pago_proveedor FROM pos_app;
SELECT aplicar_aislamiento_por_comercio('pago_proveedor');

-- Down Migration
DROP TABLE pago_proveedor;
DROP TRIGGER recepcion_compra_item_validar ON recepcion_compra_item;
DROP FUNCTION recepcion_compra_item_validar();
DROP TABLE recepcion_compra_item;
DROP TABLE compra_item;
DROP TABLE compra;
DROP TABLE importacion_catalogo;
DROP TABLE proveedor;
