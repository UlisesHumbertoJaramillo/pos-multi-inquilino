-- Up Migration
-- Inventario, transferencias y alertas (T-088; RF-039 a RF-047, RF-088, RF-150, RF-151). Tablas
-- comerciales, aisladas por comercio con la política plantilla (AD-03). Cantidades en
-- NUMERIC(12,3) (plan §3.1).

-- Saldos de stock de cada producto en cada sucursal, en cuatro estados (RF-039). Los CHECK son la
-- red de seguridad de las actualizaciones condicionales (AD-04): ningún saldo queda negativo.
CREATE TABLE inventario (
  id               uuid          PRIMARY KEY,
  tenant_id        uuid          NOT NULL,
  sucursal_id      uuid          NOT NULL,
  producto_id      uuid          NOT NULL,
  disponible       numeric(12,3) NOT NULL DEFAULT 0 CHECK (disponible >= 0),
  reservado        numeric(12,3) NOT NULL DEFAULT 0 CHECK (reservado >= 0),
  en_revision      numeric(12,3) NOT NULL DEFAULT 0 CHECK (en_revision >= 0),
  en_transito      numeric(12,3) NOT NULL DEFAULT 0 CHECK (en_transito >= 0),
  -- Nulo: sin umbral, no se alerta (RF-040, RF-041).
  umbral_minimo    numeric(12,3) CHECK (umbral_minimo >= 0),
  -- Verdadero mientras el disponible esté por debajo del umbral y la alerta ya se emitió (D-51).
  alerta_activa    boolean       NOT NULL DEFAULT false,
  version          integer       NOT NULL DEFAULT 0,
  actualizado_en   timestamptz   NOT NULL,
  CONSTRAINT inventario_unico UNIQUE (sucursal_id, producto_id),
  CONSTRAINT inventario_sucursal FOREIGN KEY (sucursal_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT inventario_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id)
);
CREATE INDEX inventario_producto_idx ON inventario (producto_id);
SELECT aplicar_aislamiento_por_comercio('inventario');

