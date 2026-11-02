# AD-17 · Promociones con un conjunto cerrado de tipos

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-048, RF-050

## Decisión

Promociones con un conjunto cerrado de tipos (NxM, porcentaje por producto o categoría, precio especial por cantidad), cada uno con su evaluador en el dominio.

## Alternativa descartada

Un motor genérico de reglas o un lenguaje propio de condiciones.

## Por qué

Los tipos cerrados son verificables con casos de prueba concretos y alcanzan para lo que pide la v8.5. Un motor genérico es difícil de probar y de explicar al cliente. Agregar un tipo nuevo es una extensión localizada.
