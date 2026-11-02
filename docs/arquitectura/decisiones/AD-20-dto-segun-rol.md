# AD-20 · DTO distintos según el rol de quien recibe

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-092, RF-093, RF-112, RF-137

## Decisión

DTO distintos según el rol de quien recibe. Los de un VO nunca incluyen el saldo teórico, y los rechazos que dependen del teórico usan un mensaje genérico para el VO, con el detalle solo para el autorizante.

## Alternativa descartada

Enviar los datos completos y ocultarlos en la interfaz.

## Por qué

Ocultar en la interfaz no protege (Const. 3): el teórico se vería en la red. RF-112 exige que el VO no pueda deducirlo por ninguna vía.
