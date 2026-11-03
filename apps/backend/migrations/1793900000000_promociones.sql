-- Up Migration
-- Promociones automáticas con tipos cerrados y vigencia (T-120; RF-048, RF-050, AD-17). Tabla
-- comercial, aislada por comercio con la política plantilla (AD-03).
-- Parámetros según el tipo:
--   nxm: {"lleva": 2, "paga": 1} (2x1); precio_cantidad: {"cantidad": 3, "precio": "1000.00"};
--   porcentaje: {"porcentaje": "15"}.
CREATE TABLE promocion (
  id              uuid        PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES comercio (id),
  nombre          text        NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 80),
  tipo            text        NOT NULL CHECK (tipo IN ('nxm', 'porcentaje', 'precio_cantidad')),
  alcance         text        NOT NULL CHECK (alcance IN ('producto', 'categoria')),
  producto_id     uuid,
  categoria_id    uuid,
  parametros      jsonb       NOT NULL,
  vigente_desde   timestamptz NOT NULL,
  vigente_hasta   timestamptz NOT NULL,
  -- Nulo: todas las sucursales del comercio.
  sucursales      uuid[],
  creado_en       timestamptz NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  desactivado_en  timestamptz,
  desactivado_por uuid,
  CONSTRAINT promocion_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  ),
  CONSTRAINT promocion_vigencia CHECK (vigente_desde < vigente_hasta),
  CONSTRAINT promocion_alcance CHECK (
    (alcance = 'producto' AND producto_id IS NOT NULL AND categoria_id IS NULL)
    OR (alcance = 'categoria' AND categoria_id IS NOT NULL AND producto_id IS NULL)
  ),
  CONSTRAINT promocion_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id),
  CONSTRAINT promocion_categoria FOREIGN KEY (categoria_id, tenant_id)
    REFERENCES categoria (id, tenant_id),
  CONSTRAINT promocion_id_comercio UNIQUE (id, tenant_id)
);
CREATE INDEX promocion_vigente ON promocion (tenant_id, vigente_hasta) WHERE is_active;
SELECT aplicar_aislamiento_por_comercio('promocion');

-- Down Migration
DROP TABLE promocion;
