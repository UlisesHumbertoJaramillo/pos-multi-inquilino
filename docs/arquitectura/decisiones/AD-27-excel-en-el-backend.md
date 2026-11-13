# AD-27 · Los archivos Excel se leen en el backend

- **Estado:** aceptada
- **Origen:** [plan técnico §4](../../../sdd/plan.md#4-decisiones-de-arquitectura)
- **Requisitos y principios:** RF-170 a RF-174, D-98, Const. 14 y 17

## Decisión

Los archivos Excel se leen y se validan en el backend, detrás de los puertos `SpreadsheetReader` y `SpreadsheetWriter`. El adaptador usa read-excel-file y write-excel-file (versiones fijas, sin vulnerabilidades conocidas) y fflate para revisar el contenido del archivo sin descomprimirlo. Solo se aceptan libros .xlsx de hasta 5 MB y 50 MB descomprimidos, sin macros; las fórmulas se toman por el valor que guardó Excel y nunca se evalúan.

## Alternativa descartada

Leer el archivo en el navegador y mandar las filas al backend como JSON.

## Por qué

La validación tiene que ocurrir en el servidor (Const. 17): la del navegador se puede saltear. El puerto permite cambiar de librería sin tocar los casos de uso.
