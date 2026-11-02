# AD-03 · Base compartida con tenant_id y seguridad a nivel de fila

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-001, RF-002, Const. 3

## Decisión

Una base compartida, con `tenant_id` en cada tabla, filtrado obligatorio en los repositorios y seguridad a nivel de fila de PostgreSQL como segunda barrera. El comercio de la sesión de base de datos se fija por transacción desde el token.

## Alternativa descartada

Un esquema o una base por comercio.

## Por qué

El aislamiento queda garantizado en el servidor dos veces: código y motor. Un esquema por comercio complica las migraciones y los reportes de plataforma sin agregar seguridad real.
