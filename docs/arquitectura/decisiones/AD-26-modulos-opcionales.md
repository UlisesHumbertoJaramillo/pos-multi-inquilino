# AD-26 · Módulos opcionales activables por comercio

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-163 a RF-169, D-57

## Decisión

Los módulos opcionales del SaaS (hoy, la facturación) son capacidades activables por comercio, guardadas en el comercio. La política de permisos las consulta junto con la matriz §5.18: una acción de un módulo inactivo se rechaza. Los casos de uso afectados (confirmar venta, anular, devolver) preguntan por la capacidad a través de un puerto, sin depender del módulo fiscal.

## Alternativa descartada

Versiones o despliegues distintos según el plan, o ramas de código por cliente.

## Por qué

Una sola base de código y un solo despliegue sirven a todos los planes. Activar o desactivar es un cambio de datos auditado, no un despliegue. El dominio de Ventas no queda acoplado a la facturación.
