-- Up Migration
-- Outbox transaccional (T-022, AD-07): los eventos se escriben en la misma transacción que el cambio
-- que los origina, y un worker los despacha después del commit. Nunca se pierde un evento confirmado.
CREATE TABLE outbox (
  id              uuid        PRIMARY KEY,
  -- Nulo para los eventos de plataforma, que no pertenecen a un comercio.
  tenant_id       uuid,
  tipo_evento     text        NOT NULL,
  payload         jsonb       NOT NULL,
  creado_en       timestamptz NOT NULL,
  procesado_en    timestamptz,
  intentos        integer     NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proximo_intento timestamptz NOT NULL,
  ultimo_error    text
);

-- Eventos pendientes de despacho, en orden.
CREATE INDEX outbox_pendientes ON outbox (proximo_intento, creado_en) WHERE procesado_en IS NULL;

-- Down Migration
DROP TABLE outbox;
