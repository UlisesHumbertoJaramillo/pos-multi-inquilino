# AD-23 · Contingencia fiscal con el régimen CAEA

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-101, RF-160, RF-161, D-56

## Decisión

Contingencia fiscal con el régimen CAEA de ARCA: código pedido por adelantado cada quincena, comprobantes emitidos con CAEA durante la caída e informados después.

## Alternativa descartada

Entregar un ticket provisorio y pedir el CAE al volver el servicio.

## Por qué

Con ARCA, un comprobante sin código de autorización no es válido: con el ticket provisorio el cliente se iría sin factura. El ticket no fiscal queda solo como último recurso, si no hay un CAEA vigente (RF-161).
