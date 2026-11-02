# AD-02 · Monolito modular hexagonal

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** Const. 6, 14

## Decisión

Monolito modular hexagonal: un backend desplegable, con módulos de dominio aislados.

## Alternativa descartada

Microservicios por contexto.

## Por qué

La confirmación de una venta toca stock, caja, cuota, crédito y la cola fiscal en una sola transacción (RF-076). Repartirlo entre servicios exigiría sagas y consistencia eventual justo donde Const. 6 pide atomicidad. Los límites de módulo permiten separar servicios más adelante si hace falta.
