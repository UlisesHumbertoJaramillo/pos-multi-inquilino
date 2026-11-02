-- Up Migration
-- Trabajos en segundo plano (T-021, AD-19): expiración de carritos, envío fiscal, verificación de pagos...
-- Tabla de plataforma: los workers la recorren para todos los comercios; el comercio va en el payload.
CREATE TABLE trabajo_programado (
  id            uuid        PRIMARY KEY,
  tipo          text        NOT NULL,
  -- Identifica el trabajo dentro de su tipo (por ejemplo, el id de la venta a expirar).
  clave         text        NOT NULL,
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ejecutar_en   timestamptz NOT NULL,
  estado        text        NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'en_curso', 'completado', 'fallido')),
  intentos      integer     NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  max_intentos  integer     NOT NULL DEFAULT 5 CHECK (max_intentos > 0),
  bloqueado_por text,
  bloqueado_en  timestamptz,
  ultimo_error  text,
  creado_en     timestamptz NOT NULL,
  completado_en timestamptz,
  CONSTRAINT trabajo_programado_bloqueo CHECK ((estado = 'en_curso') = (bloqueado_por IS NOT NULL))
);

-- Programar dos veces el mismo trabajo mientras está pendiente o en curso no lo duplica.
CREATE UNIQUE INDEX trabajo_programado_activo_unico
  ON trabajo_programado (tipo, clave)
  WHERE estado IN ('pendiente', 'en_curso');

-- Búsqueda de trabajos listos para ejecutar.
CREATE INDEX trabajo_programado_listos
  ON trabajo_programado (ejecutar_en)
  WHERE estado IN ('pendiente', 'en_curso');

-- Down Migration
DROP TABLE trabajo_programado;
