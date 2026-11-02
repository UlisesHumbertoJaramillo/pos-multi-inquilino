# Guía para agregar un módulo

Un módulo es un contexto del dominio del [plan §2](../../sdd/plan.md#2-módulos): identidad, catálogo, ventas, caja, etc. La estructura y las reglas de dependencias están en [apps/backend/src/README.md](../../apps/backend/src/README.md).

## Pasos

1. **Leer el spec y la constitución.** Ubicar los RF que el módulo implementa (plan §6) y las restricciones que aplican.
2. **Escribir el contrato primero (AD-21).** Agregar los endpoints a `packages/contracts/openapi.yaml`, con `additionalProperties: false` en cada esquema de respuesta, y correr `npm run contracts:generate`.
3. **Crear las carpetas** `apps/backend/src/modulos/<modulo>/{dominio,aplicacion,adaptadores}`.
4. **Dominio:** entidades, objetos de valor, reglas y cálculos puros. Sin librerías ni módulos de Node. Sus errores son `DomainError`.
5. **Aplicación:** un caso de uso por acción de la matriz §5.18. Verifica permisos y ámbito, abre la transacción con `UnitOfWork`, y declara como puertos (interfaces) todo lo que necesita de afuera. Sus errores esperados son `ApplicationError`.
6. **Adaptadores:** controladores HTTP, repositorios PostgreSQL (con `PgDatabase`, filtrando siempre por `tenant_id`), y clientes de integraciones.
7. **Migraciones:** `npm run db:migration:new -- <nombre>`. Las tablas comerciales llevan `tenant_id` y su política de seguridad a nivel de fila. Las entidades con baja lógica llevan las columnas de [bajas lógicas](#bajas-lógicas).
8. **Pruebas,** etiquetadas con los RF que verifican (por ejemplo `[RF-055]`): unitarias del dominio, de casos de uso con puertos simulados, de integración contra `pos_test` y de contrato.
9. **Documentar** cada puerto y adaptador nuevo en el [catálogo](puertos-y-adaptadores.md) (Const. 14).
10. **Verificar** con `npm run verify` y actualizar la trazabilidad con `npm run trazabilidad`.

## Bajas lógicas

Las entidades no se borran (Const. 5, AD-18). Sus tablas llevan:

```sql
is_active       boolean     NOT NULL DEFAULT true,
desactivado_en  timestamptz,
desactivado_por uuid,
CONSTRAINT <tabla>_baja_completa CHECK (
  is_active = (desactivado_en IS NULL) AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
)
```

Los repositorios usan `PgSoftDeleteTable`, que filtra los activos por defecto.
