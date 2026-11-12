# Plan técnico — Sistema POS Multi-Inquilino

**Versión:** 1.1 (agrega la revisión de experiencia de uso: RF-170 a RF-194)
**Fecha:** 2026-11-10
**Deriva de:** [constitution.md](constitution.md) (principios 1 a 17) y [spec.md](spec.md) v1.3 (RF-001 a RF-194, D-1 a D-99, S-1 a S-6).
**Integraciones definidas:** ARCA (factura electrónica, Argentina; módulo opcional por comercio), Mercado Pago (Point y QR). Equipos del POS: Chrome o Edge en Windows y Android.
**Naturaleza:** describe el **CÓMO** a nivel de arquitectura: módulos, modelo de datos, decisiones y estrategia de pruebas. No contiene código. Las tareas y el orden de implementación van en `tareas.md` y `roadmap.md`, y la tabla RF ↔ prueba en `trazabilidad.md`.

---

## 1. Vista general

### 1.1 Piezas del sistema

| Pieza | Tecnología (Const. 1) | Responsabilidad |
| :-- | :-- | :-- |
| **Backend** | Node.js + Express, TypeScript estricto | Toda la lógica de negocio, la autorización, la persistencia y las integraciones. Expone una API REST y un canal WebSocket. |
| **Frontend POS** | React + TypeScript | Pantalla de venta para tablet táctil. Presenta datos, captura entradas y opera los periféricos. Sin lógica de negocio (Const. 15). |
| **Frontend Administración** | React + TypeScript | Administración, dashboards y reportes para escritorio. Comparte base de componentes con el POS. |
| **Base de datos** | PostgreSQL | Única fuente de verdad (Const. 1). También guarda la cola fiscal, el outbox y los trabajos programados. |
| **Workers** | Mismo código del backend, otro proceso | Expiración de reservas, envío de la cola fiscal, verificación de pagos, escalamientos y recordatorios. |

Las dos aplicaciones de frontend pueden ser una sola aplicación React con dos áreas (POS y Administración), compiladas por separado. Lo que no se negocia es que ambas hablan con el backend **solo por endpoints** (Const. 15).

### 1.2 Estructura del repositorio

Monorepo con aplicaciones separadas (ver AD-01):

- `apps/backend`: núcleo hexagonal y adaptadores.
- `apps/frontend`: POS y Administración.
- `packages/contracts`: la especificación OpenAPI de la API y los tipos de DTO **generados** a partir de ella. Contiene solo tipos, nunca lógica.
- `docs/arquitectura`: documentación viva de la arquitectura (Const. 14): diagramas de contexto y de contenedores, catálogo de puertos y adaptadores, registros de decisiones (los AD de este plan) y guía para agregar un módulo.
- `sdd`: constitución, spec, plan, tareas, roadmap y trazabilidad.

### 1.3 Arquitectura hexagonal del backend (Const. 14)

Cada módulo de negocio tiene tres capas, con dependencias que solo apuntan hacia adentro:

| Capa | Contiene | Puede depender de |
| :-- | :-- | :-- |
| **Dominio** | Entidades, objetos de valor, reglas e invariantes, máquinas de estado, cálculos puros. | Nada externo: ni Express, ni PostgreSQL, ni librerías de integración. |
| **Aplicación** | Casos de uso (uno por acción de la matriz §5.18 del spec), puertos de entrada y de salida, verificación de permisos, límites transaccionales. | Dominio y puertos. |
| **Adaptadores** | Entrada: controladores HTTP, gateway WebSocket, workers. Salida: repositorios PostgreSQL, cliente del servicio fiscal, cliente de la pasarela de pagos, envío de correo, reloj, generador de identificadores. | Aplicación y librerías externas. |

**Entorno:** sin Docker. PostgreSQL 16 instalado localmente, con la base `pos_dev` para desarrollo y `pos_test` para pruebas. El rol `pos_owner` es dueño de las tablas y corre las migraciones. El rol `pos_app`, con el que corre la aplicación, no es dueño ni superusuario, así que la seguridad a nivel de fila siempre le aplica y no tiene permiso de DELETE.

**Correo:** por ahora el puerto `EnvioDeCorreo` solo tiene un adaptador de consola, para desarrollo. Antes de operar con comercios reales hace falta un adaptador de envío real (ver el roadmap).

**Puertos de salida principales**: repositorios por agregado, `UnidadDeTrabajo` (transacción), `ServicioFiscal`, `PasarelaDePagos`, `EnvioDeCorreo`, `PublicadorDeEventos` (tiempo real), `Reloj`, `HashDeSecretos`, `EmisorDeTokens`, `RegistroDeAuditoria`.

**Reglas que se verifican automáticamente** (ver §5.2): el dominio no importa librerías de infraestructura, un módulo no accede a las tablas de otro (se comunican por casos de uso o por eventos) y el frontend no importa nada del backend salvo `packages/contracts`.

### 1.4 Piezas transversales

Toda solicitud autenticada pasa por la misma secuencia, en el adaptador de entrada y en la capa de aplicación:

1. **Autenticación** (Const. 16): se valida el token de acceso. Solo están exentos `GET /salud`, el inicio de sesión, la validación de correo, la recuperación de contraseña y los webhooks de integraciones. Los webhooks se verifican por firma y solo disparan una consulta a la API del proveedor (AD-24).
2. **Contexto de seguridad**: se arma con el usuario, el comercio, el rol activo y las sucursales asignadas. **El comercio sale siempre del token, nunca de un parámetro de la solicitud** (Const. 3).
3. **Autorización**: el caso de uso consulta la política central de permisos, que es la matriz §5.18 hecha código (AD-12), y verifica el ámbito del recurso.
4. **Aislamiento en datos**: los repositorios filtran por comercio y PostgreSQL lo vuelve a aplicar con seguridad a nivel de fila (AD-03).
5. **Auditoría**: los casos de uso críticos escriben su registro dentro de la misma transacción (AD-10).
6. **Errores**: se traducen a respuestas sin detalles internos (Const. 17). Un recurso de otro comercio responde igual que uno inexistente (RF-002).

---

## 2. Módulos

Cada módulo es un contexto del dominio con sus propias tablas, casos de uso y puertos. La columna **RF** indica qué requisitos implementa como responsable principal. Algunos RF los toca más de un módulo, y se indica entre paréntesis.

### 2.1 Núcleo transversal: aislamiento y permisos

- **Responsabilidad:** contexto de seguridad, política de permisos (matriz §5.18), aislamiento por comercio y respuesta uniforme ante accesos ajenos.
- **RF:** RF-001, RF-002, RF-003, RF-004.
- **Notas:** el SA no tiene comercio en su contexto. Cualquier caso de uso comercial invocado por un SA se rechaza en la política antes de llegar a los datos (RF-003).

### 2.2 Identidad y acceso

- **Responsabilidad:** cuentas, validación de correo, inicio de sesión, tokens de acceso y de renovación, recuperación de contraseña, roles y rol activo, PIN y credenciales de autorización, bloqueo por intentos fallidos, autorizaciones in situ.
- **RF:** RF-005 a RF-012, RF-113, RF-141, RF-145, RF-156.
- **Casos de uso clave:** `IniciarSesion`, `RenovarToken`, `CerrarSesion`, `CambiarRolActivo`, `SolicitarRecuperacion`, `RestablecerContraseña`, `ReenviarValidacion`, `AutorizarOperacion` (valida el PIN, que el autorizante no sea el solicitante y que tenga el rol y el ámbito necesarios, y emite una autorización de un solo uso ligada a la operación: AD-13).

### 2.3 Plataforma (Super Administrador)

- **Responsabilidad:** alta, modificación, suspensión y baja de comercios, cuentas SA y primer AC, panel técnico, tickets de soporte.
- **RF:** RF-013 a RF-017, RF-134, RF-146, RF-147, RF-163, RF-164.
- **Módulos contratables:** el SA activa o desactiva por comercio los módulos opcionales del SaaS. Hoy el único es la facturación con ARCA (AD-26).
- **Notas:** la suspensión publica un evento que hace que Identidad revoque los tokens y que Ventas descarte los carritos (RF-146). La cola fiscal de un comercio suspendido se sigue enviando (RF-014).

