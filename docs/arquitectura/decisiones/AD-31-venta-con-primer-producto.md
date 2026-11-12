# AD-31 · La venta nace con su primer producto

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-176, D-93

## Decisión

Agregar un producto sin una venta activa crea la venta y reserva el ítem en una sola operación del backend, en la misma transacción.

## Alternativa descartada

Que el frontend cree la venta y después agregue el ítem con una segunda llamada.

## Por qué

Dos llamadas pueden dejar ventas vacías si la segunda falla (por ejemplo, sin stock), y suman una espera más a cada venta.
