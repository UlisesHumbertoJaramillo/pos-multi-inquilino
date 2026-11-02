# AD-10 · Auditoría en tablas de solo inserción

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-018 a RF-022, RF-114

## Decisión

Auditoría en tablas de solo inserción, escritas en la misma transacción que la operación, con el usuario de base de datos de la aplicación sin permisos de modificar ni borrar. Comercial y técnica en tablas separadas.

## Alternativa descartada

Registros en archivos o en un servicio externo de logs.

## Por qué

Si la operación se confirma, su auditoría también. El motor impide la manipulación aunque haya un error en el código. La separación física hace cumplir D-9.