### 2.4 Organización

- **Responsabilidad:** sucursales, cajas, usuarios del comercio y asignación de roles y sucursales, parámetros del comercio y métodos de pago.
- **RF:** RF-023 a RF-027, RF-135, RF-185.
- **Notas:** los atajos del POS son un parámetro del comercio (AD-28). El dominio valida cada cambio: sin teclas repetidas, sin teclas reservadas por el navegador y sin combinaciones que requieran las dos manos.

### 2.5 Catálogo y precios

- **Responsabilidad:** productos, categorías con tasa de IVA, combos, listas de precios con su regla, asignación de lista activa a cada sucursal, recálculo de precios ante cambios de costo, impresión de listas, imágenes de producto.
- **RF:** RF-028, RF-029, RF-032, RF-033, RF-049, RF-052, RF-119, RF-130, RF-131, RF-149, RF-159.
- **Notas:** el precio de lista de cada producto se guarda materializado por lista, y se recalcula cuando cambia el costo o la regla (RF-032). Así, fijar el precio en el carrito es una lectura simple (RF-030).

### 2.6 Proveedores y compras

- **Responsabilidad:** proveedores, importación de catálogo, compras a crédito, recepción en sucursal, pagos a proveedor.
- **RF:** RF-034 a RF-038, RF-133.
- **Notas:** la importación procesa fila por fila, aplica las válidas y genera un único registro de auditoría con el detalle (RF-035, D-49). La recepción de una compra le pide a Inventario el ingreso de stock.

### 2.7 Inventario

- **Responsabilidad:** saldos de stock por producto y sucursal en cuatro estados (disponible, reservado, en revisión, en tránsito), libro de movimientos, ajustes, umbrales y alertas, mermas, transferencias y revisión de devoluciones.
- **RF:** RF-039 a RF-047, RF-088, RF-150, RF-151, (RF-041 publica la alerta).
- **Notas:** es el **único** módulo que modifica los saldos de stock. Ventas, Compras y Devoluciones le piden operaciones atómicas (reservar, liberar, consumir, ingresar, pasar a revisión), siempre dentro de la transacción del caso de uso que las origina (AD-04).

### 2.8 Promociones

- **Responsabilidad:** reglas de promoción con vigencia, evaluación sobre un carrito y elección de la mejor promoción por ítem.
- **RF:** RF-048, RF-050, RF-143.
- **Notas:** la evaluación es una función pura del dominio. Recibe el carrito y las promociones vigentes y devuelve qué promoción se aplica a cada ítem (D-33). La promoción aplicada queda fijada en el ítem (RF-143).

### 2.9 Motor de cálculo

- **Responsabilidad:** cálculo puro y determinista de totales: precio fijado, promoción, descuento manual, prorrateo, fracciones por medio de pago con recargo o descuento, desglose de IVA incluido, IVA de combos, redondeo, vuelto. También calcula el reintegro proporcional de una devolución.
- **RF:** RF-069, RF-070, RF-071, RF-120 a RF-124, (RF-085 y RF-086 para el reintegro).
- **Notas:** no tiene tablas ni puertos. Es el núcleo de Const. 7 y la pieza con más pruebas (§5.1). El frontend nunca recalcula: cada cambio en el carrito devuelve los totales calculados por el backend (AD-15).

### 2.10 Ventas (POS)

- **Responsabilidad:** carritos y ventas, agregado y quita de ítems con reserva, precio y promoción fijados, expiración por inactividad, traspasos, estados comercial, de cobro y fiscal, confirmación atómica, alertas de sesión.
- **RF:** RF-030, RF-031, RF-051, RF-053 a RF-060, RF-062, RF-076 a RF-080, RF-116, RF-152, RF-153, RF-175 a RF-177, RF-179.
- **Notas:** la confirmación (RF-076) es el caso de uso más crítico. En **una sola transacción** consume las reservas, registra la venta y sus pagos, imputa a caja y a cuenta corriente, consume la cuota, escribe la auditoría y deja en el outbox el pedido de comprobante fiscal (AD-07). Agregar un producto sin venta activa crea la venta y reserva el ítem en la misma transacción (AD-31). La sección de productos del POS es una consulta de solo lectura: categorías y productos de la lista activa de la sucursal, ordenados por lo vendido en ella en los últimos 30 días (D-95).

### 2.11 Descuentos discrecionales (cuota)

- **Responsabilidad:** tope del comercio, cuota por VO y sucursal, saldo por fecha de jornada, consumo y autorización de excesos.
- **RF:** RF-063 a RF-067, RF-140, RF-142.

### 2.12 Cobros, clientes y crédito

- **Responsabilidad:** medios de pago, pagos con la pasarela (aprobado, rechazado, por verificar, revertido), clientes y su condición fiscal, límites de crédito, cuenta corriente, cobros de cuenta corriente y recibos.
- **RF:** RF-068, RF-072 a RF-075, RF-125 a RF-129, RF-132, RF-144.
- **Notas:** cada intento de pago electrónico lleva una clave de idempotencia. El worker de verificación consulta a la pasarela los pagos por verificar (AD-14).
- **Integración:** el adaptador de Mercado Pago implementa el puerto `PasarelaDePagos` para terminales Point (una terminal asociada a cada caja) y para QR dinámico. Usa la clave de idempotencia como referencia externa del pago. Las notificaciones de Mercado Pago llegan por webhook firmado y solo disparan la consulta del estado real a su API (AD-24). Si la notificación no llega, el worker consulta igual.

### 2.13 Devoluciones y anulaciones

- **Responsabilidad:** anulación total dentro del turno, devoluciones parciales en cualquier sucursal, control de cantidades devolvibles y del plazo, reintegro proporcional, Nota de Crédito, ítems "En Revisión".
- **RF:** RF-081 a RF-087, RF-136 a RF-139, RF-169.

### 2.14 Caja

- **Responsabilidad:** jornadas, turnos, saldo inicial, movimientos manuales, imputaciones de ventas, reintegros y cobros, saldo teórico, cortes X y Z ciegos, arqueo, cierre forzado.
- **RF:** RF-089 a RF-099, RF-112, RF-115, RF-117, RF-118, RF-154.
- **Notas:** el saldo teórico se calcula y se guarda en el backend, pero **nunca** aparece en un DTO dirigido a un VO. Las respuestas de rechazo que dependen del teórico solo se le devuelven al autorizante (AD-20).

### 2.15 Facturación fiscal

- **Responsabilidad:** comprobantes y Notas de Crédito, tipo de comprobante según el comprador, numeración por punto de venta, envío y reintentos, contingencia, rechazos, corrección y reenvío, plazos y escalamiento.
- **RF:** RF-100 a RF-106, RF-155, RF-160 a RF-162, RF-165 a RF-168, (RF-139 junto con Devoluciones).
- **Módulo opcional:** todo el módulo se activa por comercio (AD-26). Sin el módulo, la confirmación de una venta no escribe el pedido fiscal, el estado fiscal queda en "no se factura", los workers de envío y de CAEA ignoran al comercio y los endpoints fiscales responden como acción no permitida. Con el módulo, la política del AC y la decisión del VO definen si cada venta se factura (RF-166, RF-167), y una venta sin factura se puede facturar después dentro del plazo (RF-168).
- **Notas:** el adaptador de ARCA implementa el puerto `ServicioFiscal` y clasifica cada respuesta como aceptación, rechazo o no disponibilidad (D-41). Para las pruebas existe un simulador con inyección de fallas (§5.1).
- **Integración con ARCA:** autenticación con el certificado de cada comercio (servicio de autenticación de ARCA) y emisión por el web service de factura electrónica, que devuelve el CAE. Tipo de comprobante (A, B o C) según la condición fiscal del emisor y del comprador (RF-155). Cada caja es un punto de venta. Un worker pide el CAEA de cada quincena por adelantado (RF-160). En contingencia se emite con CAEA y la cola informa después los comprobantes emitidos (RF-101, AD-23). Sin CAEA vigente se usa el camino de RF-161.

