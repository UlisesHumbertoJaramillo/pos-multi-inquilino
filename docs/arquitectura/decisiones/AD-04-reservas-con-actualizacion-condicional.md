# AD-04 · Reservas con actualización condicional atómica

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-055 a RF-057, RF-152, Const. 6

## Decisión

Reservas de stock con actualización condicional atómica dentro de la transacción: solo se descuenta el disponible si alcanza, y si no se afecta ninguna fila se rechaza. Con restricciones CHECK de saldo ≥ 0 como red de seguridad. Lo mismo para el saldo de cuota, el límite de crédito y la cantidad devolvible.

## Alternativa descartada

Bloqueos distribuidos en un almacén externo (por ejemplo, Redis), o leer, validar y escribir sin bloqueo.

## Por qué

La base es la fuente de verdad (Const. 1), y la actualización condicional es atómica sin infraestructura extra. Leer y después escribir permite vender dos veces la misma unidad.
