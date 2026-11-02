-- Up Migration
-- Privilegios por defecto del rol de la aplicación (T-009, RF-021, AD-18).
-- Toda tabla que cree pos_owner en public le da a pos_app solo SELECT, INSERT y UPDATE.
-- pos_app nunca recibe DELETE ni TRUNCATE: las bajas son lógicas (Const. 5).
-- Las tablas de auditoría quitan además el UPDATE en su propia migración (AD-10).
-- Va en una migración porque db:reset borra el esquema public, y estos privilegios se borran con él.
ALTER DEFAULT PRIVILEGES FOR ROLE pos_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO pos_app;

ALTER DEFAULT PRIVILEGES FOR ROLE pos_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pos_app;

-- Down Migration
ALTER DEFAULT PRIVILEGES FOR ROLE pos_owner IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM pos_app;

ALTER DEFAULT PRIVILEGES FOR ROLE pos_owner IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE ON TABLES FROM pos_app;