### 2.16 Auditoría y retención

- **Responsabilidad:** auditoría comercial por comercio y auditoría técnica de plataforma, ambas inmutables, bajas lógicas y control de dependencias antes de una baja.
- **RF:** RF-018 a RF-022, RF-114, RF-148.

### 2.17 Alertas y tiempo real

- **Responsabilidad:** alertas persistentes por destinatario (stock mínimo, arqueo, rechazo fiscal, escalamiento, reintegro pendiente, transferencia con faltante), recordatorios y difusión en tiempo real de cambios de stock por sucursal.
- **RF:** RF-061, RF-189, RF-190, (consume eventos de RF-041, RF-045, RF-089, RF-098, RF-103, RF-105, RF-115, RF-127).
- **Notas:** el canal en vivo envía también el resumen de alertas del usuario (cantidad y severidad más alta), para el indicador de todas las pantallas.

### 2.18 Reportes y dashboards

- **Responsabilidad:** contenido del ticket, informe diario por fecha de jornada, dashboard estratégico (AC) y operativo (AS) con las métricas de D-50.
- **RF:** RF-107, RF-109, RF-110, RF-111, RF-186, RF-187.
- **Notas:** son consultas de solo lectura sobre vistas que siempre filtran por comercio y sucursal. No escriben. El backend calcula los indicadores, la comparación con el período anterior de igual duración y las series de las gráficas (D-97); el frontend solo las dibuja (AD-29).

### 2.19 Frontend y periféricos

- **Responsabilidad:** interfaz táctil del POS e interfaz de escritorio de la administración. Adaptadores de periféricos en el navegador: impresora, lector de códigos y terminal de pago.
- **RF:** RF-108, RF-157, RF-158, RF-178, RF-180 a RF-184, RF-188, RF-191 a RF-194, (presentación de RF-027, RF-054, RF-060, RF-062).
- **Equipos soportados:** Chrome o Edge en Windows y Android. El lector de códigos funciona como teclado. La impresora térmica se maneja por WebUSB o WebSerial y, si el equipo no lo permite, por el agente local.
- **Notas:** los periféricos son un adaptador **del frontend** porque están conectados al equipo del usuario (AD-16). El frontend imprime documentos que el backend ya armó y le informa el resultado. Una falla de impresión nunca cambia el estado de la venta (RF-108).
- **Sistema visual (AD-30):** un único tema con los cuatro niveles de severidad de D-99 en modo claro y oscuro, y componentes compartidos para estados, puntos de atención, encabezado y panel de detalle de segundo nivel (D-96). Una regla de lint impide colores y estados armados a mano en las pantallas.
- **Atajos (AD-28):** el frontend traduce teclas en acciones con el mapa que le da el backend. No se disparan mientras se escribe en un campo, durante una lectura del lector de códigos ni en el diálogo de PIN. Los dígitos del teclado numérico quedan para importes, cantidades y búsquedas; las acciones usan sus teclas de operación, Enter y las teclas vecinas.

### 2.20 Carga desde Excel

- **Responsabilidad:** plantillas descargables y carga de productos, proveedores y precios desde archivos .xlsx, con vista previa y confirmación.
- **RF:** RF-170 a RF-174.
- **Notas:** el archivo se lee y valida en el backend con un puerto `SpreadsheetReader` (AD-27). Se procesa dos veces: la vista previa valida y no escribe, y la aplicación vuelve a validar el mismo archivo antes de escribir, así nada cambia entre lo anunciado y lo aplicado. Cada fila pasa por los mismos casos de uso que la carga manual (Catálogo, Proveedores, Precios), y la carga queda en la auditoría como una sola operación (D-49). No modifica stock, saldos ni lo que no figura en el archivo.

---

## 3. Modelo de datos

### 3.1 Convenciones

- **Aislamiento:** toda tabla con datos comerciales tiene `tenant_id` no nulo y una política de seguridad a nivel de fila que la filtra por el comercio de la sesión de base de datos (AD-03). Las tablas de plataforma (comercios, cuentas SA, auditoría técnica) no tienen esa política, pero solo las usa el módulo de Plataforma.
- **Identificadores:** UUID generados por el backend.
- **Bajas lógicas** (Const. 5): las entidades tienen `is_active`, `desactivado_en` y `desactivado_por`. El usuario de base de datos de la aplicación **no tiene permiso de DELETE** sobre ninguna tabla, ni de UPDATE sobre las tablas de auditoría (AD-18).
- **Dinero:** `NUMERIC(14,2)` en la base y un tipo decimal en el dominio (AD-08). Las tasas y porcentajes se guardan como `NUMERIC(7,4)`.
- **Cantidades:** `NUMERIC(12,3)`, para admitir productos fraccionables.
- **Concurrencia:** las filas que se modifican en paralelo llevan una columna `version` para el control optimista. Los saldos críticos usan además actualizaciones condicionales (AD-04).
- **Tiempos:** `timestamptz` en UTC. La fecha de jornada se calcula con la zona horaria del comercio (RF-118).

### 3.2 Plataforma e identidad

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `comercio` | nombre, CUIT, moneda, zona_horaria, estado (activo, suspendido, baja), tiene_operaciones, modulo_facturacion (activo o inactivo, con quién y cuándo lo cambió) | La moneda no se puede cambiar si `tiene_operaciones` (verificado en el dominio y con un disparador) | RF-013, RF-014, RF-134, RF-147, RF-163, RF-164 |
| `usuario` | tenant_id (nulo para el SA), email, email_validado, hash_contraseña, ultimo_rol_activo, bloqueado_hasta, is_active | Email único. Un SA no tiene tenant_id | RF-005, RF-006, RF-012, RF-015, RF-156 |
| `usuario_rol` | usuario_id, rol (SA, AC, AS, VO), sucursal_id (para AS y VO) | El rol SA es incompatible con cualquier otro rol (RF-012) | RF-010, RF-011, RF-026 |
| `credencial_autorizacion` | usuario_id, hash_pin, id_credencial_fisica, bloqueado_hasta | Una por usuario con rol AS o AC | RF-113, RF-141, RF-145 |
| `token_renovacion` | usuario_id, hash_token, emitido_en, vence_en, revocado_en | Se revoca al cerrar sesión, al suspender el comercio y al vencer la inactividad | RF-009, RF-146, Const. 16 y 17 |
| `token_un_uso` | usuario_id, tipo (validación, recuperación), hash_token, vence_en, usado_en | Un solo uso | RF-006 a RF-008 |
| `intento_acceso` | identificador (email o usuario de PIN), resultado, ip, momento | Base del bloqueo y del límite de frecuencia | RF-145, Const. 17 |
| `ticket_soporte` | tenant_id, autor_id, asunto, estado, mensajes | Sin datos comerciales adjuntos | RF-017 |
| `auditoria_tecnica` | momento, actor_id, tipo_evento, tenant_id (opcional, solo como referencia), detalle técnico | Solo inserción | RF-002, RF-022, RF-145 |

### 3.3 Organización y parámetros

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `sucursal` | tenant_id, nombre, dirección, lista_precio_activa_id, is_active | Una sola lista activa por sucursal | RF-023, RF-119 |
| `caja` | tenant_id, sucursal_id, nombre, punto_venta_fiscal, is_active | Punto de venta único por comercio | RF-024, RF-025 |
| `parametro_comercio` | tenant_id, inactividad_carrito, inactividad_sesion, plazo_fiscal, plazo_devolucion, tolerancia_arqueo, politica_facturacion (siempre, opcional con factura, opcional sin factura), plazo_facturacion_posterior | Valores dentro de los márgenes de plataforma. La política solo aplica con el módulo activo | RF-135, RF-098, RF-166, RF-168 |
| `metodo_pago` | tenant_id, nombre, tipo (efectivo, electrónico, cuenta corriente), recargo_pct (positivo es recargo, negativo es descuento), is_active | | RF-068, RF-069, RF-135 |
| `atajos_comercio` | tenant_id, mapa (acción → tecla), actualizado_en, actualizado_por | Una fila por comercio. Mapa nulo: rige la distribución por defecto; restablecer lo pone en nulo y no borra nada | RF-185 |

