-- Up Migration
-- Organización del comercio (T-060; RF-023 a RF-027, RF-135). Tablas comerciales, aisladas por
-- comercio con la política plantilla (AD-03).

CREATE TABLE sucursal (
  id              uuid        PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES comercio (id),
  nombre          text        NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 120),
  direccion       text        CHECK (length(direccion) <= 200),
  creado_en       timestamptz NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  desactivado_en  timestamptz,
  desactivado_por uuid,
  CONSTRAINT sucursal_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  ),
  -- Para que una caja solo pueda pertenecer a una sucursal de su mismo comercio.
  CONSTRAINT sucursal_id_comercio UNIQUE (id, tenant_id)
);

-- Sin dos sucursales activas con el mismo nombre en un comercio.
CREATE UNIQUE INDEX sucursal_nombre_activo ON sucursal (tenant_id, lower(nombre)) WHERE is_active;
SELECT aplicar_aislamiento_por_comercio('sucursal');

CREATE TABLE caja (
  id                 uuid        PRIMARY KEY,
  tenant_id          uuid        NOT NULL,
  sucursal_id        uuid        NOT NULL,
  nombre             text        NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 60),
  -- Cada caja es un punto de venta de ARCA (plan §2.15). Opcional sin el módulo de facturación.
  punto_venta_fiscal integer     CHECK (punto_venta_fiscal BETWEEN 1 AND 99999),
  creado_en          timestamptz NOT NULL,
  is_active          boolean     NOT NULL DEFAULT true,
  desactivado_en     timestamptz,
  desactivado_por    uuid,
  CONSTRAINT caja_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  ),
  CONSTRAINT caja_sucursal_del_comercio FOREIGN KEY (sucursal_id, tenant_id)
    REFERENCES sucursal (id, tenant_id)
);

CREATE UNIQUE INDEX caja_nombre_activo ON caja (sucursal_id, lower(nombre)) WHERE is_active;
-- El punto de venta es único por comercio, aunque la caja se dé de baja (ARCA no lo reutiliza).
CREATE UNIQUE INDEX caja_punto_venta ON caja (tenant_id, punto_venta_fiscal)
  WHERE punto_venta_fiscal IS NOT NULL;
SELECT aplicar_aislamiento_por_comercio('caja');

-- Los roles AS y VO apuntan a una sucursal real. La verificación de la FK no pasa por la
-- seguridad a nivel de fila.
ALTER TABLE usuario_rol
  ADD CONSTRAINT usuario_rol_sucursal_fk FOREIGN KEY (sucursal_id) REFERENCES sucursal (id);

-- Quitar un rol es una baja lógica: la aplicación no borra (Const. 5) y el historial de permisos
-- se conserva (RF-018).
ALTER TABLE usuario_rol
  ADD COLUMN is_active       boolean     NOT NULL DEFAULT true,
  ADD COLUMN desactivado_en  timestamptz,
  ADD COLUMN desactivado_por uuid,
  ADD CONSTRAINT usuario_rol_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  );
DROP INDEX usuario_rol_unico;
CREATE UNIQUE INDEX usuario_rol_unico ON usuario_rol (usuario_id, rol, sucursal_id) NULLS NOT DISTINCT
  WHERE is_active;

-- Parámetros del comercio (RF-135). Sin fila, rigen los valores por defecto de la plataforma.
CREATE TABLE parametro_comercio (
  tenant_id                    uuid          PRIMARY KEY REFERENCES comercio (id),
  inactividad_carrito_min      integer       NOT NULL,
  inactividad_sesion_min       integer       NOT NULL,
  plazo_regularizacion_horas   integer       NOT NULL,
  plazo_devolucion_dias        integer       NOT NULL,
  tolerancia_arqueo            numeric(14,2) NOT NULL CHECK (tolerancia_arqueo >= 0),
  politica_facturacion         text          NOT NULL
    CHECK (politica_facturacion IN ('siempre', 'opcional_con_factura', 'opcional_sin_factura')),
  plazo_facturacion_posterior_dias integer   NOT NULL,
  actualizado_en               timestamptz   NOT NULL,
  actualizado_por              uuid          NOT NULL
);

SELECT aplicar_aislamiento_por_comercio('parametro_comercio');

-- Métodos de pago con recargo (positivo) o descuento (negativo) (RF-068, RF-069, RF-135).
CREATE TABLE metodo_pago (
  id              uuid         PRIMARY KEY,
  tenant_id       uuid         NOT NULL REFERENCES comercio (id),
  nombre          text         NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 60),
  tipo            text         NOT NULL CHECK (tipo IN ('efectivo', 'electronico', 'cuenta_corriente')),
  recargo_pct     numeric(7,4) NOT NULL,
  creado_en       timestamptz  NOT NULL,
  is_active       boolean      NOT NULL DEFAULT true,
  desactivado_en  timestamptz,
  desactivado_por uuid,
  CONSTRAINT metodo_pago_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  )
);

CREATE UNIQUE INDEX metodo_pago_nombre_activo ON metodo_pago (tenant_id, lower(nombre)) WHERE is_active;
SELECT aplicar_aislamiento_por_comercio('metodo_pago');

-- Down Migration
DROP TABLE metodo_pago;
DROP TABLE parametro_comercio;
DROP INDEX usuario_rol_unico;
ALTER TABLE usuario_rol
  DROP CONSTRAINT usuario_rol_baja_completa,
  DROP COLUMN desactivado_por,
  DROP COLUMN desactivado_en,
  DROP COLUMN is_active;
CREATE UNIQUE INDEX usuario_rol_unico ON usuario_rol (usuario_id, rol, sucursal_id) NULLS NOT DISTINCT;
ALTER TABLE usuario_rol DROP CONSTRAINT usuario_rol_sucursal_fk;
DROP TABLE caja;
DROP TABLE sucursal;
