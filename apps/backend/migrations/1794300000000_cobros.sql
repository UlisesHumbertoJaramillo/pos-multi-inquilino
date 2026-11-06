-- Up Migration
-- Cobros, clientes y crédito (T-166; plan §2.12, §3.9): clientes del comercio con su cuenta
-- corriente, cobros de cuenta corriente con recibo y pagos electrónicos con la pasarela.

CREATE TABLE cliente (
  id                     uuid          PRIMARY KEY,
  tenant_id              uuid          NOT NULL REFERENCES comercio (id),
  razon_social           text          NOT NULL CHECK (length(trim(razon_social)) BETWEEN 1 AND 120),
  documento              text          CHECK (length(trim(documento)) BETWEEN 1 AND 20),
  condicion_fiscal       text          NOT NULL CHECK (condicion_fiscal IN (
                           'consumidor_final', 'responsable_inscripto', 'monotributista', 'exento')),
  tiene_cuenta_corriente boolean       NOT NULL DEFAULT false,
  limite_credito         numeric(14,2) NOT NULL DEFAULT 0 CHECK (limite_credito >= 0),
  -- Lo adeudado: nunca negativo, no hay saldo a favor (D-23, D-29).
  saldo                  numeric(14,2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  -- Parte del saldo tomada por cobros electrónicos sin resultado: no se puede volver a cobrar.
  comprometido           numeric(14,2) NOT NULL DEFAULT 0 CHECK (comprometido >= 0),
  version                integer       NOT NULL DEFAULT 1,
  creado_en              timestamptz   NOT NULL,
  is_active              boolean       NOT NULL DEFAULT true,
  desactivado_en         timestamptz,
  desactivado_por        uuid,
  CONSTRAINT cliente_id_comercio UNIQUE (id, tenant_id),
  CONSTRAINT cliente_comprometido_cubierto CHECK (comprometido <= saldo),
  CONSTRAINT cliente_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  )
);
CREATE UNIQUE INDEX cliente_documento_activo ON cliente (tenant_id, documento)
  WHERE is_active AND documento IS NOT NULL;
SELECT aplicar_aislamiento_por_comercio('cliente');

CREATE TABLE numerador_recibo (
  tenant_id uuid   PRIMARY KEY REFERENCES comercio (id),
  ultimo    bigint NOT NULL
);
SELECT aplicar_aislamiento_por_comercio('numerador_recibo');

-- Un cobro de cuenta corriente: monto es lo que baja la deuda; el recargo va en su pago.
CREATE TABLE cobro_cuenta_corriente (
  id          uuid          PRIMARY KEY,
  tenant_id   uuid          NOT NULL,
  cliente_id  uuid          NOT NULL,
  sucursal_id uuid          NOT NULL,
  turno_id    uuid          NOT NULL,
  vendedor_id uuid          NOT NULL REFERENCES usuario (id),
  monto       numeric(14,2) NOT NULL CHECK (monto > 0),
  estado      text          NOT NULL CHECK (estado IN
                ('pendiente', 'por_verificar', 'aplicado', 'rechazado')),
  creado_en   timestamptz   NOT NULL,
  resuelto_en timestamptz,
  CONSTRAINT cobro_id_comercio UNIQUE (id, tenant_id),
  CONSTRAINT cobro_cliente FOREIGN KEY (cliente_id, tenant_id) REFERENCES cliente (id, tenant_id)
);
CREATE INDEX cobro_por_turno ON cobro_cuenta_corriente (turno_id);
SELECT aplicar_aislamiento_por_comercio('cobro_cuenta_corriente');

CREATE TABLE recibo (
  id         uuid          PRIMARY KEY,
  tenant_id  uuid          NOT NULL,
  numero     bigint        NOT NULL,
  cobro_id   uuid          NOT NULL,
  cliente_id uuid          NOT NULL,
  turno_id   uuid          NOT NULL,
  monto      numeric(14,2) NOT NULL CHECK (monto > 0),
  emitido_en timestamptz   NOT NULL,
  CONSTRAINT recibo_numero UNIQUE (tenant_id, numero),
  CONSTRAINT recibo_cobro_unico UNIQUE (cobro_id),
  CONSTRAINT recibo_cobro FOREIGN KEY (cobro_id, tenant_id)
    REFERENCES cobro_cuenta_corriente (id, tenant_id)
);
SELECT aplicar_aislamiento_por_comercio('recibo');

