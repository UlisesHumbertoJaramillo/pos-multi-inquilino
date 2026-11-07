-- Up Migration
-- Alertas, tiempo real y reportes (T-227 a T-236; plan §2.17, §2.18, AD-06).

-- Recordatorio de las alertas persistentes (D-91): la alerta recordada vuelve al principio.
ALTER TABLE alerta ADD COLUMN ultimo_recordatorio timestamptz;
CREATE INDEX alerta_persistente_pendiente ON alerta (tenant_id, proximo_recordatorio)
  WHERE persistente AND resuelta_en IS NULL;
CREATE INDEX alerta_por_destinatario ON alerta (tenant_id, destinatario_rol, creada_en DESC)
  WHERE resuelta_en IS NULL;

-- Avisos en vivo (RF-061, AD-06). pg_notify dentro de la transacción solo se entrega si la
-- transacción confirma, y en el orden del commit: nunca se avisa un cambio que se revirtió.
-- El aviso lleva solo identificadores y el disponible; el servidor decide a qué conexiones va.
CREATE FUNCTION avisar_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Una fila nueva en cero no cambia nada: antes tampoco había stock.
  IF (TG_OP = 'INSERT' AND NEW.disponible <> 0)
     OR (TG_OP = 'UPDATE' AND NEW.disponible IS DISTINCT FROM OLD.disponible) THEN
    PERFORM pg_notify('pos_tiempo_real', json_build_object(
      'tipo', 'stock',
      'tenantId', NEW.tenant_id,
      'sucursalId', NEW.sucursal_id,
      'productoId', NEW.producto_id,
      'disponible', NEW.disponible::text
    )::text);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER inventario_aviso AFTER INSERT OR UPDATE ON inventario
  FOR EACH ROW EXECUTE FUNCTION avisar_stock();

CREATE FUNCTION avisar_alerta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('pos_tiempo_real', json_build_object(
    'tipo', 'alertas',
    'tenantId', NEW.tenant_id,
    'sucursalId', NEW.sucursal_id,
    'rol', NEW.destinatario_rol
  )::text);
  RETURN NULL;
END;
$$;
CREATE TRIGGER alerta_aviso AFTER INSERT OR UPDATE ON alerta
  FOR EACH ROW EXECUTE FUNCTION avisar_alerta();

-- Consultas de reportes por fecha de jornada y de la auditoría por sucursal.
CREATE INDEX venta_por_sucursal_confirmada ON venta (tenant_id, sucursal_id, confirmada_en)
  WHERE confirmada_en IS NOT NULL;
CREATE INDEX auditoria_comercial_por_sucursal ON auditoria_comercial
  (tenant_id, sucursal_id, momento DESC);

-- Down Migration
DROP INDEX auditoria_comercial_por_sucursal;
DROP INDEX venta_por_sucursal_confirmada;
DROP TRIGGER alerta_aviso ON alerta;
DROP FUNCTION avisar_alerta();
DROP TRIGGER inventario_aviso ON inventario;
DROP FUNCTION avisar_stock();
DROP INDEX alerta_por_destinatario;
DROP INDEX alerta_persistente_pendiente;
ALTER TABLE alerta DROP COLUMN ultimo_recordatorio;
