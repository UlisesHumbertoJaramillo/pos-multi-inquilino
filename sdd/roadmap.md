# Roadmap — Sistema POS Multi-Inquilino

**Deriva de:** [tareas.md](tareas.md) (T-001 a T-250), [plan.md](plan.md) y [spec.md](spec.md) v1.1 (RF-001 a RF-169).
**Cómo leerlo:** el trabajo se agrupa en 11 entregas. Cada entrega termina con una **demo en localhost** que se puede mostrar, y su criterio de salida es verificable. El orden respeta las dependencias de `tareas.md`.

**Esfuerzo:** cada tarea dura como máximo 30 minutos, así que el esfuerzo de cada entrega es un **tope** de implementación: no incluye revisiones, esperas por credenciales externas ni retrabajo. El total del roadmap es de **250 tareas, con un tope de 125 horas**.

**"RF cerrados"** son los requisitos cuya última tarea termina en esa entrega. Muchos funcionan antes, pero quedan cerrados recién cuando su prueba final (a veces una prueba punta a punta de la entrega E10) pasa.

---

## Vista general

| Entrega | Nombre | Tareas | Tope | RF cerrados | Hito |
| :-- | :-- | :-- | :-- | :-- | :-- |
| E0 | Base técnica | T-001 a T-023 (23) | 11,5 h | 2 | |
| E1 | Acceso seguro | T-024 a T-048 (25) | 12,5 h | 13 | |
| E2 | Plataforma y estructura | T-049 a T-071 (23) | 11,5 h | 11 | |
| E3 | Catálogo e inventario | T-072 a T-103 (32) | 16 h | 21 | |
| E4 | Compras, cálculo, promociones y cuota | T-104 a T-128 (25) | 12,5 h | 15 | |
| E5 | Caja y venta en efectivo | T-129 a T-165 (37) | 18,5 h | 38 | **H1 · Demo interna** |
| E6 | Cobros, clientes y crédito | T-166 a T-188 (23) | 11,5 h | 13 | |
| E7 | Facturación con ARCA (módulo opcional) | T-189 a T-213 (25) | 12,5 h | 16 | |
| E8 | Devoluciones y anulaciones | T-214 a T-226 (13) | 6,5 h | 12 | |
| E9 | Tiempo real, alertas y reportes | T-227 a T-237 (11) | 5,5 h | 10 | **H2 · Piloto sin facturación** |
| E10 | Periféricos y cierre | T-238 a T-250 (13) | 6,5 h | 18 | **H3 · Listo para producción** |
| | **Total** | **250** | **125 h** | **169** | |

---

## Entregas

### ☐ E0 — Base técnica

- **Objetivo:** que el proyecto compile, se pruebe y se verifique solo desde el primer día, con la arquitectura hexagonal protegida por reglas automáticas.
- **Tareas:** T-001 a T-023 (Fase 0).
- **RF cerrados:** RF-020, RF-021.
- **Demo en localhost:** `npm run dev` levanta todo, https://localhost:3000/salud responde, https://localhost:3000/docs muestra la API y las bases `pos_dev` y `pos_test` existen en el PostgreSQL local.
- **Criterio de salida:** `npm run verify` pasa en CI, y un import prohibido o un secreto en el código lo hacen fallar.

### ☐ E1 — Acceso seguro

- **Objetivo:** usuarios que ingresan, cambian de rol y se recuperan, con el aislamiento entre comercios y la matriz de permisos funcionando desde abajo.
- **Tareas:** T-024 a T-048 (Fase 1).
- **RF cerrados:** RF-005 a RF-012, RF-018, RF-019, RF-113, RF-141, RF-156.
- **Demo en localhost:** guion T-048. Login con cada rol demo, cambio de rol, bloqueo tras 5 intentos, recuperación de contraseña con el enlace que muestra la consola del backend, y 401 en cualquier ruta sin token.
- **Criterio de salida:** la prueba que recorre todas las rutas confirma que solo la lista blanca es pública, y la seguridad a nivel de fila devuelve 0 filas sin comercio fijado.

