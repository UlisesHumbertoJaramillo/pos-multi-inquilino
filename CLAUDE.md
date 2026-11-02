# CLAUDE.md — Configuración de Claude Code para "Sistema POS Multi-Tenant"

## Proyecto

Sistema de Punto de Venta (POS) Web bajo un modelo multi-inquilino (_multi-tenant_) de alta disponibilidad. Permite la coexistencia independiente de múltiples comercios (Tenants), gestión de sucursales, cajas, inventario concurrente en tiempo real, facturación electrónica con contingencia, arqueos ciegos (Cortes X/Z), cuentas por pagar a proveedores y dashboards analíticos. El proyecto sigue estrictamente la metodología **Spec-Driven Development (SDD)** y arquitectura orientada a servicios segregados por tenant.

## Comandos

- **Desarrollo:** `npm run dev` (o script correspondiente para iniciar cliente/servidor)
- **Construcción:** `npm run build`
- **Pruebas unitarias e integración:** `npm run test` (ejecuta la suite de pruebas y falla si el coverage baja o si hay fallos sintácticos)
- **Lint / Formato:** `npm run lint` / `npm run format` (ESLint / Prettier u homologos según tecnología configurada)
- **Validación de BD / Migraciones:** `npm run db:migrate`

## Estilo y Convenciones

- **Interfaz Visual (UI/UX):**
  - Estilo **Material Design / Material UI** moderno con soporte nativo para **Modo Claro y Modo Oscuro**.
  - Incorporación de sutiles **elementos de cristal (_Glassmorphism_)** en paneles flotantes, modales y barras superiores/laterales para un acabado profesional, elegante y limpio.
  - POS optimizado para pantallas táctiles/tablets y dashboards analíticos adaptados a Desktop.
- **Tipado y Código:** Tipado estricto obligatorio en todo el stack.
- **Convenciones de Nombres:**
  - Componentes UI: `PascalCase` (ej: `TenantSelector.tsx`, `CashRegisterModal.tsx`).
  - Funciones, Métodos y Utilidades: `camelCase` (ej: `calculateDynamicPrice()`, `processBlindClosure()`).
  - Tablas y Entidades de Datos: `snake_case` o `PascalCase` según ORM (ej: `sesion_caja`, `pago_proveedor`).
  - Constantes y Enums: `UPPER_SNAKE_CASE` (ej: `MAX_DISCOUNT_PERCENTAGE`).
- **Idioma del Código:** Variables, tipos y lógica en inglés técnico estándar. Comentarios funcionales, mensajes de error orientados a usuario y commits en español claro.

## Reglas

- Lee obligatoriamente la constitución (`sdd/constitution.md`) y el spec activo (`sdd/spec.md`) antes de escribir o modificar cualquier módulo del código. La v8.5 (`sdd/especification.md`) es la fuente histórica; ante una diferencia, prevalece el spec.
- **Segregación de funciones (Const. 13):** quien autoriza con PIN o credencial nunca puede ser quien solicitó la operación. Los permisos siguen la matriz de `sdd/spec.md` §5.18.
- **Segregación Estricta (RN-01):** Garantiza que todos los queries de base de datos e interacciones filtren explícitamente por `tenant_id`. Ningún tenant o Super Admin debe ver datos comerciales/financieros cruzados.
- **Preservación del Modelo de Datos (RN-02):** Prohibido el uso de borrado físico (`HARD DELETE`). Aplica borrado lógico (`Soft Delete` mediante `is_active`) para mantener integridad relacional y retención perpetua.
- **Aislamiento de Capas:** Manten aislada la lógica de negocio pura (cálculos de IVA, recargos por pago mixto, arqueo ciego, cuotas de descuento) de los componentes visuales de presentación.
- **Arquitectura (Const. 14 y 15):** Backend hexagonal (puertos y adaptadores), con el dominio independiente de frameworks, base de datos e integraciones; documenta cada puerto y adaptador nuevo o modificado. Frontend y backend separados, comunicados solo por endpoints. El frontend no tiene lógica de negocio (solo presentación, captura y validación de formato); consulta antes de implementar cualquier excepción.
- **Seguridad (Const. 16 y 17):** Todo endpoint nuevo exige token de API, salvo salud del sistema, inicio de sesión, validación de correo, recuperación de contraseña y webhooks de integraciones (estos se verifican por firma y solo disparan una consulta a la API del proveedor). Valida entradas en el servidor, parametriza consultas, no registres secretos ni datos sensibles en logs y no expongas detalles internos en los errores.
- **Límites:** No agregues características fuera de alcance (no fidelización de clientes, no multimoneda en vivo, no e-commerce externo) sin consulta previa.

## Al terminar cualquier tarea

- **Verificación Obligatoria:** Ejecutar las pruebas (`npm run test`) y la verificación de linting (`npm run lint`).
- Marcar el checklist correspondiente como completado en el roadmap/track del proyecto.
- Resumir claramente los cambios implementados y las entidades/rutas modificadas.
