-- Up Migration
-- Sesiones, tokens de un solo uso e intentos de acceso (T-027 a T-034, AD-11, D-43).

-- Token de renovación opaco: solo se guarda su hash. Cada renovación lo rota dentro de la misma sesión.
CREATE TABLE token_renovacion (
  id               uuid        PRIMARY KEY,
  sesion_id        uuid        NOT NULL,
  usuario_id       uuid        NOT NULL REFERENCES usuario (id),
  hash_token       text        NOT NULL,
  rol_activo       text        CHECK (rol_activo IN ('SA', 'AC', 'AS', 'VO')),
  emitido_en       timestamptz NOT NULL,
  -- Vencimiento absoluto de la sesión, aunque haya actividad.
  vence_en         timestamptz NOT NULL,
  -- Última renovación: base del cierre por inactividad (RF-009).
  ultima_actividad timestamptz NOT NULL,
  revocado_en      timestamptz,
  reemplazado_por  uuid
);

CREATE UNIQUE INDEX token_renovacion_hash ON token_renovacion (hash_token);
CREATE INDEX token_renovacion_sesion ON token_renovacion (sesion_id);
CREATE INDEX token_renovacion_usuario_vigente ON token_renovacion (usuario_id) WHERE revocado_en IS NULL;

-- Tokens de validación de correo y de recuperación de contraseña: un solo uso, con vencimiento.
CREATE TABLE token_un_uso (
  id         uuid        PRIMARY KEY,
  usuario_id uuid        NOT NULL REFERENCES usuario (id),
  tipo       text        NOT NULL CHECK (tipo IN ('validacion', 'recuperacion')),
  hash_token text        NOT NULL,
  creado_en  timestamptz NOT NULL,
  vence_en   timestamptz NOT NULL,
  usado_en   timestamptz
);

CREATE UNIQUE INDEX token_un_uso_hash ON token_un_uso (hash_token);

-- Historial de intentos: base del bloqueo tras 5 fallos seguidos (RF-145) y de su auditoría.
-- El identificador es el correo (contraseña) o el id del usuario (PIN), exista o no la cuenta.
CREATE TABLE intento_acceso (
  id            uuid        PRIMARY KEY,
  tipo          text        NOT NULL CHECK (tipo IN ('contrasena', 'pin')),
  identificador text        NOT NULL,
  resultado     text        NOT NULL CHECK (resultado IN ('exito', 'fallo', 'bloqueado')),
  ip            text,
  momento       timestamptz NOT NULL
);

CREATE INDEX intento_acceso_identificador ON intento_acceso (tipo, identificador, momento DESC);

-- Down Migration
DROP TABLE intento_acceso;
DROP TABLE token_un_uso;
DROP TABLE token_renovacion;
