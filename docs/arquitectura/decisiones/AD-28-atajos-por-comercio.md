# AD-28 · Atajos del POS como parámetro del comercio

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-181 a RF-185, D-94, D-100

## Decisión

Los atajos son un parámetro del comercio. El catálogo de acciones, la distribución por defecto y la validación de cada cambio del AC viven en el dominio del backend. El frontend recibe el mapa y solo traduce teclas en acciones.

## Alternativa descartada

Atajos fijos definidos en el frontend.

## Por qué

El AC los configura para los equipos de su comercio (D-94), y las reglas que validan un atajo (teclas repetidas, reservadas, combinaciones de dos manos) son de negocio (Const. 15).
