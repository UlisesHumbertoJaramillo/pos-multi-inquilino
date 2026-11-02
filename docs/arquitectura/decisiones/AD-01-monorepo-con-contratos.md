# AD-01 · Monorepo con aplicaciones separadas y contratos generados

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** Const. 15

## Decisión

Monorepo con backend y frontend como aplicaciones separadas, y un paquete de contratos generado desde OpenAPI que contiene solo tipos.

## Alternativa descartada

Repositorios separados, o compartir código de dominio entre backend y frontend.

## Por qué

El monorepo mantiene sincronizados el contrato y sus consumidores en un mismo cambio. Compartir dominio pondría lógica de negocio en el frontend.
