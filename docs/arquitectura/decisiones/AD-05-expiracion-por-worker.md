# AD-05 · Expiración de carritos y traspasos por un worker

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-059, RF-079, RF-116

## Decisión

La expiración de carritos y de traspasos la hace un worker del servidor, que busca ventas en curso con `ultima_actividad` vencida y las descarta con su motivo.

## Alternativa descartada

Que el navegador avise al cerrarse, o un vencimiento automático en un almacén externo.

## Por qué

El navegador puede cerrarse o desconectarse sin avisar (D-2, D-47). La expiración tiene que ocurrir igual y quedar registrada (RF-116).
