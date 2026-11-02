# AD-08 · Dinero en NUMERIC y tipo decimal

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-120 a RF-123, Const. 7

## Decisión

Dinero en `NUMERIC(14,2)` en la base y un tipo decimal en el dominio, con redondeo explícito según D-17.

## Alternativa descartada

Números de punto flotante, o centavos enteros.

## Por qué

El punto flotante introduce errores de redondeo. Los centavos enteros complican los porcentajes, el prorrateo y el IVA hacia atrás. El decimal hace los cálculos reproducibles y verificables.
