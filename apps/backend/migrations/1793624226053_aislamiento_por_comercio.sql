-- Up Migration
-- Seguridad a nivel de fila por comercio (T-039, AD-03, RF-001).
-- La unidad de trabajo fija app.tenant_id en cada transacción. Sin comercio fijado, una tabla
-- comercial no devuelve ninguna fila. pos_app no es dueño de las tablas, así que la política
-- siempre le aplica; pos_owner (migraciones y arnés de pruebas) la omite como dueño.

-- Comercio de la transacción en curso, o NULL si no hay ninguno.
CREATE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Política plantilla: toda tabla comercial (con tenant_id) se aísla llamando a esta función
-- en su migración, por ejemplo: SELECT aplicar_aislamiento_por_comercio('producto');
CREATE FUNCTION aplicar_aislamiento_por_comercio(tabla regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tabla);
  EXECUTE format(
    'CREATE POLICY aislamiento_por_comercio ON %s
       USING (tenant_id = app_tenant_id())
       WITH CHECK (tenant_id = app_tenant_id())',
    tabla
  );
END;
$$;

REVOKE ALL ON FUNCTION aplicar_aislamiento_por_comercio(regclass) FROM PUBLIC;

-- Comercio dueño de un registro, sin importar el comercio de la transacción. Solo devuelve el
-- comercio, nunca datos: sirve para responder "no existe" y registrar el intento (RF-002).
-- SECURITY DEFINER: corre como pos_owner, que como dueño omite la seguridad a nivel de fila.
CREATE FUNCTION comercio_de_registro(tabla regclass, registro_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  dueño uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = tabla::text AND policyname = 'aislamiento_por_comercio'
  ) THEN
    RAISE EXCEPTION 'La tabla % no está aislada por comercio.', tabla;
  END IF;
  EXECUTE format('SELECT tenant_id FROM %s WHERE id = $1', tabla) INTO dueño USING registro_id;
  RETURN dueño;
END;
$$;

REVOKE ALL ON FUNCTION comercio_de_registro(regclass, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION comercio_de_registro(regclass, uuid) TO pos_app;

-- Down Migration
DROP FUNCTION comercio_de_registro(regclass, uuid);
DROP FUNCTION aplicar_aislamiento_por_comercio(regclass);
DROP FUNCTION app_tenant_id();
