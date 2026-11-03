-- Up Migration
-- Cuota de descuento (T-123; RF-063 a RF-067, RF-142, D-32). Tablas comerciales, aisladas por
-- comercio con la política plantilla (AD-03). Sin fila de tope o de cuota, los límites son cero
-- (D-72): todo descuento manual exige autorización.

-- Tope del comercio: uno por comercio.
CREATE TABLE tope_cuota (
  tenant_id       uuid          PRIMARY KEY REFERENCES comercio (id),
  pct_max_venta   numeric(7, 4) NOT NULL CHECK (pct_max_venta BETWEEN 0 AND 100),
  monto_max       numeric(14, 2) NOT NULL CHECK (monto_max >= 0),
  actualizado_en  timestamptz   NOT NULL,
  actualizado_por uuid          NOT NULL
);
SELECT aplicar_aislamiento_por_comercio('tope_cuota');

-- Cuota de cada VO en cada sucursal. No supera el tope: lo controla el caso de uso y, al bajar
-- el tope, las cuotas mayores se recortan (RF-142).
CREATE TABLE cuota_vo (
  id              uuid          PRIMARY KEY,
  tenant_id       uuid          NOT NULL,
  usuario_id      uuid          NOT NULL REFERENCES usuario (id),
  sucursal_id     uuid          NOT NULL,
  pct_max_venta   numeric(7, 4) NOT NULL CHECK (pct_max_venta BETWEEN 0 AND 100),
  monto           numeric(14, 2) NOT NULL CHECK (monto >= 0),
  actualizado_en  timestamptz   NOT NULL,
  actualizado_por uuid          NOT NULL,
  CONSTRAINT cuota_vo_sucursal FOREIGN KEY (sucursal_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT cuota_vo_unica UNIQUE (tenant_id, usuario_id, sucursal_id)
);
SELECT aplicar_aislamiento_por_comercio('cuota_vo');

-- Saldo de la cuota por fecha de jornada (D-13): se crea con el primer turno de esa fecha y los
-- turnos siguientes con la misma fecha no lo restablecen (RF-067). Se consume con una
-- actualización condicional (AD-04); el CHECK es la red de seguridad.
CREATE TABLE saldo_cuota (
  id             uuid          PRIMARY KEY,
  tenant_id      uuid          NOT NULL,
  usuario_id     uuid          NOT NULL REFERENCES usuario (id),
  sucursal_id    uuid          NOT NULL,
  fecha_jornada  date          NOT NULL,
  saldo          numeric(14, 2) NOT NULL CHECK (saldo >= 0),
  version        integer       NOT NULL DEFAULT 0,
  creado_en      timestamptz   NOT NULL,
  actualizado_en timestamptz   NOT NULL,
  CONSTRAINT saldo_cuota_sucursal FOREIGN KEY (sucursal_id, tenant_id)
    REFERENCES sucursal (id, tenant_id),
  CONSTRAINT saldo_cuota_unico UNIQUE (tenant_id, usuario_id, sucursal_id, fecha_jornada)
);
SELECT aplicar_aislamiento_por_comercio('saldo_cuota');

-- Down Migration
DROP TABLE saldo_cuota;
DROP TABLE cuota_vo;
DROP TABLE tope_cuota;
