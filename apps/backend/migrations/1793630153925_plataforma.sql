-- Up Migration
-- Plataforma del Super Administrador (T-049 a T-055; RF-013 a RF-017, RF-134, RF-146, RF-147, RF-163).

-- Comercio completo: módulo de facturación, operaciones registradas y baja.
ALTER TABLE comercio
  ADD COLUMN tiene_operaciones            boolean     NOT NULL DEFAULT false,
  ADD COLUMN modulo_facturacion           boolean     NOT NULL DEFAULT false,
  ADD COLUMN modulo_facturacion_cambiado_en  timestamptz,
  ADD COLUMN modulo_facturacion_cambiado_por uuid,
  ADD COLUMN actualizado_en               timestamptz,
  ADD COLUMN dado_de_baja_en              timestamptz,
  ADD COLUMN dado_de_baja_por             uuid,
  ADD CONSTRAINT comercio_moneda_iso CHECK (moneda ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT comercio_baja_completa CHECK (
    (estado = 'baja') = (dado_de_baja_en IS NOT NULL)
    AND (dado_de_baja_en IS NULL) = (dado_de_baja_por IS NULL)
  );

-- RF-134: la moneda no cambia una vez que el comercio tiene operaciones. El dominio ya lo valida;
-- la base lo garantiza aunque un error lo saltee. Una operación registrada no se desmarca.
CREATE FUNCTION comercio_proteger_moneda() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tiene_operaciones AND NEW.moneda <> OLD.moneda THEN
    RAISE EXCEPTION 'No se puede cambiar la moneda de un comercio con operaciones registradas.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'comercio_moneda_bloqueada';
  END IF;
  IF OLD.tiene_operaciones AND NOT NEW.tiene_operaciones THEN
    RAISE EXCEPTION 'Un comercio con operaciones registradas no vuelve a estar sin operaciones.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'comercio_moneda_bloqueada';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER comercio_proteger_moneda
  BEFORE UPDATE OF moneda, tiene_operaciones ON comercio
  FOR EACH ROW EXECUTE FUNCTION comercio_proteger_moneda();

-- Cuentas creadas por otro (SA nuevo, primer AC): eligen su contraseña al activar la cuenta.
ALTER TABLE usuario ADD COLUMN contrasena_definida boolean NOT NULL DEFAULT true;

-- Tickets de soporte (RF-017). Tabla de plataforma: el SA los sigue para todos los comercios,
-- y el AC y el AS ven los de su comercio (filtrado en el código). Sin datos comerciales adjuntos.
CREATE TABLE ticket_soporte (
  id             uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL REFERENCES comercio (id),
  autor_id       uuid        NOT NULL REFERENCES usuario (id),
  asunto         text        NOT NULL CHECK (length(trim(asunto)) BETWEEN 1 AND 200),
  estado         text        NOT NULL DEFAULT 'abierto'
                 CHECK (estado IN ('abierto', 'respondido', 'cerrado')),
  creado_en      timestamptz NOT NULL,
  actualizado_en timestamptz NOT NULL
);

CREATE INDEX ticket_soporte_comercio ON ticket_soporte (tenant_id, actualizado_en DESC);
CREATE INDEX ticket_soporte_estado ON ticket_soporte (estado, actualizado_en DESC);

CREATE TABLE ticket_mensaje (
  id        uuid        PRIMARY KEY,
  -- Orden de llegada: dos mensajes del mismo instante se muestran como se escribieron.
  orden     bigint      GENERATED ALWAYS AS IDENTITY,
  ticket_id uuid        NOT NULL REFERENCES ticket_soporte (id),
  autor_id  uuid        NOT NULL REFERENCES usuario (id),
  -- El autor como SA o como usuario del comercio, para mostrar la conversación.
  de_soporte boolean    NOT NULL,
  texto     text        NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 4000),
  creado_en timestamptz NOT NULL
);

CREATE INDEX ticket_mensaje_ticket ON ticket_mensaje (ticket_id, orden);
-- Los mensajes no se editan: la conversación queda como se escribió.
REVOKE UPDATE ON ticket_mensaje FROM pos_app;

-- Down Migration
DROP TABLE ticket_mensaje;
DROP TABLE ticket_soporte;
ALTER TABLE usuario DROP COLUMN contrasena_definida;
DROP TRIGGER comercio_proteger_moneda ON comercio;
DROP FUNCTION comercio_proteger_moneda();
ALTER TABLE comercio
  DROP CONSTRAINT comercio_baja_completa,
  DROP CONSTRAINT comercio_moneda_iso,
  DROP COLUMN dado_de_baja_por,
  DROP COLUMN dado_de_baja_en,
  DROP COLUMN actualizado_en,
  DROP COLUMN modulo_facturacion_cambiado_por,
  DROP COLUMN modulo_facturacion_cambiado_en,
  DROP COLUMN modulo_facturacion,
  DROP COLUMN tiene_operaciones;
