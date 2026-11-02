# AD-25 · Credenciales fiscales cifradas con clave externa

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-162, D-55, Const. 17

## Decisión

El certificado y la clave fiscal de cada comercio se guardan cifrados en la base, con una clave maestra que vive fuera de la base y del repositorio (en un gestor de secretos o en una variable de entorno protegida). Ningún endpoint los devuelve.

## Alternativa descartada

Guardarlos en texto plano o en archivos del servidor.

## Por qué

Un acceso a la base o a un respaldo no expone las credenciales fiscales de los comercios. Cumple Const. 17 sobre secretos.
