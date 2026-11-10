# Registros de decisiones de arquitectura

Copia individual de cada decisión de la tabla §4 del [plan técnico](../../../sdd/plan.md#4-decisiones-de-arquitectura) (Const. 14). Si una decisión cambia, se actualiza primero el plan y después su registro.

| #                                                        | Decisión                                                        |
| :------------------------------------------------------- | :-------------------------------------------------------------- |
| [AD-01](AD-01-monorepo-con-contratos.md)                 | Monorepo con aplicaciones separadas y contratos generados       |
| [AD-02](AD-02-monolito-modular-hexagonal.md)             | Monolito modular hexagonal                                      |
| [AD-03](AD-03-base-compartida-con-rls.md)                | Base compartida con tenant_id y seguridad a nivel de fila       |
| [AD-04](AD-04-reservas-con-actualizacion-condicional.md) | Reservas con actualización condicional atómica                  |
| [AD-05](AD-05-expiracion-por-worker.md)                  | Expiración de carritos y traspasos por un worker                |
| [AD-06](AD-06-tiempo-real-por-websocket.md)              | Tiempo real por WebSocket con canales asignados por el servidor |
| [AD-07](AD-07-outbox-transaccional.md)                   | Patrón outbox transaccional                                     |
| [AD-08](AD-08-dinero-en-decimal.md)                      | Dinero en NUMERIC y tipo decimal                                |
| [AD-09](AD-09-saldos-y-libro-de-stock.md)                | Saldos de stock materializados y libro de movimientos           |
| [AD-10](AD-10-auditoria-solo-insercion.md)               | Auditoría en tablas de solo inserción                           |
| [AD-11](AD-11-jwt-corto-y-renovacion.md)                 | JWT de vida corta y token de renovación revocable               |
| [AD-12](AD-12-matriz-de-permisos-declarativa.md)         | Matriz de permisos declarativa                                  |
| [AD-13](AD-13-autorizacion-in-situ.md)                   | Autorización in situ de un solo uso                             |
| [AD-14](AD-14-pagos-idempotentes.md)                     | Pagos electrónicos con idempotencia y verificación              |
| [AD-15](AD-15-totales-calculados-en-backend.md)          | Totales del carrito calculados por el backend                   |
| [AD-16](AD-16-perifericos-en-frontend.md)                | Periféricos manejados por un adaptador del frontend             |
| [AD-17](AD-17-promociones-de-tipos-cerrados.md)          | Promociones con un conjunto cerrado de tipos                    |
| [AD-18](AD-18-bajas-logicas-sin-delete.md)               | Bajas lógicas, sin permiso de DELETE                            |
| [AD-19](AD-19-trabajos-en-postgresql.md)                 | Trabajos en segundo plano en PostgreSQL                         |
| [AD-20](AD-20-dto-segun-rol.md)                          | DTO distintos según el rol de quien recibe                      |
| [AD-21](AD-21-contrato-openapi-primero.md)               | Contrato OpenAPI escrito antes de implementar                   |
| [AD-22](AD-22-endpoints-publicos-en-lista-blanca.md)     | Endpoints públicos limitados a una lista blanca                 |
| [AD-23](AD-23-contingencia-fiscal-caea.md)               | Contingencia fiscal con el régimen CAEA                         |
| [AD-24](AD-24-webhooks-mercado-pago.md)                  | Webhooks de Mercado Pago verificados por firma                  |
| [AD-25](AD-25-credenciales-fiscales-cifradas.md)         | Credenciales fiscales cifradas con clave externa                |
| [AD-26](AD-26-modulos-opcionales.md)                     | Módulos opcionales activables por comercio                      |
| [AD-30](AD-30-sistema-visual-unico.md)                   | Sistema visual único con severidades y componentes compartidos  |
