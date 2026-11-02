# AD-16 · Periféricos manejados por un adaptador del frontend

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-054, RF-108, RF-158, Const. 11

## Decisión

Los periféricos se manejan con un adaptador en el frontend (APIs nativas del navegador y, si no alcanzan, un agente local) que solo imprime o lee. El documento a imprimir lo arma el backend, y el resultado de la impresión se le informa al backend.

## Alternativa descartada

Que el backend hable directamente con las impresoras.

## Por qué

Los periféricos están conectados al equipo del usuario y el backend no los alcanza. Como el frontend solo transporta un documento ya calculado, no tiene lógica de negocio.
