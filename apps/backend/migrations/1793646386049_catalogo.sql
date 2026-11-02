-- Up Migration
-- Catálogo y precios (T-072; RF-028 a RF-033, RF-049, RF-119, RF-130, RF-131, RF-159). Tablas
-- comerciales, aisladas por comercio con la política plantilla (AD-03). Dinero en NUMERIC(14,2),
-- tasas y porcentajes en NUMERIC(7,4) y cantidades en NUMERIC(12,3) (plan §3.1).

CREATE TABLE categoria (
  id              uuid         PRIMARY KEY,
  tenant_id       uuid         NOT NULL REFERENCES comercio (id),
  nombre          text         NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 80),
  tasa_iva        numeric(7,4) NOT NULL CHECK (tasa_iva BETWEEN 0 AND 100),
  creado_en       timestamptz  NOT NULL,
  is_active       boolean      NOT NULL DEFAULT true,
  desactivado_en  timestamptz,
  desactivado_por uuid,
  CONSTRAINT categoria_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  ),
  CONSTRAINT categoria_id_comercio UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX categoria_nombre_activo ON categoria (tenant_id, lower(nombre)) WHERE is_active;
SELECT aplicar_aislamiento_por_comercio('categoria');

-- Un combo es un producto de tipo combo: no tiene costo ni categoría propios (su IVA se prorratea
-- entre los componentes, D-18) y tiene un precio único (RF-049).
CREATE TABLE producto (
  id              uuid          PRIMARY KEY,
  tenant_id       uuid          NOT NULL REFERENCES comercio (id),
  tipo            text          NOT NULL CHECK (tipo IN ('simple', 'combo')),
  nombre          text          NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 120),
  codigo_barras   text          CHECK (codigo_barras ~ '^[0-9A-Za-z-]{1,48}$'),
  categoria_id    uuid,
  costo           numeric(14,2) CHECK (costo >= 0),
  precio_combo    numeric(14,2) CHECK (precio_combo > 0),
  creado_en       timestamptz   NOT NULL,
  is_active       boolean       NOT NULL DEFAULT true,
  desactivado_en  timestamptz,
  desactivado_por uuid,
  CONSTRAINT producto_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  ),
  CONSTRAINT producto_segun_tipo CHECK (
    (tipo = 'simple' AND categoria_id IS NOT NULL AND costo IS NOT NULL AND precio_combo IS NULL)
    OR (tipo = 'combo' AND categoria_id IS NULL AND costo IS NULL AND precio_combo IS NOT NULL)
  ),
  CONSTRAINT producto_categoria_del_comercio FOREIGN KEY (categoria_id, tenant_id)
    REFERENCES categoria (id, tenant_id),
  CONSTRAINT producto_id_comercio UNIQUE (id, tenant_id)
);

-- El código de barras es único entre los productos activos del comercio (RF-131): tras la baja
-- de un producto, su código se puede reutilizar.
CREATE UNIQUE INDEX producto_codigo_barras_activo ON producto (tenant_id, codigo_barras)
  WHERE is_active AND codigo_barras IS NOT NULL;
CREATE INDEX producto_categoria ON producto (categoria_id);
SELECT aplicar_aislamiento_por_comercio('producto');

-- Imagen del producto (RF-159), separada para no leerla al listar el catálogo. Se reemplaza con
-- UPDATE: la imagen anterior no es un dato que haya que conservar.
CREATE TABLE producto_imagen (
  producto_id    uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL,
  tipo_mime      text        NOT NULL CHECK (tipo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  contenido      bytea       NOT NULL CHECK (octet_length(contenido) BETWEEN 1 AND 1048576),
  actualizado_en timestamptz NOT NULL,
  actualizado_por uuid       NOT NULL,
  CONSTRAINT producto_imagen_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id)
);
SELECT aplicar_aislamiento_por_comercio('producto_imagen');

-- Componentes de un combo con su cantidad. Redefinir los componentes da de baja los anteriores.
CREATE TABLE combo_componente (
  id              uuid          PRIMARY KEY,
  tenant_id       uuid          NOT NULL,
  combo_id        uuid          NOT NULL,
  producto_id     uuid          NOT NULL,
  cantidad        numeric(12,3) NOT NULL CHECK (cantidad > 0),
  creado_en       timestamptz   NOT NULL,
  is_active       boolean       NOT NULL DEFAULT true,
  desactivado_en  timestamptz,
  desactivado_por uuid,
  CONSTRAINT combo_componente_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  ),
  CONSTRAINT combo_componente_combo FOREIGN KEY (combo_id, tenant_id)
    REFERENCES producto (id, tenant_id),
  CONSTRAINT combo_componente_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id),
  CONSTRAINT combo_componente_distinto CHECK (combo_id <> producto_id)
);

