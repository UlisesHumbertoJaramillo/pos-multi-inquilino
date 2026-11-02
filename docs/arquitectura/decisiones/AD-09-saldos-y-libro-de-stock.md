# AD-09 · Saldos de stock materializados y libro de movimientos

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-018, RF-039, RF-042

## Decisión

Saldos de stock materializados más un libro de movimientos inmutable. Cada cambio de saldo escribe su movimiento en la misma transacción.

## Alternativa descartada

Solo saldos, sin historial, o reconstruir los saldos desde los eventos.

## Por qué

Solo saldos pierde la trazabilidad (Const. 5). Reconstruir desde eventos vuelve lentas las validaciones de disponibilidad, que se hacen en cada agregado al carrito.
