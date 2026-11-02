# AD-19 · Trabajos en segundo plano en PostgreSQL

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-059, RF-102, RF-105, RF-126

## Decisión

Trabajos en segundo plano con una tabla de trabajos en PostgreSQL, tomados con bloqueo que omite filas ya tomadas, en procesos worker del mismo código.

## Alternativa descartada

Una cola externa (RabbitMQ, Redis).

## Por qué

Const. 1 hace de PostgreSQL la fuente de verdad. Una cola externa agrega otra pieza que puede quedar desincronizada con la base. El volumen esperado no la justifica.
