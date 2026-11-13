# AD-29 · Gráficas con series que calcula el backend

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-186, RF-187, D-97, Const. 7 y 15

## Decisión

Las gráficas de los dashboards usan MUI X Charts, la librería del mismo ecosistema que la interfaz, y dibujan series que calcula el backend: la comparación con el período anterior, la serie diaria completa y los más vendidos.

## Alternativa descartada

Calcular agregados en el navegador a partir de datos crudos, o usar una librería de gráficas con estilos propios.

## Por qué

Los cálculos van en el backend (Const. 7 y 15), y la misma librería toma los colores del tema en modo claro y oscuro.