### 3.4 Catálogo y precios

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `categoria` | tenant_id, nombre, tasa_iva | | RF-029 |
| `producto` | tenant_id, nombre, codigo_barras, categoria_id, costo, tipo (simple, combo), imagen, is_active | Código de barras único entre los productos activos del comercio (índice parcial) | RF-130, RF-131, RF-159 |
| `combo_componente` | combo_id, producto_id, cantidad | Un componente no puede ser un combo | RF-049, RF-052 |
| `lista_precio` | tenant_id, nombre, regla (fijo, porcentaje sobre costo, por grupo), parámetros de la regla | | RF-028 |
| `precio_lista` | lista_id, producto_id, precio_final (con IVA), calculado_en | Materializado, se recalcula ante cambios de costo o de regla | RF-030, RF-032, RF-033 |
| `historial_precio` | lista_id, producto_id, precio_anterior, precio_nuevo, causa, momento | Solo inserción | RF-018, RF-032 |

### 3.5 Proveedores y compras

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `proveedor` | tenant_id, razón social, CUIT, contacto, saldo_adeudado, is_active | | RF-034, RF-148 |
| `importacion_catalogo` | tenant_id, proveedor_id, filas_ok, filas_error (con motivo), momento | | RF-035 |
| `compra` / `compra_item` | tenant_id, proveedor_id, sucursal_destino_id, estado (pendiente de recepción, recibida), ítems con cantidad y costo | | RF-036 |
| `recepcion_compra_item` | compra_item_id, cantidad_recibida, diferencia | Cantidad recibida no mayor que la comprada | RF-133 |
| `pago_proveedor` | tenant_id, proveedor_id, monto, método, comprobante_ref, confirmado_exceso | | RF-037, RF-038 |

### 3.6 Inventario

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `inventario` | tenant_id, sucursal_id, producto_id, disponible, reservado, en_revision, en_transito_salida, umbral_minimo, alerta_activa, version | Restricción CHECK: los cuatro saldos ≥ 0. Clave única (sucursal, producto) | RF-039 a RF-043, RF-057, RF-152 |
| `movimiento_stock` | tenant_id, sucursal_id, producto_id, tipo (ajuste, merma, reserva, liberación, venta, transferencia, recepción, devolución, reingreso), estado_origen, estado_destino, cantidad, referencia, motivo, usuario_id | Solo inserción. Es el libro mayor de stock (AD-09) | RF-018, RF-042, RF-088 |
| `transferencia` / `transferencia_item` | tenant_id, sucursal_origen_id, sucursal_destino_id, estado (enviada, recibida, rechazada, parcial, cancelada), cantidades enviada, recibida, rechazada y faltante | Origen y destino del mismo comercio (RF-047). Recibida + rechazada + faltante = enviada | RF-044 a RF-047, RF-150, RF-151 |

El stock en tránsito vive en la sucursal de origen (`en_transito_salida`) hasta la recepción. Así ninguna sucursal lo ve como disponible (S-4).

### 3.7 Promociones y cuota

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `promocion` | tenant_id, tipo (NxM, porcentaje, precio por cantidad), alcance (producto, categoría), parámetros, vigente_desde, vigente_hasta, sucursales (opcional), is_active | Tipos cerrados (AD-17) | RF-048, RF-050 |
| `tope_cuota` | tenant_id, pct_max_venta, monto_max | Uno por comercio | RF-063, RF-142 |
| `cuota_vo` | tenant_id, usuario_id, sucursal_id, pct_max_venta, monto | No supera el tope | RF-064, RF-142 |
| `saldo_cuota` | tenant_id, usuario_id, sucursal_id, fecha_jornada, saldo, version | Única por (usuario, sucursal, fecha). Saldo ≥ 0 | RF-065 a RF-067, RF-140 |

### 3.8 Ventas, pagos y autorizaciones

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `venta` | tenant_id, sucursal_id, caja_id, turno_id, vendedor_id, cliente_id, numero_ticket, estado_comercial, estado_cobro, estado_fiscal, se_factura, factura_decidida_por, subtotal, descuento_promos, descuento_manual, total, ultima_actividad, motivo_descarte, version | Tres columnas de estado independientes (RF-153). Si `se_factura` es falso, el estado fiscal es "no se factura". Número de ticket único por comercio | RF-053, RF-059, RF-076, RF-116, RF-153, RF-165, RF-167 |
| `venta_item` | venta_id, producto_id, combo_padre_id, cantidad, precio_fijado, promocion_id, descuento_promo, descuento_manual_prorrateado, tasa_iva, iva_incluido, importe_final, cantidad_devuelta | Cantidad devuelta no mayor que la vendida | RF-030, RF-031, RF-051, RF-084, RF-121, RF-124, RF-143 |
| `traspaso` | venta_id, emisor_id, receptor_id, estado (pendiente, aceptado, rechazado, vencido), vence_en | Receptor de la misma sucursal y con turno abierto | RF-077 a RF-079 |
| `pago` | venta_id (o cobro_cc_id), metodo_pago_id, fraccion, recargo, monto_abonado, vuelto, estado (pendiente, aprobado, rechazado, por_verificar, revertido), clave_idempotencia, referencia_pasarela | Clave de idempotencia única | RF-068 a RF-071, RF-075, RF-125 a RF-127 |
| `autorizacion` | tenant_id, tipo (descuento, crédito, anulación, reembolso, retiro, pago por verificar, cierre forzado), solicitante_id, autorizante_id, operacion_ref, usada_en | solicitante ≠ autorizante (CHECK). Un solo uso | RF-066, RF-074, RF-081, RF-092, RF-113, RF-141 |

### 3.9 Clientes y cuenta corriente

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `cliente` | tenant_id, razón social, documento, condición fiscal, tiene_cuenta_corriente, limite_credito, saldo, version, is_active | Saldo ≥ 0 | RF-072, RF-132, RF-144, RF-155 |
| `movimiento_cuenta_corriente` | tenant_id, cliente_id, tipo (venta, cobro, devolución, anulación), monto, referencia, autorizacion_id | Solo inserción | RF-073, RF-074, RF-086, RF-128, RF-129 |
| `recibo` | tenant_id, cliente_id, turno_id, monto, pagos | | RF-128 |

### 3.10 Devoluciones y anulaciones

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `devolucion` / `devolucion_item` | tenant_id, venta_original_id, sucursal_id (la que recibe), turno_id, ítems con cantidad e importe prorrateado, estado de revisión por ítem (en revisión, reingresado, merma), autorizacion_id | | RF-083 a RF-088, RF-137, RF-138 |
| `reintegro` | devolucion_id, metodo_pago_id, monto, recargo_revertido | Proporcional a los pagos originales | RF-085, RF-086 |
| `anulacion` | venta_id, turno_id, autorizacion_id, momento | Solo para el turno de la venta, total y sin devoluciones previas | RF-081, RF-082, RF-136 |

### 3.11 Caja

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `jornada` | tenant_id, caja_id, fecha_jornada, abierta_en, estado (abierta, cerrada), declarado_z, teorico_z, diferencia_z, cerrada_por | Una sola jornada abierta por caja (índice único parcial) | RF-095 a RF-097, RF-118 |
| `turno` | tenant_id, caja_id, jornada_id, vo_id, saldo_inicial, diferencia_inicial, declarado, teorico, diferencia, resultado (faltante, sobrante, cuadrado), forzado_por, estado | Un turno abierto por caja y uno por VO (índices únicos parciales). No se puede modificar una vez cerrado | RF-089, RF-090, RF-094, RF-099, RF-115, RF-154 |
| `movimiento_caja` | tenant_id, turno_id, tipo (venta, ingreso, retiro, reintegro, cobro de cuenta corriente, anulación), metodo_pago_id, monto, motivo, autorizacion_id | Solo inserción. El teórico de efectivo es la suma de los movimientos en efectivo más el saldo inicial | RF-091, RF-092, RF-112, RF-128, RF-137 |

