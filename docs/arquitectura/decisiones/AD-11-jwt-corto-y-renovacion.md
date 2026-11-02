# AD-11 · JWT de vida corta y token de renovación revocable

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-009, RF-146, Const. 16, 17

## Decisión

Token de acceso JWT de vida corta, más un token de renovación opaco, guardado con hash y revocable.

## Alternativa descartada

Solo un JWT de vida larga, o sesiones guardadas solo en el servidor.

## Por qué

Un JWT largo no se puede revocar: suspender un comercio no surtiría efecto inmediato (RF-146). El JWT corto evita consultar la base en cada solicitud, y la renovación cubre el vencimiento por inactividad y la revocación.

## Nota de implementación (E2)

RF-146 exige que la suspensión de un comercio cierre las sesiones **de inmediato**, y un token de acceso sin estado seguiría sirviendo hasta su vencimiento. Por eso cada solicitud autenticada verifica además, con una consulta indexada a `token_renovacion`, que su sesión siga vigente (puerto `SessionStatus`). El token de acceso sigue siendo corto y firmado; la consulta solo agrega la revocación inmediata, que también aplica al cierre de sesión. Pendiente de reflejar en el plan técnico.
