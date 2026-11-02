# AD-18 · Bajas lógicas, sin permiso de DELETE

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-020, RF-021, RF-148

## Decisión

Bajas lógicas con `is_active` y quién y cuándo, sin permiso de DELETE para la aplicación. Las dependencias que impiden una baja se validan en el dominio.

## Alternativa descartada

Mover lo dado de baja a tablas de archivo.

## Por qué

El archivo rompe referencias y complica el historial. Sin permiso de DELETE, Const. 5 se cumple aunque haya un error en el código.

## Nota de implementación (E2, Fase 3)

Quitar un rol a un usuario también es una baja lógica: `usuario_rol` tiene `is_active`, y la unicidad de un rol por usuario y sucursal aplica solo entre los activos. Así queda el historial de qué roles tuvo cada usuario, además de la auditoría comercial del cambio.
