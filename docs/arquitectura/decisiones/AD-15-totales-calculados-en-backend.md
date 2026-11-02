# AD-15 · Totales del carrito calculados por el backend

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-060, RF-121, Const. 7, 15

## Decisión

El backend devuelve el carrito con sus totales ya calculados después de cada cambio. El frontend solo muestra.

## Alternativa descartada

Calcular totales en el frontend para que responda más rápido.

## Por qué

Const. 7 y 15 prohíben la lógica de negocio en la interfaz. Duplicar el cálculo genera diferencias entre lo que se muestra y lo que se cobra. La latencia es aceptable porque el POS siempre está conectado.
