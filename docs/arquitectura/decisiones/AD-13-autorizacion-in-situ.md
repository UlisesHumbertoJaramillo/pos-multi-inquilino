# AD-13 · Autorización in situ de un solo uso

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-066, RF-074, RF-081, RF-092, RF-113, RF-141

## Decisión

La autorización in situ es un objeto de dominio: el autorizante ingresa su PIN y el backend emite una autorización de un solo uso, ligada al tipo de operación, a la operación concreta y al solicitante. El caso de uso la consume.

## Alternativa descartada

Mandar el PIN como un campo más de la operación, o un indicador "autorizado" enviado por el frontend.

## Por qué

Impide reutilizar una autorización, hace cumplir que solicitante y autorizante sean distintos (Const. 13) y deja la evidencia en la auditoría. Un indicador enviado por el cliente sería falsificable.
