# AD-07 · Patrón outbox transaccional

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-076, RF-100, D-21

## Decisión

Patrón outbox transaccional: el pedido de comprobante fiscal y los eventos de tiempo real se escriben en la misma transacción que la venta y los envía un worker.

## Alternativa descartada

Llamar al servicio fiscal o publicar el evento justo después del commit.

## Por qué

Si el proceso cae entre el commit y la llamada, la venta queda sin comprobante (D-21). Con el outbox, ninguna venta confirmada pierde su pedido fiscal.
