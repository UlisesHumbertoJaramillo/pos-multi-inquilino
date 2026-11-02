# Catálogo de puertos y adaptadores

Todo puerto o adaptador nuevo o modificado se registra aquí en el mismo cambio que lo introduce (Const. 14). Los nombres del código están en inglés; entre paréntesis, el nombre del plan. Las rutas son relativas a `apps/backend/src`.

## Puertos

| Puerto                         | Ubicación                                | Para qué                                                                                                     | Adaptadores                                         |
| :----------------------------- | :--------------------------------------- | :----------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- |
| `Clock` (Reloj)                | `compartido/aplicacion/clock.ts`         | Hora actual. Los casos de uso nunca leen la hora del sistema directamente.                                   | `systemClock`; `ManualClock` en pruebas             |
| `IdGenerator` (GeneradorDeId)  | `compartido/aplicacion/id-generator.ts`  | Identificadores UUID generados por el backend.                                                               | `uuidGenerator`                                     |
| `UnitOfWork` (UnidadDeTrabajo) | `compartido/aplicacion/unit-of-work.ts`  | Transacción: todo se confirma junto o nada. Fija el comercio de la sesión para la seguridad a nivel de fila. | `PgDatabase`                                        |
| `JobScheduler`                 | `compartido/aplicacion/job-scheduler.ts` | Programar trabajos en segundo plano, idempotentes por tipo y clave (AD-19).                                  | `PgJobScheduler`                                    |
| `EventOutbox`                  | `compartido/aplicacion/event-outbox.ts`  | Escribir eventos en la misma transacción que el cambio que los origina (AD-07).                              | `PgEventOutbox`                                     |
| `Logger`                       | `compartido/aplicacion/logger.ts`        | Registrar eventos y errores.                                                                                 | `createPinoLogger`; `createMemoryLogger` en pruebas |

## Dominio compartido

| Pieza              | Ubicación                           | Qué hace                                                                                            |
| :----------------- | :---------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `DomainError`      | `compartido/dominio/errors.ts`      | Violación de una regla de negocio. El adaptador HTTP la responde con 409.                           |
| Bajas lógicas      | `compartido/dominio/soft-delete.ts` | Estado de activación y regla de baja: no se da de baja dos veces (RF-020).                          |
| `ApplicationError` | `compartido/aplicacion/errors.ts`   | Errores esperados de los casos de uso (no encontrado, sin permiso, conflicto...), sin conocer HTTP. |

## Adaptadores de entrada

| Adaptador            | Ubicación                                               | Qué hace                                                                                                           |
| :------------------- | :------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------- |
| Aplicación HTTP      | `app.ts`, `server.ts`                                   | Raíz de composición de la API: conecta seguridad, rutas y manejo de errores.                                       |
| Seguridad HTTP       | `compartido/adaptadores/http/security.ts`               | Cabeceras de seguridad, CORS limitado al frontend y límite del cuerpo JSON (T-016).                                |
| Errores HTTP         | `compartido/adaptadores/http/errors.ts`                 | Convierte errores en `{codigo, mensaje}` sin detalles internos y responde 404 a rutas inexistentes (T-015).        |
| Documentación        | `compartido/adaptadores/http/docs.ts`                   | Swagger UI en `/docs`, solo en desarrollo (T-013).                                                                 |
| Proceso worker       | `worker.ts`                                             | Raíz de composición del worker: ejecuta trabajos programados y despacha el outbox. `npm run worker`.               |
| `PgJobWorker`        | `compartido/adaptadores/jobs/pg-job-worker.ts`          | Toma trabajos con `FOR UPDATE SKIP LOCKED`, reintenta con espera creciente y retoma los abandonados (T-021).       |
| `PgOutboxDispatcher` | `compartido/adaptadores/outbox/pg-outbox-dispatcher.ts` | Entrega cada evento a su manejador y lo marca procesado en la misma transacción. Nunca descarta un evento (T-022). |

## Adaptadores de salida

| Adaptador           | Implementa     | Ubicación                                              | Notas                                                                                                                                                   |
| :------------------ | :------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `systemClock`       | `Clock`        | `compartido/adaptadores/clock/system-clock.ts`         | Hora del sistema.                                                                                                                                       |
| `uuidGenerator`     | `IdGenerator`  | `compartido/adaptadores/id/uuid-generator.ts`          | UUID v4 con `crypto.randomUUID`.                                                                                                                        |
| `PgDatabase`        | `UnitOfWork`   | `compartido/adaptadores/postgres/pg-database.ts`       | Guarda la transacción en curso en el contexto asíncrono: los repositorios usan `query` y participan de ella. Una unidad anidada se suma a la de afuera. |
| `createPgPool`      | —              | `compartido/adaptadores/postgres/pool.ts`              | Pool de conexiones, siempre con el rol `pos_app`.                                                                                                       |
| `PgSoftDeleteTable` | —              | `compartido/adaptadores/postgres/soft-delete-table.ts` | Base de repositorios con baja lógica: solo activos por defecto, siempre filtrado por comercio (T-023).                                                  |
| `PgJobScheduler`    | `JobScheduler` | `compartido/adaptadores/jobs/pg-job-scheduler.ts`      | Tabla `trabajo_programado`.                                                                                                                             |
| `PgEventOutbox`     | `EventOutbox`  | `compartido/adaptadores/outbox/pg-event-outbox.ts`     | Tabla `outbox`. Falla si se usa fuera de una unidad de trabajo.                                                                                         |
| `createPinoLogger`  | `Logger`       | `compartido/adaptadores/logging/pino-logger.ts`        | JSON con pino. Oculta contraseñas, PIN, tokens, secretos y datos de pago antes de escribir (`redact.ts`).                                               |
| `loadOpenApiSpec`   | —              | `compartido/adaptadores/http/openapi-spec.ts`          | Lee el contrato `packages/contracts/openapi.yaml`.                                                                                                      |
