-- Up Migration
-- Ventas del POS (T-145; RF-030, RF-031, RF-050 a RF-060, RF-076 a RF-079, RF-116, RF-143,
-- RF-153, plan §3.8). Tablas comerciales, aisladas por comercio (AD-03). La tabla autorizacion,
-- con su CHECK de solicitante distinto del autorizante, ya existe desde T-043.

-- Número de ticket correlativo por comercio, asignado al confirmar (D-81).
CREATE TABLE numerador_ticket (
  tenant_id uuid    PRIMARY KEY REFERENCES comercio (id),
  ultimo    integer NOT NULL CHECK (ultimo >= 0)
);
SELECT aplicar_aislamiento_por_comercio('numerador_ticket');

-- Venta con tres estados independientes (RF-153). El estado de cobro y el fiscal se fijan al
-- confirmar; mientras está en curso son nulos.
CREATE TABLE venta (
  id                      uuid          PRIMARY KEY,
  tenant_id               uuid          NOT NULL,
  sucursal_id             uuid          NOT NULL,
  caja_id                 uuid          NOT NULL,
  turno_id                uuid          NOT NULL,
  vendedor_id             uuid          NOT NULL REFERENCES usuario (id),
  numero_ticket           integer       CHECK (numero_ticket > 0),
  estado_comercial        text          NOT NULL DEFAULT 'en_curso' CHECK (estado_comercial IN
                            ('en_curso', 'pago_por_verificar', 'confirmada', 'descartada', 'anulada')),
  estado_cobro            text          CHECK (estado_cobro IN ('pagada', 'saldo_cuenta_corriente')),
  estado_fiscal           text          CHECK (estado_fiscal IN
                            ('no_se_factura', 'pendiente', 'en_contingencia', 'emitida', 'rechazada')),
  se_factura              boolean,
  factura_decidida_por    uuid,
  subtotal                numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  descuento_promos        numeric(14,2) NOT NULL DEFAULT 0 CHECK (descuento_promos >= 0),
  descuento_manual        numeric(14,2) NOT NULL DEFAULT 0 CHECK (descuento_manual >= 0),
  total                   numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  -- Descuento manual tal como lo ingresó el VO (D-70) y, si superó su cuota, la autorización.
  descuento_tipo          text          CHECK (descuento_tipo IN ('porcentaje', 'monto')),
  descuento_valor         numeric(14,4) CHECK (descuento_valor >= 0),
  descuento_autorizacion_id uuid,
  creada_en               timestamptz   NOT NULL,
  ultima_actividad        timestamptz   NOT NULL,
  confirmada_en           timestamptz,
  descartada_en           timestamptz,
  motivo_descarte         text          CHECK (motivo_descarte IN
                            ('manual', 'inactividad', 'cierre_forzado', 'suspension')),
  version                 integer       NOT NULL DEFAULT 0,
  CONSTRAINT venta_descuento_completo CHECK ((descuento_tipo IS NULL) = (descuento_valor IS NULL)),
  CONSTRAINT venta_descarte CHECK (
    (estado_comercial = 'descartada') = (motivo_descarte IS NOT NULL)
    AND (motivo_descarte IS NULL) = (descartada_en IS NULL)
  ),
  CONSTRAINT venta_confirmada CHECK (
    (estado_comercial IN ('confirmada', 'anulada'))
      = (confirmada_en IS NOT NULL AND numero_ticket IS NOT NULL AND estado_cobro IS NOT NULL
         AND estado_fiscal IS NOT NULL AND se_factura IS NOT NULL)
  ),
  CONSTRAINT venta_fiscal CHECK (se_factura OR estado_fiscal = 'no_se_factura'),
  CONSTRAINT venta_sucursal FOREIGN KEY (sucursal_id, tenant_id) REFERENCES sucursal (id, tenant_id),
  CONSTRAINT venta_caja FOREIGN KEY (caja_id, tenant_id) REFERENCES caja (id, tenant_id),
  CONSTRAINT venta_turno FOREIGN KEY (turno_id, tenant_id) REFERENCES turno (id, tenant_id),
  CONSTRAINT venta_id_comercio UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX venta_ticket ON venta (tenant_id, numero_ticket) WHERE numero_ticket IS NOT NULL;
CREATE INDEX venta_en_curso ON venta (turno_id) WHERE estado_comercial IN ('en_curso', 'pago_por_verificar');
CREATE INDEX venta_por_vendedor ON venta (vendedor_id, estado_comercial);
SELECT aplicar_aislamiento_por_comercio('venta');

-- Ítems con el precio y la promoción fijados al agregarlos (RF-030, RF-031, RF-143). Quitar un
-- ítem es una baja lógica (RN-02).
CREATE TABLE venta_item (
  id                 uuid          PRIMARY KEY,
  tenant_id          uuid          NOT NULL,
  venta_id           uuid          NOT NULL,
  producto_id        uuid          NOT NULL,
  tipo               text          NOT NULL CHECK (tipo IN ('simple', 'combo')),
  nombre             text          NOT NULL,
  categoria_id       uuid,
  cantidad           numeric(12,3) NOT NULL CHECK (cantidad > 0),
  precio_fijado      numeric(14,2) NOT NULL CHECK (precio_fijado >= 0),
  -- Tasa de la categoría; nula en un combo, cuyos componentes llevan la suya (D-18).
  tasa_iva           numeric(7,4),
  promocion_id       uuid,
  descuento_promo    numeric(14,2) NOT NULL DEFAULT 0 CHECK (descuento_promo >= 0),
  descuento_manual   numeric(14,2) NOT NULL DEFAULT 0 CHECK (descuento_manual >= 0),
  importe_final      numeric(14,2) NOT NULL DEFAULT 0 CHECK (importe_final >= 0),
  cantidad_devuelta  numeric(12,3) NOT NULL DEFAULT 0 CHECK (cantidad_devuelta >= 0),
  agregado_en        timestamptz   NOT NULL,
  quitado_en         timestamptz,
  CONSTRAINT venta_item_devuelta CHECK (cantidad_devuelta <= cantidad),
  CONSTRAINT venta_item_iva CHECK ((tipo = 'simple') = (tasa_iva IS NOT NULL)),
  CONSTRAINT venta_item_venta FOREIGN KEY (venta_id, tenant_id) REFERENCES venta (id, tenant_id),
  CONSTRAINT venta_item_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id),
  CONSTRAINT venta_item_id_comercio UNIQUE (id, tenant_id)
);
CREATE INDEX venta_item_por_venta ON venta_item (venta_id) WHERE quitado_en IS NULL;
SELECT aplicar_aislamiento_por_comercio('venta_item');