-- Transferencia entre dos sucursales del mismo comercio (RF-044 a RF-047). Las claves foráneas
-- compuestas con el comercio impiden que origen y destino sean de comercios distintos.
CREATE TABLE transferencia (
  id                  uuid        PRIMARY KEY,
  tenant_id           uuid        NOT NULL,
  sucursal_origen_id  uuid        NOT NULL,
  sucursal_destino_id uuid        NOT NULL,
  estado              text        NOT NULL
    CHECK (estado IN ('enviada', 'recibida', 'parcial', 'rechazada', 'cancelada')),
  emitida_por         uuid        NOT NULL,
  emitida_en          timestamptz NOT NULL,
  cerrada_por         uuid,
  cerrada_en          timestamptz,
  CONSTRAINT transferencia_origen FOREIGN KEY (sucursal_origen_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT transferencia_destino FOREIGN KEY (sucursal_destino_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT transferencia_sucursales_distintas CHECK (sucursal_origen_id <> sucursal_destino_id),
  CONSTRAINT transferencia_cierre CHECK (
    (estado = 'enviada') = (cerrada_en IS NULL) AND (cerrada_en IS NULL) = (cerrada_por IS NULL)
  ),
  CONSTRAINT transferencia_id_comercio UNIQUE (id, tenant_id)
);
CREATE INDEX transferencia_origen_idx ON transferencia (sucursal_origen_id, emitida_en DESC);
CREATE INDEX transferencia_destino_idx ON transferencia (sucursal_destino_id, emitida_en DESC);
SELECT aplicar_aislamiento_por_comercio('transferencia');

-- Recibida + rechazada + faltante = enviada, una vez cerrada (D-36).
CREATE TABLE transferencia_item (
  id               uuid          PRIMARY KEY,
  tenant_id        uuid          NOT NULL,
  transferencia_id uuid          NOT NULL,
  producto_id      uuid          NOT NULL,
  enviada          numeric(12,3) NOT NULL CHECK (enviada > 0),
  recibida         numeric(12,3) CHECK (recibida >= 0),
  rechazada        numeric(12,3) CHECK (rechazada >= 0),
  faltante         numeric(12,3) CHECK (faltante >= 0),
  CONSTRAINT transferencia_item_unico UNIQUE (transferencia_id, producto_id),
  CONSTRAINT transferencia_item_transferencia FOREIGN KEY (transferencia_id, tenant_id)
    REFERENCES transferencia (id, tenant_id),
  CONSTRAINT transferencia_item_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id),
  CONSTRAINT transferencia_item_cuadra CHECK (
    (recibida IS NULL AND rechazada IS NULL AND faltante IS NULL)
    OR (recibida IS NOT NULL AND rechazada IS NOT NULL AND faltante IS NOT NULL
        AND recibida + rechazada + faltante = enviada)
  )
);
SELECT aplicar_aislamiento_por_comercio('transferencia_item');

-- Libro mayor de stock, solo inserción (AD-09). Cada cambio de saldo deja su movimiento con el
-- estado de origen y el de destino (nulo: entra o sale del inventario).
CREATE TABLE movimiento_stock (
  id             uuid          PRIMARY KEY,
  tenant_id      uuid          NOT NULL,
  sucursal_id    uuid          NOT NULL,
  producto_id    uuid          NOT NULL,
  tipo           text          NOT NULL CHECK (tipo IN (
    'ingreso', 'ajuste', 'merma', 'reserva', 'liberacion', 'venta', 'transferencia', 'recepcion',
    'rechazo', 'cancelacion', 'devolucion', 'reingreso'
  )),
  estado_origen  text          CHECK (estado_origen IN ('disponible', 'reservado', 'en_revision', 'en_transito')),
  estado_destino text          CHECK (estado_destino IN ('disponible', 'reservado', 'en_revision', 'en_transito')),
  cantidad       numeric(12,3) NOT NULL CHECK (cantidad > 0),
  -- Operación que lo originó (transferencia, venta, compra...), si la hay.
  referencia     uuid,
  motivo         text          CHECK (length(motivo) <= 200),
  usuario_id     uuid          NOT NULL,
  momento        timestamptz   NOT NULL,
  CONSTRAINT movimiento_stock_estados CHECK (
    estado_origen IS NOT NULL OR estado_destino IS NOT NULL
  ),
  CONSTRAINT movimiento_stock_sucursal FOREIGN KEY (sucursal_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT movimiento_stock_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id)
);
CREATE INDEX movimiento_stock_consulta ON movimiento_stock (sucursal_id, momento DESC);
CREATE INDEX movimiento_stock_producto_idx ON movimiento_stock (producto_id);
REVOKE UPDATE ON movimiento_stock FROM pos_app;
SELECT aplicar_aislamiento_por_comercio('movimiento_stock');

-- Alertas persistentes por destinatario (plan §3.13). Por ahora las emite el inventario (RF-041,
-- RF-045); las de caja, fiscales y de pagos se suman en sus fases.
CREATE TABLE alerta (
  id                  uuid        PRIMARY KEY,
  tenant_id           uuid        NOT NULL,
  sucursal_id         uuid,
  destinatario_rol    text        NOT NULL CHECK (destinatario_rol IN ('AC', 'AS', 'VO')),
  destinatario_id     uuid,
  tipo                text        NOT NULL CHECK (length(tipo) BETWEEN 1 AND 60),
  severidad           text        NOT NULL CHECK (severidad IN ('info', 'advertencia', 'critica')),
  persistente         boolean     NOT NULL DEFAULT false,
  referencia          uuid,
  detalle             jsonb       NOT NULL DEFAULT '{}',
  creada_en           timestamptz NOT NULL,
  resuelta_en         timestamptz,
  resuelta_por        uuid,
  proximo_recordatorio timestamptz,
  CONSTRAINT alerta_sucursal FOREIGN KEY (sucursal_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT alerta_id_comercio UNIQUE (id, tenant_id)
);
CREATE INDEX alerta_pendiente ON alerta (tenant_id, sucursal_id, creada_en DESC)
  WHERE resuelta_en IS NULL;
SELECT aplicar_aislamiento_por_comercio('alerta');

-- Down Migration
DROP TABLE alerta;
DROP TABLE movimiento_stock;
DROP TABLE transferencia_item;
DROP TABLE transferencia;
DROP TABLE inventario;
