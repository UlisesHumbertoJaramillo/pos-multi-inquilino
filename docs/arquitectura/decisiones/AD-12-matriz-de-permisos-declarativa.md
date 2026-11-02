# AD-12 · Matriz de permisos declarativa

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-004, Const. 4, 10

## Decisión

La matriz de permisos §5.18 es una tabla declarativa en la capa de aplicación (acción → roles y ámbito), que consulta cada caso de uso. Las pruebas de permisos se generan desde esa misma tabla.

## Alternativa descartada

Verificaciones repartidas en controladores o middleware por ruta.

## Por qué

Una sola fuente de verdad, revisable contra el spec, y pruebas que cubren la matriz completa sin escribir cada caso a mano. Lo que no está en la matriz queda denegado.