-- Componentes de un combo vendido, fijados al agregarlo: cantidad por combo, precio de lista y
-- tasa de IVA para el prorrateo (RF-051, RF-124, D-18).
CREATE TABLE venta_item_componente (
  id            uuid          PRIMARY KEY,
  tenant_id     uuid          NOT NULL,
  venta_item_id uuid          NOT NULL,
  producto_id   uuid          NOT NULL,
  nombre        text          NOT NULL,
  cantidad      numeric(12,3) NOT NULL CHECK (cantidad > 0),
  precio_lista  numeric(14,2) NOT NULL CHECK (precio_lista >= 0),
  tasa_iva      numeric(7,4)  NOT NULL,
  CONSTRAINT venta_item_componente_item FOREIGN KEY (venta_item_id, tenant_id)
    REFERENCES venta_item (id, tenant_id),
  CONSTRAINT venta_item_componente_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id)
);
CREATE INDEX venta_item_componente_por_item ON venta_item_componente (venta_item_id);
REVOKE UPDATE ON venta_item_componente FROM pos_app;
SELECT aplicar_aislamiento_por_comercio('venta_item_componente');

-- Pagos de una venta. En esta fase solo efectivo; la Fase 11 suma los demás medios y la pasarela.
CREATE TABLE pago (
  id                 uuid          PRIMARY KEY,
  tenant_id          uuid          NOT NULL,
  venta_id           uuid          NOT NULL,
  metodo_pago_id     uuid,
  tipo               text          NOT NULL CHECK (tipo IN ('efectivo', 'electronico', 'cuenta_corriente')),
  fraccion           numeric(14,2) NOT NULL CHECK (fraccion >= 0),
  recargo            numeric(14,2) NOT NULL DEFAULT 0,
  monto_abonado      numeric(14,2) NOT NULL CHECK (monto_abonado >= 0),
  vuelto             numeric(14,2) NOT NULL DEFAULT 0 CHECK (vuelto >= 0),
  estado             text          NOT NULL CHECK (estado IN
                       ('pendiente', 'aprobado', 'rechazado', 'por_verificar', 'revertido')),
  clave_idempotencia text,
  registrado_en      timestamptz   NOT NULL,
  CONSTRAINT pago_venta FOREIGN KEY (venta_id, tenant_id) REFERENCES venta (id, tenant_id)
);
CREATE UNIQUE INDEX pago_idempotencia ON pago (tenant_id, clave_idempotencia)
  WHERE clave_idempotencia IS NOT NULL;
CREATE INDEX pago_por_venta ON pago (venta_id);
SELECT aplicar_aislamiento_por_comercio('pago');

-- Traspaso de una venta en curso a otro VO de la sucursal con turno abierto (RF-077 a RF-079).
CREATE TABLE traspaso (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  venta_id    uuid        NOT NULL,
  emisor_id   uuid        NOT NULL REFERENCES usuario (id),
  receptor_id uuid        NOT NULL REFERENCES usuario (id),
  estado      text        NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'aceptado', 'rechazado', 'vencido')),
  creado_en   timestamptz NOT NULL,
  vence_en    timestamptz NOT NULL,
  resuelto_en timestamptz,
  CONSTRAINT traspaso_resuelto CHECK ((estado = 'pendiente') = (resuelto_en IS NULL)),
  CONSTRAINT traspaso_otro_vendedor CHECK (emisor_id <> receptor_id),
  CONSTRAINT traspaso_venta FOREIGN KEY (venta_id, tenant_id) REFERENCES venta (id, tenant_id)
);
-- Un solo traspaso pendiente por venta.
CREATE UNIQUE INDEX traspaso_pendiente ON traspaso (venta_id) WHERE estado = 'pendiente';
SELECT aplicar_aislamiento_por_comercio('traspaso');

-- Down Migration
DROP TABLE traspaso;
DROP TABLE pago;
DROP TABLE venta_item_componente;
DROP TABLE venta_item;
DROP TABLE venta;
DROP TABLE numerador_ticket;
