# AD-24 · Webhooks de Mercado Pago verificados por firma

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-075, RF-126, Const. 16

## Decisión

Webhooks de Mercado Pago en un endpoint público, verificados con la firma del proveedor y con límite de frecuencia. La notificación nunca se toma como verdadera: solo dispara la consulta del pago a la API, y el worker de verificación sigue consultando si la notificación no llega.

## Alternativa descartada

Consultar solo periódicamente, sin webhooks.

## Por qué

Los webhooks reducen la demora entre el pago en la terminal y la confirmación de la venta. Verificar la firma y volver a consultar evita que una notificación falsa confirme un pago. Requirió ampliar Const. 16.