### 3.12 Facturación

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `comprobante` | tenant_id, tipo (factura, NC), clase (según condición fiscal), venta_id o devolucion_id, original_id (para NC), punto_venta, numero, contingencia, estado (pendiente, enviado, aceptado, rechazado, bloqueado), motivo_rechazo, intentos, proximo_intento, plazo_vence | Número único por punto de venta | RF-100 a RF-106, RF-139, RF-155 |
| `intento_envio_fiscal` | comprobante_id, momento, resultado (aceptado, rechazado, no disponible), respuesta resumida | Solo inserción | RF-101, RF-102 |
| `credencial_fiscal` | tenant_id, CUIT, certificado_cifrado, clave_cifrada, vence_en, cargado_por | Nunca se devuelve en una respuesta. Se cifra con una clave que no está en la base (AD-25) | RF-162 |
| `caea` | tenant_id, período (quincena), código, vigente_desde, vigente_hasta, estado (vigente, vencido, informado) | Uno por comercio y período | RF-101, RF-160 |

El `comprobante` registra además la modalidad (CAE en línea, CAEA, no fiscal), el código obtenido (CAE o CAEA) y, para los emitidos con CAEA, si ya se informaron a ARCA.

### 3.13 Auditoría, alertas e infraestructura

| Tabla | Campos principales | Restricciones clave | RF |
| :-- | :-- | :-- | :-- |
| `auditoria_comercial` | tenant_id, sucursal_id, usuario_id, rol_activo, momento, acción, entidad, entidad_id, estado_anterior, estado_posterior, autorizacion_id | Solo inserción. Sin permisos de UPDATE ni DELETE | RF-018, RF-019, RF-114 |
| `alerta` | tenant_id, sucursal_id, destinatario (rol o usuario), tipo, severidad, persistente, referencia, creada_en, resuelta_en, proximo_recordatorio | Las críticas no se pueden descartar hasta resolverse | RF-041, RF-098, RF-103, RF-105, RF-127 |
| `outbox` | tenant_id, tipo_evento, payload, creado_en, procesado_en, intentos | Se escribe en la misma transacción que el cambio | RF-076, RF-100, RF-061 |
| `trabajo_programado` | tipo, clave, ejecutar_en, bloqueado_por, estado | Se toma con bloqueo que omite filas tomadas (AD-19) | RF-059, RF-079, RF-105, RF-126 |

---

## 4. Decisiones de arquitectura

Cada decisión indica qué se eligió, la alternativa descartada y por qué. Se copian a `docs/arquitectura/decisiones` como registros individuales (Const. 14).

