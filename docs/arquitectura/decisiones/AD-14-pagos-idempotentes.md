# AD-14 · Pagos electrónicos con idempotencia y verificación

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-075, RF-125 a RF-127

## Decisión

Pagos electrónicos con clave de idempotencia por intento, estado "por verificar" ante timeout y un worker de verificación contra la pasarela.

## Alternativa descartada

Reintentar el cobro ante timeout.

## Por qué

Reintentar sin saber si el primer intento se aprobó genera cobros duplicados. La idempotencia y la verificación resuelven la incertidumbre sin falsear la venta (Const. 11).