### ☐ E2 — Plataforma y estructura

- **Objetivo:** el SA da de alta comercios y el AC arma su estructura de sucursales, cajas, usuarios y parámetros.
- **Tareas:** T-049 a T-071 (Fases 2 y 3).
- **RF cerrados:** RF-013, RF-014, RF-015, RF-017, RF-022, RF-023, RF-026, RF-027, RF-134, RF-135, RF-163.
- **Demo en localhost:** el SA crea un comercio en /admin y le activa el módulo de facturación. Su AC recibe el correo, ingresa y arma dos sucursales con cajas y usuarios.
- **Criterio de salida:** las pruebas generadas de la matriz para plataforma y organización pasan, incluido el acceso cruzado entre comercios.

### ☐ E3 — Catálogo e inventario

- **Objetivo:** catálogo con precios calculados por lista y sucursal, y stock por sucursal con transferencias y mermas.
- **Tareas:** T-072 a T-103 (Fases 4 y 5).
- **RF cerrados:** RF-028, RF-029, RF-032, RF-033, RF-039, RF-040, RF-042 a RF-047, RF-049, RF-052, RF-119, RF-130, RF-131, RF-149, RF-150, RF-151, RF-159.
- **Demo en localhost:** guion T-103. El AC carga productos y listas, cambia un costo y ve el precio recalculado. El AS carga stock y transfiere entre sucursales con un faltante.
- **Criterio de salida:** la prueba de concurrencia de reservas (T-098) pasa 50 veces seguidas sin stock negativo.

### ☐ E4 — Compras, cálculo, promociones y cuota

- **Objetivo:** el motor de cálculo completo y probado contra casos esperados, más compras a proveedores, promociones y cuotas de descuento.
- **Tareas:** T-104 a T-128 (Fases 6, 7 y 8).
- **RF cerrados:** RF-034 a RF-038, RF-048, RF-063, RF-064, RF-069, RF-120, RF-122, RF-123, RF-124, RF-133, RF-142.
- **Demo en localhost:** desde /admin se importa un CSV de proveedor, se recibe una compra en una sucursal, se crea un 2x1 y se asigna la cuota del VO demo.
- **Criterio de salida:** las tablas de casos del motor (IVA incluido, prorrateo, recargos por fracción, combos, reintegro) y las pruebas por propiedades pasan. Las tablas fueron revisadas contra cálculos manuales.
- **Nota:** las Fases 6, 7 y 8 no dependen entre sí, así que se pueden repartir entre personas distintas.

### ☐ E5 — Caja y venta en efectivo · **H1: Demo interna**

- **Objetivo:** un día completo de caja con ventas en efectivo: turno, carrito con reservas, promociones, descuentos, traspasos, cortes X y Z ciegos y cierre forzado.
- **Tareas:** T-129 a T-165 (Fases 9 y 10).
- **RF cerrados:** RF-025, RF-030, RF-031, RF-050, RF-051, RF-053, RF-055 a RF-060, RF-065, RF-066, RF-067, RF-076 a RF-080, RF-089 a RF-092, RF-094 a RF-097, RF-099, RF-116, RF-117, RF-118, RF-121, RF-143, RF-146, RF-148, RF-153, RF-154.
- **Demo en localhost:** guion T-165. Apertura de turno, venta con 2x1 y descuento manual, dos navegadores compitiendo por la última unidad, expiración de un carrito abandonado, cortes X y Z, y el saldo teórico ausente de la pestaña de red del VO.
- **Criterio de salida:** la confirmación atómica (T-158) no deja cambios parciales ante una falla forzada, y la prueba de la última unidad (T-156) pasa 20 veces.
- **Hito H1:** el producto ya se puede mostrar a interesados con datos de demostración, aunque todavía no cobra con tarjeta ni factura.

