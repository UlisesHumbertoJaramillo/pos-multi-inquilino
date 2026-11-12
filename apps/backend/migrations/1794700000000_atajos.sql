-- Up Migration

-- Atajos de teclado del POS de cada comercio (T-274; RF-185, D-94, AD-28). Sin fila, o con el mapa
-- nulo, rige la distribución por defecto. Restablecer pone el mapa en nulo: nunca se borra.
CREATE TABLE atajos_comercio (
  tenant_id       uuid        PRIMARY KEY REFERENCES comercio (id),
  mapa            jsonb,
  actualizado_en  timestamptz NOT NULL,
  actualizado_por uuid        NOT NULL,
  CONSTRAINT atajos_comercio_mapa CHECK (mapa IS NULL OR jsonb_typeof(mapa) = 'object')
);

SELECT aplicar_aislamiento_por_comercio('atajos_comercio');

-- Ventas confirmadas recientes de una sucursal: ordenan la sección de productos del POS (D-95).
CREATE INDEX venta_confirmada_sucursal ON venta (tenant_id, sucursal_id, confirmada_en)
  WHERE estado_comercial = 'confirmada';

-- Down Migration
DROP INDEX venta_confirmada_sucursal;
DROP TABLE atajos_comercio;
