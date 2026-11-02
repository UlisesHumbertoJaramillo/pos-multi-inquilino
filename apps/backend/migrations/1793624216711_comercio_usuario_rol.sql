-- Up Migration
-- Comercio (versión básica), usuarios y sus roles (T-024, RF-012, plan §3.2).
-- Tablas de plataforma e identidad: sin seguridad a nivel de fila, porque el inicio de sesión
-- ocurre antes de conocer el comercio. El módulo de identidad filtra por comercio en el código.

CREATE TABLE comercio (
  id              uuid        PRIMARY KEY,
  nombre          text        NOT NULL CHECK (length(trim(nombre)) > 0),
  cuit            text,
  moneda          char(3)     NOT NULL,
  zona_horaria    text        NOT NULL,
  estado          text        NOT NULL DEFAULT 'activo'
                  CHECK (estado IN ('activo', 'suspendido', 'baja')),
  creado_en       timestamptz NOT NULL
);

CREATE TABLE usuario (
  id                uuid        PRIMARY KEY,
  -- Nulo solo para el Super Administrador, que no pertenece a ningún comercio (RF-003).
  tenant_id         uuid        REFERENCES comercio (id),
  email             text        NOT NULL CHECK (email = lower(email)),
  nombre            text        NOT NULL,
  email_validado    boolean     NOT NULL DEFAULT false,
  hash_contrasena   text        NOT NULL,
  ultimo_rol_activo text        CHECK (ultimo_rol_activo IN ('SA', 'AC', 'AS', 'VO')),
  creado_en         timestamptz NOT NULL,
  is_active         boolean     NOT NULL DEFAULT true,
  desactivado_en    timestamptz,
  desactivado_por   uuid,
  CONSTRAINT usuario_baja_completa CHECK (
    is_active = (desactivado_en IS NULL)
    AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  )
);

CREATE UNIQUE INDEX usuario_email_unico ON usuario (email);

CREATE TABLE usuario_rol (
  id          uuid        PRIMARY KEY,
  usuario_id  uuid        NOT NULL REFERENCES usuario (id),
  rol         text        NOT NULL CHECK (rol IN ('SA', 'AC', 'AS', 'VO')),
  -- AS y VO actúan sobre una sucursal; SA y AC no. La FK a sucursal llega con esa tabla (E2).
  sucursal_id uuid,
  creado_en   timestamptz NOT NULL,
  CONSTRAINT usuario_rol_sucursal CHECK ((rol IN ('AS', 'VO')) = (sucursal_id IS NOT NULL))
);

CREATE UNIQUE INDEX usuario_rol_unico ON usuario_rol (usuario_id, rol, sucursal_id) NULLS NOT DISTINCT;

-- El rol SA no se combina con roles de un comercio (RF-012, S-5). Como el SA no tiene comercio
-- y los roles de comercio lo exigen, la regla depende solo del usuario: no hay carreras entre filas.
CREATE FUNCTION usuario_rol_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  comercio_del_usuario uuid;
BEGIN
  SELECT tenant_id INTO comercio_del_usuario FROM usuario WHERE id = NEW.usuario_id;
  IF NEW.rol = 'SA' AND comercio_del_usuario IS NOT NULL THEN
    RAISE EXCEPTION 'El rol SA no se puede asignar a un usuario de un comercio.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuario_rol_sa_exclusivo';
  END IF;
  IF NEW.rol <> 'SA' AND comercio_del_usuario IS NULL THEN
    RAISE EXCEPTION 'Un usuario SA no puede tener roles de un comercio.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuario_rol_sa_exclusivo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuario_rol_validar
  BEFORE INSERT OR UPDATE ON usuario_rol
  FOR EACH ROW EXECUTE FUNCTION usuario_rol_validar();

-- Un usuario con roles no puede cambiar de comercio, ni pasar a SA, sin revisar sus roles.
CREATE FUNCTION usuario_comercio_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND EXISTS (SELECT 1 FROM usuario_rol WHERE usuario_id = NEW.id) THEN
    RAISE EXCEPTION 'No se puede cambiar el comercio de un usuario que tiene roles asignados.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuario_rol_sa_exclusivo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuario_comercio_inmutable
  BEFORE UPDATE OF tenant_id ON usuario
  FOR EACH ROW EXECUTE FUNCTION usuario_comercio_inmutable();

-- Down Migration
DROP TABLE usuario_rol;
DROP FUNCTION usuario_rol_validar();
DROP TABLE usuario;
DROP FUNCTION usuario_comercio_inmutable();
DROP TABLE comercio;