### ☐ E6 — Cobros, clientes y crédito

- **Objetivo:** pagos mixtos con Mercado Pago, cuenta corriente con límite y cobros, y manejo seguro de rechazos y pagos con resultado incierto.
- **Tareas:** T-166 a T-188 (Fase 11).
- **RF cerrados:** RF-024, RF-070 a RF-075, RF-125, RF-126, RF-128, RF-129, RF-132, RF-144.
- **Demo en localhost:** con el simulador de pagos, se cobra efectivo + tarjeta con rechazo parcial, un pago queda "por verificar" y se resuelve, y se vende a crédito con un exceso autorizado por PIN.
- **Criterio de salida:** el webhook con firma inválida o con contenido falso no cambia ningún pago (T-183), y el límite de crédito resiste la prueba de concurrencia (T-173).
- **Requisito externo:** credenciales del sandbox de Mercado Pago y una terminal Point de prueba antes de T-180.

### ☐ E7 — Facturación con ARCA (módulo opcional)

- **Objetivo:** factura electrónica activable por comercio, con contingencia por CAEA, rechazos, reenvío y facturación posterior. Los comercios sin el módulo venden con ticket no fiscal.
- **Tareas:** T-189 a T-213 (Fase 12).
- **RF cerrados:** RF-100, RF-102 a RF-106, RF-145, RF-147, RF-155, RF-160, RF-161, RF-162, RF-164, RF-166, RF-167, RF-168.
- **Demo en localhost:** guion T-213. Con el simulador de ARCA caído, una venta se emite con CAEA, el servicio vuelve y la cola se informa. Un rechazo se corrige y se reenvía. Un comercio sin el módulo vende con ticket no fiscal.
- **Criterio de salida:** ninguna venta figura como emitida sin la aceptación del ente (T-196), y el certificado nunca sale de la base sin cifrar (T-193).
- **Requisitos externos:** confirmación del contador sobre el régimen CAEA antes de empezar (riesgo R-6 del plan) y un certificado de homologación de ARCA antes de T-206.

### ☐ E8 — Devoluciones y anulaciones

- **Objetivo:** anular dentro del turno y devolver desde cualquier sucursal, con reintegro proporcional, Nota de Crédito cuando corresponde e ítems "En Revisión".
- **Tareas:** T-214 a T-226 (Fase 13).
- **RF cerrados:** RF-081, RF-082, RF-084, RF-085, RF-086, RF-136 a RF-140, RF-152, RF-169.
- **Demo en localhost:** se anula una venta del turno con el PIN del AS, y se devuelve en la sucursal 2 un ítem vendido en la sucursal 1. El ítem queda en revisión y el AS lo reingresa.
- **Criterio de salida:** el reintegro coincide con las tablas de casos del motor, y dos devoluciones simultáneas nunca superan lo vendido (T-224).

### ☐ E9 — Tiempo real, alertas y reportes · **H2: Piloto sin facturación**

- **Objetivo:** stock en vivo entre los POS, alertas persistentes, ticket completo, informe diario, dashboards y auditoría comercial.
- **Tareas:** T-227 a T-237 (Fase 14).
- **RF cerrados:** RF-041, RF-061, RF-062, RF-098, RF-107, RF-109, RF-110, RF-111, RF-114, RF-127.
- **Demo en localhost:** con dos navegadores, una venta actualiza el stock del otro POS sin recargar. Al detener el backend, el POS muestra "sin conexión". El AC filtra el dashboard por sucursal.
- **Criterio de salida:** el cambio de stock llega en 2 segundos como máximo y nunca a otra sucursal (T-229).
- **Hito H2:** un comercio real puede usar el sistema **con el módulo de facturación inactivo**, cobrando con Mercado Pago. Todavía falta la impresión física del ticket, así que el piloto usa el ticket en pantalla o impreso desde el navegador.

