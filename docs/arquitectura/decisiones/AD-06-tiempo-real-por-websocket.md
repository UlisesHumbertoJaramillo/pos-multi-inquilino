# AD-06 · Tiempo real por WebSocket con canales asignados por el servidor

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-061, Const. 3

## Decisión

Tiempo real por WebSocket autenticado con el mismo token, con un canal por comercio y sucursal. El servidor decide a qué canal se suscribe cada conexión. Los eventos salen del outbox después del commit.

## Alternativa descartada

Consulta periódica desde el frontend.

## Por qué

Con 2 segundos como máximo (D-50), la consulta periódica genera carga constante en todos los POS. Que el servidor asigne el canal impide que un cliente escuche otra sucursal (RF-061).
