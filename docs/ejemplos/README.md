# Archivos de ejemplo

Planillas para probar la carga desde Excel (**Administración → Carga desde Excel**, como AC) con los datos de demostración (`npm run db:seed`). Cada una trae filas que se crean, filas que se actualizan y filas con errores a propósito, para ver los rechazos en la vista previa.

| Archivo                                          | Qué carga                                           | Resultado esperado                                                                                                                           |
| :----------------------------------------------- | :-------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| [productos.xlsx](productos.xlsx)                 | Código de barras, Nombre, Categoría y Costo sin IVA | 3 se crean, 2 se actualizan (agua y yerba) y 3 se rechazan: una categoría que no existe, un costo vacío y una fila sin código.               |
| [proveedores.xlsx](proveedores.xlsx)             | CUIT, Razón social y Contacto                       | 2 se crean, 1 se actualiza (Distribuidora del Sur, sin tocar su saldo) y 1 se rechaza por un CUIT con el dígito verificador equivocado.      |
| [precios.xlsx](precios.xlsx)                     | Lista, Código de barras y Precio final              | 3 precios nuevos en «Precios especiales» y 2 rechazos: un código que no existe y la lista «Minorista», que calcula sus precios con su regla. |
| [catalogo-proveedor.csv](catalogo-proveedor.csv) | Catálogo de un proveedor en CSV (RF-035)            | La importación de **Proveedores → Importar catálogo**.                                                                                       |

Una prueba punta a punta (`e2e/carga-excel.spec.ts`) carga estos archivos y verifica estos resultados.