### ☐ E10 — Periféricos y cierre · **H3: Listo para producción**

- **Objetivo:** impresora térmica y lector de códigos en el POS, revisión táctil en tablet, matriz de seguridad completa, pruebas punta a punta y trazabilidad estricta.
- **Tareas:** T-238 a T-250 (Fases 15 y 16).
- **RF cerrados:** RF-001 a RF-004, RF-016, RF-054, RF-068, RF-083, RF-087, RF-088, RF-093, RF-101, RF-108, RF-112, RF-115, RF-157, RF-158, RF-165.
- **Demo en localhost:** guion T-250. Un día completo de un comercio desde una base vacía, imprimiendo tickets en una impresora térmica y vendiendo desde una tablet Android.
- **Criterio de salida:** `npm run verify` en modo estricto con los 169 RF cubiertos por pruebas (T-248), las cuatro pruebas punta a punta pasan y la documentación de arquitectura está al día.
- **Requisitos externos:** una tablet Android con Chrome, una impresora térmica USB y un lector de códigos USB antes de T-238.

---

## Hitos

| Hito | Después de | Qué se puede hacer | Qué falta |
| :-- | :-- | :-- | :-- |
| **H1 · Demo interna** | E5 | Mostrar un día de caja completo con ventas en efectivo y datos de demostración. | Tarjetas, crédito, facturación, devoluciones, reportes y periféricos. |
| **H2 · Piloto sin facturación** | E9 | Operar un comercio real sin factura electrónica, cobrando con Mercado Pago, con devoluciones y dashboards. | Impresora térmica y lector, revisión táctil y el cierre de calidad de E10. |
| **H3 · Listo para producción** | E10 | Vender el SaaS, con o sin el módulo de facturación. | El despliegue en producción (ver abajo). |

---

## Requisitos externos y cuándo se necesitan

| Requisito | Necesario antes de | Responsable sugerido |
| :-- | :-- | :-- |
| PostgreSQL 16 instalado en cada equipo de desarrollo | T-003 (E0) | Cada desarrollador |
| Confirmación del contador sobre el régimen CAEA | Inicio de E7 | Responsable del producto |
| Credenciales del sandbox de Mercado Pago y una terminal Point de prueba | T-180 (E6) | Responsable del producto |
| Certificado de homologación de ARCA con un CUIT de prueba | T-206 (E7) | Contador o responsable del producto |
| Tablet Android con Chrome, impresora térmica USB y lector de códigos USB | T-238 (E10) | Equipo |

Conviene gestionarlos con al menos una entrega de anticipación. Si alguno se demora, la entrega puede avanzar con los simuladores y dejar pendientes solo las tareas de adaptador real (T-180 a T-184 y T-206 a T-208).

---

## Fuera de este roadmap

El roadmap termina con el sistema listo y verificado en localhost. **El despliegue en producción no está planificado todavía** y necesita su propio plan antes de H3. Como mínimo incluye: servidor o nube, HTTPS con certificado real (Const. 17), gestión de secretos y de la clave maestra de credenciales fiscales (AD-25), respaldos de PostgreSQL, monitoreo y el proceso de alta de comercios reales.

**El envío real de correos tampoco está planificado.** Hoy los correos de validación y recuperación solo se muestran en la consola del backend, y el backend no arranca en producción con ese adaptador. Antes de H2 (piloto con un comercio real) hace falta un adaptador de envío real, que es un adaptador nuevo para el puerto `EnvioDeCorreo`, sin cambios en el dominio.

---

## Seguimiento

- Cada entrega se marca como terminada (☐ → ☑) cuando su demo en localhost se ejecuta completa y su criterio de salida se cumple.
- El avance fino se sigue con los checkboxes de `tareas.md`, y la cobertura de RF con `trazabilidad.md`, que se genera automáticamente.
- Si una entrega cambia de alcance, se actualizan primero el spec y el plan, y después este roadmap y las tareas.