-- Historial de la cuenta corriente: solo inserción.
CREATE TABLE movimiento_cuenta_corriente (
  id               uuid          PRIMARY KEY,
  tenant_id        uuid          NOT NULL,
  cliente_id       uuid          NOT NULL,
  tipo             text          NOT NULL CHECK (tipo IN ('venta', 'cobro')),
  monto            numeric(14,2) NOT NULL CHECK (monto > 0),
  saldo_resultante numeric(14,2) NOT NULL CHECK (saldo_resultante >= 0),
  venta_id         uuid,
  cobro_id         uuid,
  registrado_por   uuid          NOT NULL REFERENCES usuario (id),
  registrado_en    timestamptz   NOT NULL,
  CONSTRAINT movimiento_cc_cliente FOREIGN KEY (cliente_id, tenant_id)
    REFERENCES cliente (id, tenant_id),
  CONSTRAINT movimiento_cc_origen CHECK ((venta_id IS NULL) <> (cobro_id IS NULL))
);
CREATE INDEX movimiento_cc_por_cliente ON movimiento_cuenta_corriente (cliente_id, registrado_en);
SELECT aplicar_aislamiento_por_comercio('movimiento_cuenta_corriente');

-- La venta conoce a su cliente y a quien autorizó un exceso de crédito (RF-074).
ALTER TABLE venta
  ADD COLUMN cliente_id uuid,
  ADD COLUMN credito_autorizacion_id uuid,
  ADD CONSTRAINT venta_cliente FOREIGN KEY (cliente_id, tenant_id)
    REFERENCES cliente (id, tenant_id);

-- Un pago pertenece a una venta o a un cobro de cuenta corriente, y lleva el rastro de la pasarela.
ALTER TABLE pago
  ALTER COLUMN venta_id DROP NOT NULL,
  ADD COLUMN cobro_id uuid,
  ADD COLUMN referencia_pasarela text,
  ADD COLUMN verificaciones integer NOT NULL DEFAULT 0,
  ADD COLUMN resuelto_a_mano boolean NOT NULL DEFAULT false,
  ADD COLUMN autorizacion_id uuid,
  ADD COLUMN aprobado_tarde_en timestamptz,
  ADD CONSTRAINT pago_cobro FOREIGN KEY (cobro_id, tenant_id)
    REFERENCES cobro_cuenta_corriente (id, tenant_id),
  ADD CONSTRAINT pago_origen CHECK ((venta_id IS NULL) <> (cobro_id IS NULL)),
  DROP CONSTRAINT pago_estado_check,
  ADD CONSTRAINT pago_estado_check CHECK (estado IN
    ('pendiente', 'aprobado', 'rechazado', 'por_verificar', 'revirtiendo', 'revertido'));
CREATE INDEX pago_por_cobro ON pago (cobro_id);

-- Simulador de la pasarela (T-174): solo lo usa el adaptador de desarrollo.
CREATE TABLE simulador_pasarela (
  tenant_id uuid PRIMARY KEY REFERENCES comercio (id),
  modo      text NOT NULL CHECK (modo IN ('aprobar', 'rechazar', 'no_responder', 'aprobar_tarde'))
);
SELECT aplicar_aislamiento_por_comercio('simulador_pasarela');

CREATE TABLE simulador_pago (
  tenant_id uuid        NOT NULL REFERENCES comercio (id),
  clave     text        NOT NULL,
  modo      text        NOT NULL,
  creado_en timestamptz NOT NULL,
  revertido boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, clave)
);
SELECT aplicar_aislamiento_por_comercio('simulador_pago');

-- Down Migration
DROP TABLE simulador_pago;
DROP TABLE simulador_pasarela;
ALTER TABLE pago
  DROP CONSTRAINT pago_estado_check,
  ADD CONSTRAINT pago_estado_check CHECK (estado IN
    ('pendiente', 'aprobado', 'rechazado', 'por_verificar', 'revertido')),
  DROP CONSTRAINT pago_origen,
  DROP CONSTRAINT pago_cobro,
  DROP COLUMN aprobado_tarde_en,
  DROP COLUMN autorizacion_id,
  DROP COLUMN resuelto_a_mano,
  DROP COLUMN verificaciones,
  DROP COLUMN referencia_pasarela,
  DROP COLUMN cobro_id,
  ALTER COLUMN venta_id SET NOT NULL;
ALTER TABLE venta
  DROP CONSTRAINT venta_cliente,
  DROP COLUMN credito_autorizacion_id,
  DROP COLUMN cliente_id;
DROP TABLE movimiento_cuenta_corriente;
DROP TABLE recibo;
DROP TABLE cobro_cuenta_corriente;
DROP TABLE numerador_recibo;
DROP TABLE cliente;
