-- Up Migration
-- Auditoría técnica y comercial (T-040, T-041, AD-10, D-9). Ambas son de solo inserción:
-- la aplicación no tiene permiso de UPDATE ni de DELETE sobre ellas (RF-019, RF-021).

-- Auditoría técnica de plataforma: la ve el SA. Nunca contiene datos comerciales (RF-022).
CREATE TABLE auditoria_tecnica (
  id          uuid        PRIMARY KEY,
  momento     timestamptz NOT NULL,
  tipo_evento text        NOT NULL,
  actor_id    uuid,
  -- Solo como referencia: la tabla no es comercial y no se aísla por comercio.
  tenant_id   uuid,
  ip          text,
  detalle     jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX auditoria_tecnica_momento ON auditoria_tecnica (momento DESC);
REVOKE UPDATE ON auditoria_tecnica FROM pos_app;

-- Auditoría comercial de cada comercio: la ven su AC y, para su sucursal, el AS (RF-114).
CREATE TABLE auditoria_comercial (
  id               uuid        PRIMARY KEY,
  tenant_id        uuid        NOT NULL REFERENCES comercio (id),
  sucursal_id      uuid,
  usuario_id       uuid        NOT NULL,
  rol_activo       text        NOT NULL CHECK (rol_activo IN ('AC', 'AS', 'VO')),
  momento          timestamptz NOT NULL,
  accion           text        NOT NULL,
  entidad          text        NOT NULL,
  entidad_id       text        NOT NULL,
  estado_anterior  jsonb,
  estado_posterior jsonb,
  autorizacion_id  uuid
);

CREATE INDEX auditoria_comercial_consulta ON auditoria_comercial (tenant_id, momento DESC);
REVOKE UPDATE ON auditoria_comercial FROM pos_app;
SELECT aplicar_aislamiento_por_comercio('auditoria_comercial');

-- Down Migration
DROP TABLE auditoria_comercial;
DROP TABLE auditoria_tecnica;