| # | Decisión | Alternativa descartada | Por qué | RF / Const. |
| :-- | :-- | :-- | :-- | :-- |
| **AD-01** | Monorepo con backend y frontend como aplicaciones separadas, y un paquete de contratos generado desde OpenAPI que contiene solo tipos. | Repositorios separados, o compartir código de dominio entre backend y frontend. | El monorepo mantiene sincronizados el contrato y sus consumidores en un mismo cambio. Compartir dominio pondría lógica de negocio en el frontend. | Const. 15 |
| **AD-02** | Monolito modular hexagonal: un backend desplegable, con módulos de dominio aislados. | Microservicios por contexto. | La confirmación de una venta toca stock, caja, cuota, crédito y la cola fiscal en una sola transacción (RF-076). Repartirlo entre servicios exigiría sagas y consistencia eventual justo donde Const. 6 pide atomicidad. Los límites de módulo permiten separar servicios más adelante si hace falta. | Const. 6, 14 |
| **AD-03** | Una base compartida, con `tenant_id` en cada tabla, filtrado obligatorio en los repositorios y seguridad a nivel de fila de PostgreSQL como segunda barrera. El comercio de la sesión de base de datos se fija por transacción desde el token. | Un esquema o una base por comercio. | El aislamiento queda garantizado en el servidor dos veces: código y motor. Un esquema por comercio complica las migraciones y los reportes de plataforma sin agregar seguridad real. | RF-001, RF-002, Const. 3 |
| **AD-04** | Reservas de stock con actualización condicional atómica dentro de la transacción: solo se descuenta el disponible si alcanza, y si no se afecta ninguna fila se rechaza. Con restricciones CHECK de saldo ≥ 0 como red de seguridad. Lo mismo para el saldo de cuota, el límite de crédito y la cantidad devolvible. | Bloqueos distribuidos en un almacén externo (por ejemplo, Redis), o leer, validar y escribir sin bloqueo. | La base es la fuente de verdad (Const. 1), y la actualización condicional es atómica sin infraestructura extra. Leer y después escribir permite vender dos veces la misma unidad. | RF-055 a RF-057, RF-152, Const. 6 |
| **AD-05** | La expiración de carritos y de traspasos la hace un worker del servidor, que busca ventas en curso con `ultima_actividad` vencida y las descarta con su motivo. | Que el navegador avise al cerrarse, o un vencimiento automático en un almacén externo. | El navegador puede cerrarse o desconectarse sin avisar (D-2, D-47). La expiración tiene que ocurrir igual y quedar registrada (RF-116). | RF-059, RF-079, RF-116 |
| **AD-06** | Tiempo real por WebSocket autenticado con el mismo token, con un canal por comercio y sucursal. El servidor decide a qué canal se suscribe cada conexión. Los eventos salen del outbox después del commit. | Consulta periódica desde el frontend. | Con 2 segundos como máximo (D-50), la consulta periódica genera carga constante en todos los POS. Que el servidor asigne el canal impide que un cliente escuche otra sucursal (RF-061). | RF-061, Const. 3 |
| **AD-07** | Patrón outbox transaccional: el pedido de comprobante fiscal y los eventos de tiempo real se escriben en la misma transacción que la venta y los envía un worker. | Llamar al servicio fiscal o publicar el evento justo después del commit. | Si el proceso cae entre el commit y la llamada, la venta queda sin comprobante (D-21). Con el outbox, ninguna venta confirmada pierde su pedido fiscal. | RF-076, RF-100, D-21 |
| **AD-08** | Dinero en `NUMERIC(14,2)` en la base y un tipo decimal en el dominio, con redondeo explícito según D-17. | Números de punto flotante, o centavos enteros. | El punto flotante introduce errores de redondeo. Los centavos enteros complican los porcentajes, el prorrateo y el IVA hacia atrás. El decimal hace los cálculos reproducibles y verificables. | RF-120 a RF-123, Const. 7 |
| **AD-09** | Saldos de stock materializados más un libro de movimientos inmutable. Cada cambio de saldo escribe su movimiento en la misma transacción. | Solo saldos, sin historial, o reconstruir los saldos desde los eventos. | Solo saldos pierde la trazabilidad (Const. 5). Reconstruir desde eventos vuelve lentas las validaciones de disponibilidad, que se hacen en cada agregado al carrito. | RF-018, RF-039, RF-042 |
| **AD-10** | Auditoría en tablas de solo inserción, escritas en la misma transacción que la operación, con el usuario de base de datos de la aplicación sin permisos de modificar ni borrar. Comercial y técnica en tablas separadas. | Registros en archivos o en un servicio externo de logs. | Si la operación se confirma, su auditoría también. El motor impide la manipulación aunque haya un error en el código. La separación física hace cumplir D-9. | RF-018 a RF-022, RF-114 |
| **AD-11** | Token de acceso JWT de vida corta, más un token de renovación opaco, guardado con hash y revocable. | Solo un JWT de vida larga, o sesiones guardadas solo en el servidor. | Un JWT largo no se puede revocar: suspender un comercio no surtiría efecto inmediato (RF-146). El JWT corto evita consultar la base en cada solicitud, y la renovación cubre el vencimiento por inactividad y la revocación. | RF-009, RF-146, Const. 16, 17 |
| **AD-12** | La matriz de permisos §5.18 es una tabla declarativa en la capa de aplicación (acción → roles y ámbito), que consulta cada caso de uso. Las pruebas de permisos se generan desde esa misma tabla. | Verificaciones repartidas en controladores o middleware por ruta. | Una sola fuente de verdad, revisable contra el spec, y pruebas que cubren la matriz completa sin escribir cada caso a mano. Lo que no está en la matriz queda denegado. | RF-004, Const. 4, 10 |
| **AD-13** | La autorización in situ es un objeto de dominio: el autorizante ingresa su PIN y el backend emite una autorización de un solo uso, ligada al tipo de operación, a la operación concreta y al solicitante. El caso de uso la consume. | Mandar el PIN como un campo más de la operación, o un indicador "autorizado" enviado por el frontend. | Impide reutilizar una autorización, hace cumplir que solicitante y autorizante sean distintos (Const. 13) y deja la evidencia en la auditoría. Un indicador enviado por el cliente sería falsificable. | RF-066, RF-074, RF-081, RF-092, RF-113, RF-141 |
| **AD-14** | Pagos electrónicos con clave de idempotencia por intento, estado "por verificar" ante timeout y un worker de verificación contra la pasarela. | Reintentar el cobro ante timeout. | Reintentar sin saber si el primer intento se aprobó genera cobros duplicados. La idempotencia y la verificación resuelven la incertidumbre sin falsear la venta (Const. 11). | RF-075, RF-125 a RF-127 |
| **AD-15** | El backend devuelve el carrito con sus totales ya calculados después de cada cambio. El frontend solo muestra. | Calcular totales en el frontend para que responda más rápido. | Const. 7 y 15 prohíben la lógica de negocio en la interfaz. Duplicar el cálculo genera diferencias entre lo que se muestra y lo que se cobra. La latencia es aceptable porque el POS siempre está conectado. | RF-060, RF-121, Const. 7, 15 |
| **AD-16** | Los periféricos se manejan con un adaptador en el frontend (APIs nativas del navegador y, si no alcanzan, un agente local) que solo imprime o lee. El documento a imprimir lo arma el backend, y el resultado de la impresión se le informa al backend. | Que el backend hable directamente con las impresoras. | Los periféricos están conectados al equipo del usuario y el backend no los alcanza. Como el frontend solo transporta un documento ya calculado, no tiene lógica de negocio. | RF-054, RF-108, RF-158, Const. 11 |
| **AD-17** | Promociones con un conjunto cerrado de tipos (NxM, porcentaje por producto o categoría, precio especial por cantidad), cada uno con su evaluador en el dominio. | Un motor genérico de reglas o un lenguaje propio de condiciones. | Los tipos cerrados son verificables con casos de prueba concretos y alcanzan para lo que pide la v8.5. Un motor genérico es difícil de probar y de explicar al cliente. Agregar un tipo nuevo es una extensión localizada. | RF-048, RF-050 |
| **AD-18** | Bajas lógicas con `is_active` y quién y cuándo, sin permiso de DELETE para la aplicación. Las dependencias que impiden una baja se validan en el dominio. | Mover lo dado de baja a tablas de archivo. | El archivo rompe referencias y complica el historial. Sin permiso de DELETE, Const. 5 se cumple aunque haya un error en el código. | RF-020, RF-021, RF-148 |
| **AD-19** | Trabajos en segundo plano con una tabla de trabajos en PostgreSQL, tomados con bloqueo que omite filas ya tomadas, en procesos worker del mismo código. | Una cola externa (RabbitMQ, Redis). | Const. 1 hace de PostgreSQL la fuente de verdad. Una cola externa agrega otra pieza que puede quedar desincronizada con la base. El volumen esperado no la justifica. | RF-059, RF-102, RF-105, RF-126 |
| **AD-20** | DTO distintos según el rol de quien recibe. Los de un VO nunca incluyen el saldo teórico, y los rechazos que dependen del teórico usan un mensaje genérico para el VO, con el detalle solo para el autorizante. | Enviar los datos completos y ocultarlos en la interfaz. | Ocultar en la interfaz no protege (Const. 3): el teórico se vería en la red. RF-112 exige que el VO no pueda deducirlo por ninguna vía. | RF-092, RF-093, RF-112, RF-137 |
| **AD-21** | El contrato de la API es una especificación OpenAPI versionada, escrita antes de implementar cada endpoint. Las respuestas se validan contra ella en las pruebas. | Documentar la API después, a partir del código. | El contrato es el único punto de contacto entre frontend y backend (Const. 15). Escribirlo primero permite trabajar en paralelo y detectar incompatibilidades en CI. | Const. 14, 15 |
| **AD-22** | Endpoints públicos limitados a una lista blanca explícita (salud, inicio de sesión, validación de correo, recuperación de contraseña, webhooks de integraciones), con límite de frecuencia. Cualquier ruta nueva queda protegida por defecto. | Proteger cada ruta a mano. | Proteger por defecto evita olvidos. Una prueba recorre todas las rutas registradas y verifica que las que no están en la lista blanca rechacen la solicitud sin token. | Const. 16, 17, RF-145 |
| **AD-23** | Contingencia fiscal con el régimen CAEA de ARCA: código pedido por adelantado cada quincena, comprobantes emitidos con CAEA durante la caída e informados después. | Entregar un ticket provisorio y pedir el CAE al volver el servicio. | Con ARCA, un comprobante sin código de autorización no es válido: con el ticket provisorio el cliente se iría sin factura. El ticket no fiscal queda solo como último recurso, si no hay un CAEA vigente (RF-161). | RF-101, RF-160, RF-161, D-56 |
| **AD-24** | Webhooks de Mercado Pago en un endpoint público, verificados con la firma del proveedor y con límite de frecuencia. La notificación nunca se toma como verdadera: solo dispara la consulta del pago a la API, y el worker de verificación sigue consultando si la notificación no llega. | Consultar solo periódicamente, sin webhooks. | Los webhooks reducen la demora entre el pago en la terminal y la confirmación de la venta. Verificar la firma y volver a consultar evita que una notificación falsa confirme un pago. Requirió ampliar Const. 16. | RF-075, RF-126, Const. 16 |
| **AD-25** | El certificado y la clave fiscal de cada comercio se guardan cifrados en la base, con una clave maestra que vive fuera de la base y del repositorio (en un gestor de secretos o en una variable de entorno protegida). Ningún endpoint los devuelve. | Guardarlos en texto plano o en archivos del servidor. | Un acceso a la base o a un respaldo no expone las credenciales fiscales de los comercios. Cumple Const. 17 sobre secretos. | RF-162, D-55, Const. 17 |
| **AD-26** | Los módulos opcionales del SaaS (hoy, la facturación) son capacidades activables por comercio, guardadas en el comercio. La política de permisos las consulta junto con la matriz §5.18: una acción de un módulo inactivo se rechaza. Los casos de uso afectados (confirmar venta, anular, devolver) preguntan por la capacidad a través de un puerto, sin depender del módulo fiscal. | Versiones o despliegues distintos según el plan, o ramas de código por cliente. | Una sola base de código y un solo despliegue sirven a todos los planes. Activar o desactivar es un cambio de datos auditado, no un despliegue. El dominio de Ventas no queda acoplado a la facturación. | RF-163 a RF-169, D-57 |
| **AD-27** | Los archivos Excel se leen en el backend, con una librería mantenida y sin vulnerabilidades conocidas, detrás del puerto `SpreadsheetReader`. Solo .xlsx; se rechazan los que traen macros, los formatos anteriores y los que superan 5 MB o 5.000 filas. Las fórmulas se toman por su valor calculado y nunca se evalúan. | Leer el archivo en el navegador y mandar JSON al backend. | La validación tiene que ocurrir en el servidor (Const. 17) y la del navegador se puede saltear. El puerto deja cambiar de librería sin tocar los casos de uso. | RF-170 a RF-174, Const. 14, 17 |
| **AD-28** | Atajos como parámetro del comercio: el catálogo de acciones y la distribución por defecto viven en el dominio del backend, que también valida cada cambio del AC. El frontend recibe el mapa y solo traduce teclas en acciones. | Atajos fijos en el frontend. | El AC los configura (D-94) y las reglas de validación (dos manos, reservadas, repetidas) son de negocio (Const. 15). | RF-181 a RF-185 |
| **AD-29** | Gráficas con la librería del mismo ecosistema que la interfaz, alimentadas con series que calcula el backend. | Calcular agregados en el navegador a partir de datos crudos, o una librería de gráficas con estilos propios. | Los cálculos van en el backend (Const. 7 y 15), y la misma librería toma los colores del tema en modo claro y oscuro. | RF-186, RF-187 |
| **AD-30** | Sistema visual único: el tema define la paleta y los niveles de severidad, y las pantallas usan componentes compartidos (estado, punto de atención, encabezado, panel de detalle). Una regla de lint prohíbe colores literales fuera del tema. | Estilos decididos en cada pantalla. | Es la única forma de sostener la coherencia entre roles (RF-193) a medida que crecen las pantallas. | RF-188, RF-192, RF-193 |
| **AD-31** | Agregar un producto sin venta activa crea la venta y la reserva en una sola operación del backend. | Que el frontend cree la venta y después agregue el ítem. | Dos llamadas pueden dejar ventas vacías si la segunda falla, y suman una espera más a cada venta. | RF-176 |

