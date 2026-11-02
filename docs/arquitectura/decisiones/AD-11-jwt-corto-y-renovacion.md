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