CREATE UNIQUE INDEX combo_componente_unico ON combo_componente (combo_id, producto_id) WHERE is_active;
CREATE INDEX combo_componente_producto_idx ON combo_componente (producto_id);
SELECT aplicar_aislamiento_por_comercio('combo_componente');

-- Un combo solo se compone de productos simples (RF-049), aunque el código tenga un error.
CREATE FUNCTION combo_componente_validar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT tipo FROM producto WHERE id = NEW.combo_id) <> 'combo' THEN
    RAISE EXCEPTION 'El producto % no es un combo.', NEW.combo_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'combo_componente_tipos';
  END IF;
  IF (SELECT tipo FROM producto WHERE id = NEW.producto_id) <> 'simple' THEN
    RAISE EXCEPTION 'Un combo no puede ser componente de otro combo.'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'combo_componente_tipos';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER combo_componente_validar
  BEFORE INSERT OR UPDATE ON combo_componente
  FOR EACH ROW EXECUTE FUNCTION combo_componente_validar();

-- Lista de precios con su regla (RF-028). Los parámetros dependen de la regla:
-- fijo: {}; porcentaje_costo: {"porcentaje": "40"};
-- por_grupo: {"porcentaje": "20", "porCategoria": {"<categoria_id>": "35"}}.
CREATE TABLE lista_precio (
  id              uuid        PRIMARY KEY,
  tenant_id       uuid        NOT NULL REFERENCES comercio (id),
  nombre          text        NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 80),
  regla           text        NOT NULL CHECK (regla IN ('fijo', 'porcentaje_costo', 'por_grupo')),
  parametros      jsonb       NOT NULL DEFAULT '{}',
  creado_en       timestamptz NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  desactivado_en  timestamptz,
  desactivado_por uuid,
  CONSTRAINT lista_precio_baja_completa CHECK (
    is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
  ),
  CONSTRAINT lista_precio_id_comercio UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX lista_precio_nombre_activo ON lista_precio (tenant_id, lower(nombre)) WHERE is_active;
SELECT aplicar_aislamiento_por_comercio('lista_precio');

-- Precio final (con IVA) de cada producto en cada lista, materializado (plan §2.4). Nulo: el
-- producto no tiene precio en esa lista (por ejemplo, una lista de precio fijo sin cargar).
CREATE TABLE precio_lista (
  id           uuid          PRIMARY KEY,
  tenant_id    uuid          NOT NULL,
  lista_id     uuid          NOT NULL,
  producto_id  uuid          NOT NULL,
  precio_final numeric(14,2) CHECK (precio_final >= 0),
  calculado_en timestamptz   NOT NULL,
  CONSTRAINT precio_lista_unico UNIQUE (lista_id, producto_id),
  CONSTRAINT precio_lista_lista FOREIGN KEY (lista_id, tenant_id)
    REFERENCES lista_precio (id, tenant_id),
  CONSTRAINT precio_lista_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id)
);
CREATE INDEX precio_lista_producto_idx ON precio_lista (producto_id);
SELECT aplicar_aislamiento_por_comercio('precio_lista');

-- Historial de precios, solo inserción (RF-018, RF-032).
CREATE TABLE historial_precio (
  id              uuid          PRIMARY KEY,
  tenant_id       uuid          NOT NULL,
  lista_id        uuid          NOT NULL,
  producto_id     uuid          NOT NULL,
  precio_anterior numeric(14,2),
  precio_nuevo    numeric(14,2),
  causa           text          NOT NULL
    CHECK (causa IN ('alta_producto', 'alta_lista', 'costo', 'categoria', 'regla', 'manual', 'combo')),
  usuario_id      uuid          NOT NULL,
  momento         timestamptz   NOT NULL,
  CONSTRAINT historial_precio_lista FOREIGN KEY (lista_id, tenant_id)
    REFERENCES lista_precio (id, tenant_id),
  CONSTRAINT historial_precio_producto FOREIGN KEY (producto_id, tenant_id)
    REFERENCES producto (id, tenant_id)
);
CREATE INDEX historial_precio_consulta ON historial_precio (lista_id, producto_id, momento DESC);
REVOKE UPDATE ON historial_precio FROM pos_app;
SELECT aplicar_aislamiento_por_comercio('historial_precio');

-- Lista activa de cada sucursal (RF-119): una sola columna, así una sucursal no puede tener dos.
ALTER TABLE sucursal
  ADD COLUMN lista_precio_activa_id uuid,
  ADD CONSTRAINT sucursal_lista_del_comercio FOREIGN KEY (lista_precio_activa_id, tenant_id)
    REFERENCES lista_precio (id, tenant_id);

-- Down Migration
ALTER TABLE sucursal DROP COLUMN lista_precio_activa_id;
DROP TABLE historial_precio;
DROP TABLE precio_lista;
DROP TABLE lista_precio;
DROP TABLE combo_componente;
DROP FUNCTION combo_componente_validar();
DROP TABLE producto_imagen;
DROP TABLE producto;
DROP TABLE categoria;