---

## 5. Estrategia de pruebas

### 5.1 Niveles

| Nivel | Qué cubre | Herramientas (orientativas) | Criterios del spec |
| :-- | :-- | :-- | :-- |
| **Unitarias de dominio** | Motor de cálculo, promociones, cuota, arqueo, prorrateo, reintegro, máquinas de estado de venta, turno, jornada, transferencia y comprobante. Sin base de datos ni red. | Vitest o Jest | 6, 11 |
| **Tablas de casos esperados** | Para cada regla de Const. 7, una tabla de entradas y resultados esperados calculados a mano y revisados por negocio: precio por regla, IVA incluido, orden de aplicación, mejor promoción, prorrateo, redondeo, pago mixto con recargo, IVA de combo, devolución proporcional, devolución de crédito ya pagado, arqueo. | Pruebas parametrizadas | 6 |
| **Pruebas por propiedades** | Invariantes con datos generados al azar: el stock nunca queda negativo, la suma de fracciones iguala el total, el redondeo nunca deja diferencias, una devolución total devuelve exactamente lo cobrado. | fast-check | 4, 6 |
| **Casos de uso** | Cada caso de uso con puertos simulados en memoria: permisos, ámbito, autorizaciones, auditoría escrita, eventos emitidos. | Vitest o Jest con dobles | 1, 3, 9 |
| **Integración con PostgreSQL** | Repositorios, restricciones CHECK e índices únicos parciales, seguridad a nivel de fila, ausencia de permisos de DELETE y de UPDATE en auditoría, outbox, trabajos programados. Contra la base local `pos_test`, recreada con las migraciones al inicio de cada corrida y vaciada entre pruebas. | Vitest sobre PostgreSQL local (sin Docker) | 2, 9 |
| **Concurrencia** | N clientes en paralelo contra M < N unidades. Lo mismo para el saldo de cuota, el límite de crédito, la cantidad devolvible, la apertura de turno y la recepción de una transferencia. Se repite muchas veces para detectar carreras. | Clientes HTTP en paralelo sobre la base real | 4 |
| **API y contrato** | Cada endpoint contra la especificación OpenAPI. Recorrido automático de todas las rutas registradas: sin token responden 401, salvo la lista blanca. Mensajes de error sin detalles internos. Límite de frecuencia. | Supertest y un validador de OpenAPI | 2, 3, Const. 16, 17 |
| **Matriz de seguridad** | Generada desde la tabla de permisos (AD-12): cada acción × cada rol × dentro y fuera de su ámbito. Para cada tipo de recurso del criterio 2: lectura y escritura desde otro comercio, y el SA sobre datos comerciales. Todas rechazadas y registradas, salvo las permitidas. | Pruebas generadas | 2, 3, Const. 10 |
| **Integraciones con inyección de fallas** | Simuladores de ARCA y de Mercado Pago que se pueden programar para responder bien, rechazar, demorarse, no responder o aprobar tarde. Caída simulada del proceso entre la confirmación y el envío fiscal. Caída y recuperación de ARCA con emisión por CAEA y cola informada en orden por punto de venta. Caída sin CAEA vigente. Webhook con firma inválida (se rechaza) y webhook con contenido falso (no cambia nada, porque se consulta la API). | Simuladores propios detrás de los puertos | 7, 10 |
| **Módulo de facturación** | Cada flujo de venta, anulación y devolución corre dos veces: con el módulo activo y con el módulo inactivo. Sin el módulo: no se escribe ningún pedido fiscal, no se piden CAEA y los endpoints fiscales se rechazan. Con el módulo: los tres modos de la política, la factura A obligatoria, la facturación posterior dentro y fuera de plazo, la devolución bloqueada tras desactivar y la desactivación rechazada con pendientes. | Pruebas parametrizadas por capacidad | 2, 7 |
| **Homologación** | Pruebas manuales y automatizadas contra el entorno de homologación de ARCA y el sandbox de Mercado Pago antes de cada versión. No corren en cada integración continua. | Entornos de prueba de los proveedores | 7, 10 |
| **Tiempo real** | Un cambio de stock llega a los demás POS de la sucursal en 2 segundos como máximo y nunca a otra sucursal ni a otro comercio. | Clientes WebSocket de prueba | 2, 12 |
| **Frontend** | Componentes y flujos con la API simulada desde el contrato. Validaciones de formato. | Vitest y Testing Library | 1 |
| **Teclado y una mano** | Ventas completas solo con el teclado, con la distribución por defecto y sin ningún clic antes del primer producto. La prueba verifica que ningún atajo usado combine teclas de las dos mitades del teclado. | Playwright | 14 |
| **Accesibilidad** | Contraste de los niveles de severidad y nombres accesibles en las pantallas principales de los cuatro roles, en modo claro y oscuro. | Playwright con axe | 14 |
| **Carga desde Excel** | Archivos de muestra generados en las pruebas: válidos, con filas inválidas, con macros, con fórmulas, en formato viejo, dañados y por encima de los límites. | Vitest con archivos generados | 1, 9 |
| **Punta a punta** | Flujos completos en navegador: venta con pago mixto, cierre ciego (verificando que el teórico no aparezca ni en pantalla ni en el tráfico de red del VO), devolución en otra sucursal, contingencia fiscal, cierre forzado. | Playwright | 5, 7, 8 |

### 5.2 Verificaciones estáticas y de arquitectura (Const. 8, 14, 15, 17)

- Formato, lint y verificación de tipos estricta en backend, frontend y contratos. Bloquean la integración.
- **Reglas de dependencias** verificadas en CI: el dominio no importa Express, ni el cliente de PostgreSQL, ni librerías de integración. Un módulo no importa el adaptador de persistencia de otro. El frontend solo importa `packages/contracts` del resto del repositorio.
- **Sin lógica de negocio en el frontend:** además de la regla de dependencias, la revisión de código verifica que el frontend no calcule importes, IVA, descuentos ni saldos. Cualquier excepción necesita aprobación previa (Const. 15).
- Auditoría de dependencias con vulnerabilidades conocidas y búsqueda de secretos en el repositorio.
- La documentación de arquitectura se revisa en cada cambio que agrega o modifica un puerto o un adaptador.

### 5.3 Trazabilidad (criterio 1)

- Cada prueba de aceptación se etiqueta con los RF que verifica.
- Un script recorre las etiquetas, genera `trazabilidad.md` (RF → pruebas) y **falla en CI si algún RF de RF-001 a RF-194 queda sin prueba**.
- Las pruebas de la matriz de seguridad se etiquetan con RF-001 a RF-004 y con el RF de la acción probada.

### 5.4 Correspondencia con los criterios de finalización del spec

