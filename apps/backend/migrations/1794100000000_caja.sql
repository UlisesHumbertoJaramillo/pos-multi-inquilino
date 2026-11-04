-- Up Migration
-- Caja: jornadas, turnos y movimientos de efectivo (T-129; RF-089 a RF-099, RF-112, RF-115,
-- RF-117, RF-118, RF-154, plan §3.11). Tablas comerciales, aisladas por comercio (AD-03).

-- Para que jornadas y turnos solo apunten a una caja de su mismo comercio.
ALTER TABLE caja ADD CONSTRAINT caja_id_comercio UNIQUE (id, tenant_id);

-- Jornada de una caja (D-13): empieza con el primer turno posterior al último Corte Z y termina
-- con el siguiente. Su fecha es la de apertura en la zona horaria del comercio.
CREATE TABLE jornada (
  id            uuid          PRIMARY KEY,
  tenant_id     uuid          NOT NULL,
  caja_id       uuid          NOT NULL,
  sucursal_id   uuid          NOT NULL,
  fecha_jornada date          NOT NULL,
  abierta_en    timestamptz   NOT NULL,
  estado        text          NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  declarado_z   numeric(14,2) CHECK (declarado_z >= 0),
  teorico_z     numeric(14,2),
  diferencia_z  numeric(14,2),
  resultado_z   text          CHECK (resultado_z IN ('faltante', 'sobrante', 'cuadrado')),
  cerrada_en    timestamptz,
  cerrada_por   uuid,
  CONSTRAINT jornada_cierre_completo CHECK (
    (estado = 'abierta') = (cerrada_en IS NULL)
    AND (cerrada_en IS NULL) = (cerrada_por IS NULL)
    AND (cerrada_en IS NULL) = (declarado_z IS NULL)
  ),
  CONSTRAINT jornada_caja FOREIGN KEY (caja_id, tenant_id) REFERENCES caja (id, tenant_id),
  CONSTRAINT jornada_sucursal FOREIGN KEY (sucursal_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT jornada_id_comercio UNIQUE (id, tenant_id)
);
-- Una sola jornada abierta por caja (RF-097).
CREATE UNIQUE INDEX jornada_abierta_por_caja ON jornada (caja_id) WHERE estado = 'abierta';
SELECT aplicar_aislamiento_por_comercio('jornada');

-- Turno de un VO en una caja. El saldo teórico se calcula al cerrar y nunca se le muestra al VO
-- mientras el turno está abierto (RF-112).
CREATE TABLE turno (
  id                 uuid          PRIMARY KEY,
  tenant_id          uuid          NOT NULL,
  caja_id            uuid          NOT NULL,
  sucursal_id        uuid          NOT NULL,
  jornada_id         uuid          NOT NULL,
  vendedor_id        uuid          NOT NULL REFERENCES usuario (id),
  saldo_inicial      numeric(14,2) NOT NULL CHECK (saldo_inicial >= 0),
  -- Lo declarado en el Corte X del turno anterior de la jornada (D-75) y la diferencia (RF-089).
  efectivo_anterior  numeric(14,2),
  diferencia_inicial numeric(14,2),
  abierto_en         timestamptz   NOT NULL,
  estado             text          NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  declarado          numeric(14,2) CHECK (declarado >= 0),
  teorico            numeric(14,2),
  diferencia         numeric(14,2),
  resultado          text          CHECK (resultado IN ('faltante', 'sobrante', 'cuadrado')),
  cerrado_en         timestamptz,
  cerrado_por        uuid,
  -- Cierre forzado por un AS (RF-115): cerrado_por es el AS y vendedor_id el titular.
  forzado            boolean       NOT NULL DEFAULT false,
  CONSTRAINT turno_cierre_completo CHECK (
    (estado = 'abierto') = (cerrado_en IS NULL)
    AND (cerrado_en IS NULL) = (cerrado_por IS NULL)
    AND (cerrado_en IS NULL) = (declarado IS NULL)
    AND (estado = 'cerrado' OR NOT forzado)
  ),
  CONSTRAINT turno_caja FOREIGN KEY (caja_id, tenant_id) REFERENCES caja (id, tenant_id),
  CONSTRAINT turno_sucursal FOREIGN KEY (sucursal_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT turno_jornada FOREIGN KEY (jornada_id, tenant_id) REFERENCES jornada (id, tenant_id),
  CONSTRAINT turno_id_comercio UNIQUE (id, tenant_id)
);
-- Un turno abierto por caja (RF-090) y uno por VO (RF-154).
CREATE UNIQUE INDEX turno_abierto_por_caja ON turno (caja_id) WHERE estado = 'abierto';
CREATE UNIQUE INDEX turno_abierto_por_vendedor ON turno (vendedor_id) WHERE estado = 'abierto';
CREATE INDEX turno_por_jornada ON turno (jornada_id, abierto_en);
SELECT aplicar_aislamiento_por_comercio('turno');

-- Un cierre confirmado no se modifica (RF-099).
CREATE FUNCTION cierre_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('cerrado', 'cerrada') THEN
    RAISE EXCEPTION 'Un cierre confirmado no se puede modificar.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'cierre_inmutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER turno_inmutable BEFORE UPDATE ON turno
  FOR EACH ROW EXECUTE FUNCTION cierre_inmutable();
CREATE TRIGGER jornada_inmutable BEFORE UPDATE ON jornada
  FOR EACH ROW EXECUTE FUNCTION cierre_inmutable();

-- Movimientos de caja de un turno. Solo inserción. El monto es positivo y el tipo da el sentido:
-- ingreso, venta y cobro suman; retiro, reintegro y anulación restan. El teórico de efectivo es
-- el saldo inicial más los movimientos en efectivo (plan §3.11).
CREATE TABLE movimiento_caja (
  id               uuid          PRIMARY KEY,
  tenant_id        uuid          NOT NULL,
  turno_id         uuid          NOT NULL,
  tipo             text          NOT NULL
    CHECK (tipo IN ('ingreso', 'retiro', 'venta', 'reintegro', 'cobro', 'anulacion')),
  en_efectivo      boolean       NOT NULL,
  metodo_pago_id   uuid,
  monto            numeric(14,2) NOT NULL CHECK (monto > 0),
  motivo           text          CHECK (length(motivo) <= 200),
  autorizacion_id  uuid,
  registrado_por   uuid          NOT NULL,
  registrado_en    timestamptz   NOT NULL,
  -- Los movimientos manuales llevan motivo (RF-091) y el retiro, autorización (RF-092).
  CONSTRAINT movimiento_caja_motivo CHECK (
    tipo NOT IN ('ingreso', 'retiro') OR length(trim(motivo)) > 0
  ),
  CONSTRAINT movimiento_caja_retiro CHECK (tipo <> 'retiro' OR autorizacion_id IS NOT NULL),
  CONSTRAINT movimiento_caja_turno FOREIGN KEY (turno_id, tenant_id) REFERENCES turno (id, tenant_id)
);
CREATE INDEX movimiento_caja_por_turno ON movimiento_caja (turno_id, registrado_en);
REVOKE UPDATE ON movimiento_caja FROM pos_app;
SELECT aplicar_aislamiento_por_comercio('movimiento_caja');

-- Down Migration
DROP TABLE movimiento_caja;
DROP TABLE turno;
DROP TABLE jornada;
DROP FUNCTION cierre_inmutable();
ALTER TABLE caja DROP CONSTRAINT caja_id_comercio;
