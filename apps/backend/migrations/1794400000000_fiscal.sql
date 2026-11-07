-- Up Migration
-- Facturación fiscal, módulo opcional por comercio (T-189; plan §2.15, §3.11).

-- Credencial fiscal del comercio: cifrada con una clave que no está en la base (AD-25).
CREATE TABLE credencial_fiscal (
  tenant_id          uuid        PRIMARY KEY REFERENCES comercio (id),
  cuit               text        NOT NULL CHECK (cuit ~ '^[0-9]{11}$'),
  condicion_fiscal   text        NOT NULL CHECK (condicion_fiscal IN
                       ('responsable_inscripto', 'monotributista', 'exento')),
  certificado_cifrado text       NOT NULL,
  clave_cifrada      text        NOT NULL,
  vence_en           timestamptz NOT NULL,
  cargado_por        uuid        NOT NULL REFERENCES usuario (id),
  cargado_en         timestamptz NOT NULL
);
SELECT aplicar_aislamiento_por_comercio('credencial_fiscal');

-- CAEA de cada quincena (RF-160).
CREATE TABLE caea (
  id              uuid        PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES comercio (id),
  periodo         text        NOT NULL CHECK (periodo ~ '^[0-9]{6}[12]$'),
  codigo          text        NOT NULL,
  vigente_desde   date        NOT NULL,
  vigente_hasta   date        NOT NULL,
  obtenido_en     timestamptz NOT NULL,
  CONSTRAINT caea_periodo_unico UNIQUE (tenant_id, periodo)
);
SELECT aplicar_aislamiento_por_comercio('caea');

-- La numeración es independiente por punto de venta y tipo de comprobante.
CREATE TABLE numerador_comprobante (
  tenant_id   uuid    NOT NULL REFERENCES comercio (id),
  punto_venta integer NOT NULL,
  clase       text    NOT NULL,
  ultimo      bigint  NOT NULL,
  PRIMARY KEY (tenant_id, punto_venta, clase)
);
SELECT aplicar_aislamiento_por_comercio('numerador_comprobante');

CREATE TABLE comprobante (
  id                  uuid          PRIMARY KEY,
  tenant_id           uuid          NOT NULL,
  tipo                text          NOT NULL CHECK (tipo IN ('factura', 'nota_credito')),
  clase               text          CHECK (clase IN ('A', 'B', 'C')),
  venta_id            uuid          NOT NULL,
  sucursal_id         uuid          NOT NULL,
  caja_id             uuid          NOT NULL,
  original_id         uuid,
  punto_venta         integer,
  numero              bigint,
  total               numeric(14,2) NOT NULL CHECK (total >= 0),
  comprador_nombre    text,
  comprador_documento text,
  comprador_condicion text          NOT NULL DEFAULT 'consumidor_final',
  -- Emitido con CAEA: se informa después al ente (RF-101).
  contingencia        boolean       NOT NULL DEFAULT false,
  caea_codigo         text,
  -- El ticket salió como no fiscal (RF-103, RF-161).
  no_fiscal           boolean       NOT NULL DEFAULT false,
  cae                 text,
  estado              text          NOT NULL CHECK (estado IN
                        ('pendiente', 'aceptado', 'rechazado', 'bloqueado')),
  motivo_rechazo      text,
  intentos            integer       NOT NULL DEFAULT 0,
  proximo_intento     timestamptz   NOT NULL,
  plazo_vence         timestamptz   NOT NULL,
  emitido_en          timestamptz   NOT NULL,
  resuelto_en         timestamptz,
  CONSTRAINT comprobante_id_comercio UNIQUE (id, tenant_id),
  CONSTRAINT comprobante_venta FOREIGN KEY (venta_id, tenant_id) REFERENCES venta (id, tenant_id),
  CONSTRAINT comprobante_original FOREIGN KEY (original_id, tenant_id)
    REFERENCES comprobante (id, tenant_id),
  CONSTRAINT comprobante_aceptado_con_autorizacion CHECK (
    estado <> 'aceptado' OR cae IS NOT NULL OR caea_codigo IS NOT NULL
  )
);
CREATE UNIQUE INDEX comprobante_numero ON comprobante (tenant_id, punto_venta, clase, numero)
  WHERE numero IS NOT NULL;
-- Una venta tiene una sola factura.
CREATE UNIQUE INDEX comprobante_factura_de_venta ON comprobante (tenant_id, venta_id)
  WHERE tipo = 'factura';
CREATE INDEX comprobante_cola ON comprobante (tenant_id, proximo_intento) WHERE estado = 'pendiente';
SELECT aplicar_aislamiento_por_comercio('comprobante');

-- Historial de envíos: solo inserción.
CREATE TABLE intento_envio_fiscal (
  id             uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL,
  comprobante_id uuid        NOT NULL,
  momento        timestamptz NOT NULL,
  resultado      text        NOT NULL CHECK (resultado IN ('aceptado', 'rechazado', 'no_disponible')),
  respuesta      text,
  CONSTRAINT intento_comprobante FOREIGN KEY (comprobante_id, tenant_id)
    REFERENCES comprobante (id, tenant_id)
);
SELECT aplicar_aislamiento_por_comercio('intento_envio_fiscal');

-- Simulador de ARCA (T-194): solo lo usa el adaptador de desarrollo.
CREATE TABLE simulador_fiscal (
  tenant_id uuid PRIMARY KEY REFERENCES comercio (id),
  modo      text NOT NULL CHECK (modo IN ('acepta', 'rechaza', 'caido'))
);
SELECT aplicar_aislamiento_por_comercio('simulador_fiscal');

-- Down Migration
DROP TABLE simulador_fiscal;
DROP TABLE intento_envio_fiscal;
DROP TABLE comprobante;
DROP TABLE numerador_comprobante;
DROP TABLE caea;
DROP TABLE credencial_fiscal;
