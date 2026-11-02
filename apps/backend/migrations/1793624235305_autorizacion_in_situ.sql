-- Up Migration
-- PIN de autorización y autorizaciones in situ de un solo uso (T-043, T-044, AD-13).

-- Credencial de autorización de un AS o un AC: el PIN se guarda solo como hash (RF-156).
CREATE TABLE credencial_autorizacion (
  id                   uuid        PRIMARY KEY,
  tenant_id            uuid        NOT NULL REFERENCES comercio (id),
  usuario_id           uuid        NOT NULL REFERENCES usuario (id),
  hash_pin             text        NOT NULL,
  id_credencial_fisica text,
  actualizado_en       timestamptz NOT NULL
);

CREATE UNIQUE INDEX credencial_autorizacion_usuario ON credencial_autorizacion (usuario_id);
SELECT aplicar_aislamiento_por_comercio('credencial_autorizacion');

-- Autorización emitida tras validar el PIN: ligada al tipo de operación, a la operación concreta
-- y al solicitante, y consumible una sola vez.
CREATE TABLE autorizacion (
  id             uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL REFERENCES comercio (id),
  sucursal_id    uuid        NOT NULL,
  tipo           text        NOT NULL CHECK (tipo IN (
                   'descuento', 'credito', 'anulacion', 'reembolso', 'retiro',
                   'pago_por_verificar', 'cierre_forzado')),
  operacion_ref  text        NOT NULL,
  solicitante_id uuid        NOT NULL REFERENCES usuario (id),
  autorizante_id uuid        NOT NULL REFERENCES usuario (id),
  emitida_en     timestamptz NOT NULL,
  usada_en       timestamptz,
  -- Quien autoriza nunca es quien solicitó (Const. 13, RF-113), aunque tenga ambos roles.
  CONSTRAINT autorizacion_segregacion CHECK (solicitante_id <> autorizante_id)
);

SELECT aplicar_aislamiento_por_comercio('autorizacion');

-- Down Migration
DROP TABLE autorizacion;
DROP TABLE credencial_autorizacion;
