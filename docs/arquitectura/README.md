# Arquitectura

Documentación viva de la arquitectura (Const. 14). Se actualiza en el mismo cambio que agrega o modifica un puerto, un adaptador o una decisión.

| Documento                                                            | Contenido                                                                  |
| :------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| [Diagrama de contexto](contexto.md)                                  | Actores y sistemas externos.                                               |
| [Diagrama de contenedores](contenedores.md)                          | Frontend, backend, workers y base de datos, y cómo se comunican.           |
| [Puertos y adaptadores](puertos-y-adaptadores.md)                    | Catálogo de los puertos del backend y sus adaptadores.                     |
| [Decisiones](decisiones/README.md)                                   | AD-01 a AD-26, un registro por decisión.                                   |
| [Guía para agregar un módulo](guia-nuevo-modulo.md)                  | Pasos y convenciones para un módulo nuevo.                                 |
| [Estructura hexagonal del backend](../../apps/backend/src/README.md) | Capas, carpetas y reglas de dependencias que verifica `npm run lint:arch`. |

## Herramientas elegidas en la implementación

Decisiones de herramientas que el plan dejaba abiertas. No cambian ninguna decisión de arquitectura.

| Necesidad              | Herramienta                            | Motivo                                                                                               |
| :--------------------- | :------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| Cliente de PostgreSQL  | `pg`                                   | SQL explícito, necesario para la seguridad a nivel de fila, índices parciales y restricciones CHECK. |
| Migraciones            | `node-pg-migrate`, con archivos `.sql` | Migraciones en SQL puro, aplicadas en una sola transacción.                                          |
| Reglas de arquitectura | `dependency-cruiser`                   | Reglas de dependencias entre capas y aplicaciones, incluidos los imports de solo tipos.              |
| Tipos del contrato     | `@hey-api/openapi-ts` (solo tipos)     | Soporta TypeScript 6 y genera tipos sin cliente HTTP (AD-01).                                        |
| Registro               | `pino`                                 | JSON estructurado, con ocultamiento propio de datos sensibles.                                       |
| Seguridad HTTP         | `helmet` y `cors`                      | Cabeceras de seguridad estándar y CORS con rechazo en el servidor.                                   |
| Pruebas                | Vitest, Supertest, Ajv                 | Ajv valida las respuestas contra el contrato OpenAPI 3.1.                                            |