| Criterio | Cómo se demuestra |
| :-- | :-- |
| 1. Trazabilidad completa | Script de trazabilidad en CI (§5.3). |
| 2. Aislamiento probado | Matriz de seguridad generada, integración con seguridad a nivel de fila, pruebas de canales de tiempo real. |
| 3. Segregación de funciones | Casos de uso de autorización: el solicitante con rol AS o AC intenta autorizarse a sí mismo. Restricción CHECK en `autorizacion`. |
| 4. Concurrencia | Pruebas de concurrencia sobre la base real y pruebas por propiedades. |
| 5. Expiración de reservas | Worker de expiración con reloj simulado: carritos vencidos, con pagos aprobados o por verificar, y traspasos vencidos. |
| 6. Cálculos verificados | Tablas de casos esperados y pruebas por propiedades del motor de cálculo. |
| 7. Contingencia fiscal | Simulador fiscal con caída, recuperación, rechazo, Nota de Crédito en espera y vencimiento de plazo. |
| 8. Cierres | Casos de uso de caja y punta a punta del cierre ciego, inspeccionando el tráfico de red. |
| 9. Retención | Integración: la aplicación no puede borrar ni modificar la auditoría. Recorrido de rutas: no existe ningún endpoint de borrado físico. |
| 10. Fallas de integraciones | Simuladores de pasarela y fiscal con inyección de fallas, y caída simulada entre la confirmación y el envío. |
| 11. Supuestos respetados | Casos de uso de precio y promoción fijados, y exceso de crédito con autorización. |
| 12. Tiempo real | Prueba de latencia con clientes WebSocket. |
| 13. Calidad | Verificaciones estáticas de §5.2 en CI. |
| 14. Experiencia de uso | Punta a punta solo con el teclado, pruebas de accesibilidad y regla de lint del sistema visual. |

---

## 6. Cobertura de RF por módulo

| Módulo | RF |
| :-- | :-- |
| 2.1 Núcleo transversal | RF-001, RF-002, RF-003, RF-004 |
| 2.2 Identidad y acceso | RF-005, RF-006, RF-007, RF-008, RF-009, RF-010, RF-011, RF-012, RF-113, RF-141, RF-145, RF-156 |
| 2.3 Plataforma | RF-013, RF-014, RF-015, RF-016, RF-017, RF-134, RF-146, RF-147, RF-163, RF-164 |
| 2.4 Organización | RF-023, RF-024, RF-025, RF-026, RF-027, RF-135, RF-185 |
| 2.5 Catálogo y precios | RF-028, RF-029, RF-032, RF-033, RF-049, RF-052, RF-119, RF-130, RF-131, RF-149, RF-159 |
| 2.6 Proveedores y compras | RF-034, RF-035, RF-036, RF-037, RF-038, RF-133 |
| 2.7 Inventario | RF-039, RF-040, RF-041, RF-042, RF-043, RF-044, RF-045, RF-046, RF-047, RF-088, RF-150, RF-151 |
| 2.8 Promociones | RF-048, RF-050, RF-143 |
| 2.9 Motor de cálculo | RF-069, RF-070, RF-071, RF-120, RF-121, RF-122, RF-123, RF-124 |
| 2.10 Ventas | RF-030, RF-031, RF-051, RF-053, RF-054, RF-055, RF-056, RF-057, RF-058, RF-059, RF-060, RF-062, RF-076, RF-077, RF-078, RF-079, RF-080, RF-116, RF-152, RF-153, RF-175, RF-176, RF-177, RF-179 |
| 2.11 Cuota | RF-063, RF-064, RF-065, RF-066, RF-067, RF-140, RF-142 |
| 2.12 Cobros, clientes y crédito | RF-068, RF-072, RF-073, RF-074, RF-075, RF-125, RF-126, RF-127, RF-128, RF-129, RF-132, RF-144 |
| 2.13 Devoluciones y anulaciones | RF-081, RF-082, RF-083, RF-084, RF-085, RF-086, RF-087, RF-136, RF-137, RF-138, RF-139, RF-169 |
| 2.14 Caja | RF-089, RF-090, RF-091, RF-092, RF-093, RF-094, RF-095, RF-096, RF-097, RF-098, RF-099, RF-112, RF-115, RF-117, RF-118, RF-154 |
| 2.15 Facturación fiscal | RF-100, RF-101, RF-102, RF-103, RF-104, RF-105, RF-106, RF-155, RF-160, RF-161, RF-162, RF-165, RF-166, RF-167, RF-168 |
| 2.16 Auditoría y retención | RF-018, RF-019, RF-020, RF-021, RF-022, RF-114, RF-148 |
| 2.17 Alertas y tiempo real | RF-061, RF-189, RF-190 |
| 2.18 Reportes y dashboards | RF-107, RF-109, RF-110, RF-111, RF-186, RF-187 |
| 2.19 Frontend y periféricos | RF-108, RF-157, RF-158, RF-178, RF-180, RF-181, RF-182, RF-183, RF-184, RF-188, RF-191, RF-192, RF-193, RF-194 |
| 2.20 Carga desde Excel | RF-170, RF-171, RF-172, RF-173, RF-174 |

Cada uno de los 194 RF tiene exactamente un módulo responsable.

---

## 7. Riesgos y puntos abiertos

| # | Riesgo o punto abierto | Impacto | Mitigación |
| :-- | :-- | :-- | :-- |
| R-1 | ~~Criterios D-40 a D-54 pendientes de validación.~~ **Resuelto el 2026-10-31:** validados, y D-43 completado con 5 intentos y 15 minutos. | — | — |
| R-2 | ~~Proveedor fiscal sin definir.~~ **Resuelto:** ARCA, con contingencia por CAEA (D-55, D-56, AD-23). | — | — |
| R-3 | ~~Pasarela sin definir.~~ **Resuelto:** Mercado Pago Point y QR, con webhooks firmados (AD-24). | — | — |
| R-4 | ~~Navegadores sin definir.~~ **Resuelto:** Chrome o Edge en Windows y Android. | — | — |
| R-5 | La seguridad a nivel de fila exige fijar el comercio en cada transacción. Un error ahí rompe el aislamiento o bloquea todo. | Alto. | La unidad de trabajo lo fija siempre. Pruebas de integración específicas, y el usuario de base de datos de la aplicación no puede saltearse esa seguridad. |
| R-6 | El comercio tiene que estar habilitado para usar el régimen CAEA, y sus plazos para informar los comprobantes deben respetarse. | Si no puede usarlo, la contingencia cae siempre en el ticket no fiscal (RF-161). | Confirmarlo con el contador del proyecto antes de implementar el módulo fiscal. Validar el flujo en homologación de ARCA. |
| R-7 | Cada caja necesita una terminal Point asociada en Mercado Pago, y la API de terminales puede cambiar. | Configuración adicional por caja y mantenimiento del adaptador. | El adaptador encapsula la API. La asociación terminal ↔ caja va en los parámetros de la caja. Pruebas en el sandbox antes de cada versión. |
| R-8 | El certificado de ARCA de cada comercio vence periódicamente. | Si vence, el comercio no puede facturar en línea. | Alerta anticipada al AC (RF-162), y el panel del AC muestra la fecha de vencimiento. |
| R-5 | La seguridad a nivel de fila exige fijar el comercio en cada transacción. Un error ahí rompe el aislamiento o bloquea todo. | Alto. | La unidad de trabajo lo fija siempre. Pruebas de integración específicas, y el usuario de base de datos de la aplicación no puede saltearse esa seguridad. |
| R-9 | La librería que lee Excel puede traer vulnerabilidades, y un archivo armado a propósito puede intentar explotarlas. | Alto: el archivo viene del usuario. | Versión fija y `npm audit` en CI, límites de tamaño y filas antes de leer, sin macros ni evaluación de fórmulas, y lectura en el backend detrás de un puerto (AD-27). |
| R-10 | Las notebooks no tienen teclado numérico, y el navegador o el sistema operativo reservan algunas teclas. | La distribución por defecto no sirve en todos los equipos. | El AC adapta los atajos de su comercio (RF-185) y el dominio rechaza las teclas reservadas. |
| R-11 | Los dígitos y el Enter del teclado numérico también los usan el lector de códigos y la carga de importes. | Un atajo podría dispararse en medio de una lectura o de un importe. | Los dígitos nunca son atajos, los atajos no corren en campos de texto y la ráfaga del lector se detecta por su velocidad (RF-184). |
| R-12 | Rediseñar todas las pantallas puede romper las pruebas de interfaz existentes. | Retrabajo y regresiones. | Se migra pantalla por pantalla manteniendo verdes sus pruebas, que buscan por rol y nombre accesible y no por estilos. |
