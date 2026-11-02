# AD-21 · Contrato OpenAPI escrito antes de implementar

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** Const. 14, 15

## Decisión

El contrato de la API es una especificación OpenAPI versionada, escrita antes de implementar cada endpoint. Las respuestas se validan contra ella en las pruebas.

## Alternativa descartada

Documentar la API después, a partir del código.

## Por qué

El contrato es el único punto de contacto entre frontend y backend (Const. 15). Escribirlo primero permite trabajar en paralelo y detectar incompatibilidades en CI.
