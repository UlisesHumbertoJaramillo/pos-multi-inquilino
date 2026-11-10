# AD-30 · Sistema visual único

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-188, RF-192, RF-193, D-96, D-99

## Decisión

El tema define la paleta de marca y los cuatro niveles de severidad (crítica, advertencia, informativa y correcta) en modo claro y oscuro. Las pantallas usan componentes compartidos para los estados, los puntos de atención, el encabezado y el panel de detalle de segundo nivel. Una regla de lint prohíbe escribir colores fuera del tema.

## Alternativa descartada

Que cada pantalla decida sus estilos y sus colores.

## Por qué

Es la única forma de sostener la coherencia entre los cuatro roles a medida que crecen las pantallas, y de que un color signifique lo mismo en todo el sistema.
