# Documento de Especificación Funcional (v8.5 Master)

**Proyecto:** Sistema de Punto de Venta (POS) Multi-Inquilino

---

## 1. Resumen del Proyecto

El sistema es una solución integral de punto de venta (POS) web bajo un modelo multi-inquilino (_multi-tenant_). Permite que múltiples comercios coexistan de forma independiente bajo un administrador global. Cada comercio gestiona sus propias sucursales, inventarios, listas de precios, promociones, facturación fiscal, proveedores, cuentas por pagar y cajas operativas.

Destaca por su cálculo dinámico de precios, gestión concurrente de stock (reservas en tiempo real), auditoría estricta, motor de reportes (Dashboards), gestión de turnos de caja (Cortes X/Z), módulo de contingencia fiscal y un diseño de roles flexible que permite la operación táctica y estratégica desde una misma plataforma mediante selección rápida de perfil (_Role-Switching_).

---

## 2. Glosario de Términos

- **Tenant (Inquilino):** Cada comercio o empresa dada de alta en el sistema. Entidad legal principal cuyos datos están completamente aislados de los demás comercios.
- **Cierre Ciego:** Proceso al finalizar el turno o jornada donde el cajero declara el dinero físico en caja sin que el sistema le informe previamente el saldo teórico ("deber ser").
- **Corte X (Cierre de Turno):** Cierre operativo parcial que permite a un vendedor rendir su caja al finalizar su turno, dejando la terminal disponible para que otro usuario abra un nuevo turno en el mismo día.
- **Corte Z (Cierre de Jornada):** Cierre definitivo del día a nivel fiscal y comercial en una caja. Consolida todos los turnos (Cortes X) del día.
- **Arqueo:** Diferencia resultante entre el saldo teórico del sistema y el saldo físico declarado por el usuario en el cierre (Faltante, Sobrante o Cuadrado).
- **Combo:** Agrupación comercial de productos que se vende a un precio único, pero que descuenta dinámicamente el stock de sus componentes individuales.
- **En Revisión:** Estado temporal de aislamiento de stock para mercadería devuelta por clientes, impidiendo su venta hasta validación administrativa.
- **Soft Delete:** Borrado lógico de datos mediante banderas de estado (`is_active`), manteniendo retención perpetua de registros e historial de auditoría.

---

## 3. Estructura y Actores del Sistema

### 3.1 Jerarquía Visual e Institucional

1. **Comercio (Tenant):** Entidad legal principal.
2. **Sucursal:** Sede física perteneciente a un comercio.
3. **Caja:** Terminales de venta operativas dentro de una sucursal.

_(El Front-End representará esta jerarquía visualmente en formato cascada: Comercio > Sucursales > Cajas)._

### 3.2 Matriz de Roles y Cambio Rápido (Role-Switching)

- **Super Administrador (SA):** Gestión global de comercios, mantenimiento del sistema y soporte técnico. Sin acceso a datos comerciales ni financieros de los tenants.
- **Administrador de Comercio (AC):** Gestión estratégica (listas de precios, métodos de pago, promociones globales, proveedores, cuentas por pagar, gestión de usuarios/cuotas y dashboard consolidado del tenant).
- **Administrador de Sucursal (AS):** Gestión operativa local (control de inventario, mermas, transferencias inter-sucursal, límites de crédito de clientes, autorización de devoluciones, aprobaciones in-situ y dashboard de sucursal).
- **Vendedor / Operador (VO):** Ejecución de ventas en POS, atención al público, cobros mixtos, movimiento de dinero manual, traspaso de ventas y cierre ciego de caja (Cortes X/Z).

_(El sistema cuenta con un **Selector de Perfil Rápido en la UI** para usuarios que poseen múltiples roles asignados, permitiéndoles intercambiar vistas y permisos en caliente sin cerrar sesión)._

---

## 4. Requisitos Funcionales (RF)

| Código    | Módulo / Área   | Descripción del Requisito                                                                                                                                                                                                                  |
| :-------- | :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RF-01** | Super Admin     | **Gestión de Comercios:** Alta, modificación y suspensión/baja lógica (_Soft Delete_) de tenants.                                                                                                                                          |
| **RF-02** | Super Admin     | **Cuentas Globales y Soporte:** Creación de usuarios SA, primeros AC (con validación obligatoria vía email) y Dashboard Técnico (alertas de servidores, errores técnicos y resolución de tickets).                                         |
| **RF-03** | Super Admin     | **Auditoría Global:** Registro centralizado e inmutable de toda actividad crítica del sistema.                                                                                                                                             |
| **RF-04** | Admin. Comercio | **Estructura Organizativa:** Creación y gestión de sucursales, creación/asignación de cajas y gestión de usuarios con asignación de roles y cuotas de descuento.                                                                           |
| **RF-05** | Admin. Comercio | **Gestión de Precios y Costos:** Creación de listas de precios dinámicas calculadas sobre el costo (Fijo/%/Grupo) y asignación de tasas de IVA.                                                                                            |
| **RF-06** | Admin. Comercio | **Proveedores y Cuentas por Pagar:** Registro de empresas proveedoras, carga automática de productos/costos y gestión financiera de la deuda adquirida (registro de saldos adeudados y emisión de pagos).                                  |
| **RF-07** | Admin. Sucursal | **Control de Inventario y Mermas:** ABM de stock local y alertas de stock mínimo. Registro de bajas por rotura, vencimiento o pérdida mediante movimiento no transaccional (para no afectar balances financieros).                         |
| **RF-08** | Admin. Sucursal | **Transferencias de Stock:** Módulo para emitir, enviar y recibir remitos de mercadería entre distintas sucursales del mismo comercio.                                                                                                     |
| **RF-09** | Comercio / Suc. | **Gestión de Promociones y Combos:** Creación de reglas de descuento automáticas y "Combos" (agrupación de productos con precio único que descuentan stock de sus componentes individuales).                                               |
| **RF-10** | Admin. Sucursal | **Límites de Crédito:** Configuración de límites de monto máximo para clientes con cuenta corriente ("ventas en espera" o préstamos).                                                                                                      |
| **RF-11** | Transversal     | **Selector de Rol Rápido:** Botón en la interfaz de usuario para intercambiar vistas y permisos en caliente entre roles autorizados sin necesidad de cerrar sesión.                                                                        |
| **RF-12** | Admin / Suc.    | **Dashboards Especializados:** Dashboard Estratégico (AC) con métricas y alertas consolidadas de todas las sucursales filtrables por período; y Dashboard Operativo (AS) restringido a la sucursal asignada.                               |
| **RF-13** | Vendedor (POS)  | **Interfaz de Venta:** Pantalla táctil/responsive con Subtotal, Descuentos, Total Final, reserva concurrente de stock en tiempo real y detección/resaltado automático de promociones (ej. 2x1).                                            |
| **RF-14** | Vendedor (POS)  | **Pagos Mixtos Unimoneda:** Cobro dividido en una sola moneda utilizando múltiples métodos de pago (ej. Efectivo + Tarjeta), aplicando recargos o descuentos específicos únicamente a la fracción del monto correspondiente a cada método. |
| **RF-15** | Vendedor (POS)  | **Traspaso de Ventas:** Opción de enviar una venta en curso a la sesión activa de otro vendedor para su cobro o finalización.                                                                                                              |
| **RF-16** | Vendedor (POS)  | **Alertas de Sesión:** Al intentar cerrar sesión con la caja abierta o con ventas en curso, el sistema alerta y fuerza el cierre de caja o el traspaso de las ventas.                                                                      |
| **RF-17** | Vendedor (POS)  | **Gestión de Devoluciones:** Módulo para escanear/ingresar N° de ticket, seleccionar ítems totales o parciales, generar Nota de Crédito/Reintegro y enviar los productos al estado aislado "En Revisión".                                  |
| **RF-18** | Vendedor (POS)  | **Control de Caja y Turnos:** Registros manuales de ingresos y retiros de efectivo, y ejecución de Cierre Ciego declarando el dinero físico especificando si es Corte X (turno) o Corte Z (jornada).                                       |
| **RF-19** | Sistema         | **Facturación y Contingencia Fiscal:** Integración con servicios/web services (ej. AFIP) o pasarelas de pago para comprobantes fiscales. En caso de caídas del servicio fiscal, encola el comprobante y emite ticket en modo contingencia. |
| **RF-20** | Sistema / Rep.  | **Impresión y Reportes Diarios:** Emisión de tickets detallados (sucursal, vendedor, ítems, desglose de promociones aplicadas) e informes diarios de venta por sucursal.                                                                   |

---

## 5. Casos de Uso del Sistema (UC)

### 5.1 Super Administrador (SA)

| Código       | Nombre del Caso de Uso       | Descripción Corta                                                                                   |
| :----------- | :--------------------------- | :-------------------------------------------------------------------------------------------------- |
| **UC-SA-01** | Gestionar Tenants            | Alta, edición, y suspensión (_Soft Delete_) de los comercios registrados.                           |
| **UC-SA-02** | Gestionar Cuentas Globales   | Creación de otros usuarios SA y primeros Administradores de Comercio (AC) con validación por email. |
| **UC-SA-03** | Consultar Auditoría Global   | Visualización del registro centralizado de logs de actividad crítica de todo el sistema.            |
| **UC-SA-04** | Monitorear Dashboard Técnico | Revisión de alertas de servidores, conexiones de hardware, periféricos y errores técnicos.          |
| **UC-SA-05** | Gestionar Tickets            | Lectura, seguimiento y respuesta a los tickets de soporte enviados por los AC o AS.                 |

### 5.2 Administrador de Comercio (AC)

| Código       | Nombre del Caso de Uso      | Descripción Corta                                                                                   |
| :----------- | :-------------------------- | :-------------------------------------------------------------------------------------------------- |
| **UC-AC-01** | Gestionar Sucursales        | Alta, baja y modificación de las sedes físicas del comercio.                                        |
| **UC-AC-02** | Gestionar Cajas             | Creación de terminales de venta operativas y su asignación a sucursales.                            |
| **UC-AC-03** | Gestionar Usuarios          | Creación de usuarios, asignación de roles jerárquicos y cuotas de descuento pre-aprobadas.          |
| **UC-AC-04** | Gestionar Precios y Costos  | Creación de reglas de cálculo de precios (Fijo/%/Grupo), asignación de IVA e impresiones de listas. |
| **UC-AC-05** | Gestionar Proveedores       | ABM de proveedores y carga/importación automática de catálogos de productos y costos.               |
| **UC-AC-06** | Gestionar Cuentas por Pagar | Registro de compras a crédito / deuda adquirida con proveedores y emisión de órdenes de pago.       |
| **UC-AC-07** | Dashboard Estratégico       | Monitoreo de métricas comerciales consolidadas y alertas de todas las sucursales del tenant.        |
| **UC-AC-08** | Gestionar Promociones       | Creación de reglas de descuento automáticas y configuración de Combos de productos.                 |
| **UC-AC-09** | Emitir Ticket Soporte       | Envío de consultas o reporte de fallas técnicas de forma asincrónica al SA.                         |

### 5.3 Administrador de Sucursal (AS)

| Código       | Nombre del Caso de Uso     | Descripción Corta                                                                                                |
| :----------- | :------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **UC-AS-01** | Dashboard Operativo        | Monitoreo de métricas exclusivas, ventas diarias y alertas de stock de su sucursal.                              |
| **UC-AS-02** | Gestionar Inventario Local | ABM de stock local y configuración de umbrales de alerta de stock mínimo.                                        |
| **UC-AS-03** | Registrar Mermas           | Baja de productos por rotura, vencimiento o pérdida (movimiento no transaccional).                               |
| **UC-AS-04** | Gestionar Transferencias   | Emisión, envío y recepción de remitos de mercadería entre sucursales del mismo comercio.                         |
| **UC-AS-05** | Configurar Límite Crédito  | Establecimiento de límites máximos para ventas a cuenta corriente de clientes.                                   |
| **UC-AS-06** | Autorizar Devoluciones     | Inspección de ítems devueltos "En Revisión" para autorizar su reingreso a stock disponible o derivación a merma. |
| **UC-AS-07** | Autorizar Acciones POS     | Aprobación presencial in-situ de anulaciones de ventas facturadas o reembolsos mediante PIN/Credencial.          |

### 5.4 Vendedor / Operador (VO)

| Código       | Nombre del Caso de Uso   | Descripción Corta                                                                                                        |
| :----------- | :----------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **UC-VO-01** | Gestionar Sesión Caja    | Inicio y fin de turno con validación de estado de caja y verificación de pendientes.                                     |
| **UC-VO-02** | Armar Carrito de Venta   | Búsqueda de productos, reserva de stock concurrente en tiempo real y aplicación automática de promociones.               |
| **UC-VO-03** | Registrar Pago Mixto     | Cobro dividido en múltiples métodos de pago calculando recargos/descuentos sobre cada fracción abonada.                  |
| **UC-VO-04** | Procesar Venta a Crédito | Asignación de venta como "pendiente de pago" a la cuenta corriente del cliente (sujeto a su límite de crédito).          |
| **UC-VO-05** | Traspasar Venta          | Envío de una venta abierta en curso hacia la sesión de otro vendedor para continuar o cobrar.                            |
| **UC-VO-06** | Aplicar Descuento        | Aplicación manual de descuentos discrecionales usando la cuota pre-aprobada asignada por el AS.                          |
| **UC-VO-07** | Anular Venta             | Cancelación parcial o total de ticket en cobro (requiere aprobación in-situ con PIN vía UC-AS-07) y liberación de stock. |
| **UC-VO-08** | Iniciar Devolución       | Lectura/ingreso de N° de ticket para generar Nota de Crédito/Reintegro y enviar ítems a "En Revisión".                   |
| **UC-VO-09** | Movimiento de Caja       | Ingreso o retiro manual de efectivo de la caja registradora con justificación.                                           |
| **UC-VO-10** | Emitir Comprobante       | Generación e impresión de ticket fiscal (o emisión bajo contingencia si cae el servicio).                                |
| **UC-VO-11** | Cierre Ciego de Caja     | Declaración del saldo físico contado a ciegas seleccionando si corresponde a Corte X (turno) o Corte Z (jornada).        |

### 5.5 Transversales (Múltiples Roles)

| Código       | Nombre del Caso de Uso | Descripción Corta                                                                                     |
| :----------- | :--------------------- | :---------------------------------------------------------------------------------------------------- |
| **UC-TR-01** | Autenticación          | Ingreso seguro al sistema mediante correo validado y contraseña encriptada.                           |
| **UC-TR-02** | Recuperar Contraseña   | Flujo de recuperación mediante envío de token temporal por correo electrónico para blanqueo de clave. |
| **UC-TR-03** | Intercambio de Rol     | Uso del selector rápido en la UI para intercambiar vistas/permisos sin desloguearse.                  |

---

## 6. Reglas de Negocio (RN)

| Código    | Descripción de la Regla                                                                                                                                                                                                                                                                                                      |
| :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RN-01** | **Segregación Estricta:** Los datos, inventarios, facturas y clientes de un Comercio (Tenant) son absolutamente invisibles para otros comercios y para el Super Administrador.                                                                                                                                               |
| **RN-02** | **Retención Perpetua de Datos (Soft Delete):** Queda prohibida la eliminación física (_Hard Delete_) de registros relacionales o transaccionales. Toda baja se procesa como un borrado lógico (_Soft Delete_) cambiando el estado de la entidad.                                                                             |
| **RN-03** | **Reserva Concurrente:** El primer vendedor en agregar una unidad de producto al POS bloquea/reserva dinámicamente esa unidad en tiempo real. Si la venta se cancela o se descarta el carrito, la reserva se libera al instante.                                                                                             |
| **RN-04** | **Cálculo Dinámico de Precios e IVA:** El precio final de un ítem se liquida en el momento exacto de la venta según la lista de precios activa. El IVA se desglosa o aplica automáticamente según la tasa asignada a la categoría del producto.                                                                              |
| **RN-05** | **Cierre de Caja Ciego (Cortes X y Z):** Al ejecutar un Cierre de Caja (sea parcial de turno Corte X o definitivo del día Corte Z), el vendedor debe declarar el dinero físico de forma ciega sin ver el saldo teórico. El sistema calcula el Arqueo (diferencia) y notifica automáticamente cualquier descuadre al AS y AC. |
| **RN-06** | **Autorización In-Situ (Anulaciones y Reembolsos):** Las cancelaciones de ventas facturadas, anulaciones de comprobantes y reembolsos en efectivo exigen la aprobación inmediata y presencial de un AS mediante la lectura de su credencial o ingreso de PIN.                                                                |
| **RN-07** | **Descuentos Discrecionales Pre-aprobados:** Un vendedor solo puede aplicar descuentos manuales si el AS le ha asignado previamente una cuota o límite porcentual acumulado. Si cuenta con saldo en su cuota, no requiere autorización por PIN al momento del cobro.                                                         |
| **RN-08** | **Flujo de Devolución "En Revisión":** Un producto devuelto NO reingresa automáticamente al stock disponible para la venta. Pasa obligatoriamente al estado "En Revisión" hasta que un AS verifique el estado físico de la mercadería y decida reingresarlo al stock o derivarlo a mermas.                                   |
| **RN-09** | **Recargos y Descuentos por Pago Mixto:** En compras liquidadas mediante pagos divididos, los recargos o descuentos porcentuales asociados a un medio de pago específico se aplican exclusivamente sobre la fracción del monto abonado con dicho medio.                                                                      |
| **RN-10** | **Contingencia Fiscal:** En caso de interrupción del Web Service del ente regulador (ej. AFIP) o de la pasarela de pagos, el POS emite el comprobante bajo la modalidad de contingencia, almacenando la transacción en una cola local prioritaria para su sincronización automática apenas se reestablezca el servicio.      |

---

## 7. Requisitos No Funcionales (RNF)

| Código     | Categoría                   | Descripción del Requisito                                                                                                                                                                                                                                                                                      |
| :--------- | :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RNF-01** | Base de Datos               | Toda la información transaccional, relacional, logs de auditoría e imágenes (almacenadas en Blob/Base64) reside en PostgreSQL. Aplicación estricta de borrado lógico (_Soft Delete_).                                                                                                                          |
| **RNF-02** | Arquitectura y Conectividad | Sistema 100% online. Requiere conexión mediante WebSockets o Polling de alta frecuencia para garantizar la reserva de stock concurrente en tiempo real sin estado offline de catálogo.                                                                                                                         |
| **RNF-03** | Integración de Hardware     | Comunicación fluida del navegador web con periféricos (impresoras térmicas de tickets, lectores de código de barras y terminales de pago) utilizando APIs Web Nativas (WebUSB / WebSerial) o, en su defecto, un agente local transparente (ej. QZ Tray) para evitar diálogos emergentes del sistema operativo. |
| **RNF-04** | Seguridad                   | Encriptación robusta de contraseñas, autenticación mediante Tokens JWT, auto-logout por inactividad configurable y validación obligatoria de correo electrónico para la activación de cuentas.                                                                                                                 |
| **RNF-05** | Diseño UX/UI                | Interfaz de usuario adaptativa: POS optimizado operativamente para pantallas táctiles y tablets; módulos administrativos y Dashboards optimizados para entornos Desktop.                                                                                                                                       |

---

## 8. Alcance y Exclusiones (Out of Scope)

_Características excluidas del alcance para la presente versión del producto:_

- **Fidelización de Clientes:** No se implementará acumulación de puntos, club de beneficios ni categorización VIP de clientes.
- **Omnicanalidad / E-commerce:** No se contempla la integración interactiva o sincronización de pedidos con plataformas e-commerce externas (ej. WooCommerce, Magento, Mercado Libre).
- **Conversión Multimoneda:** El sistema operará bajo una única moneda base por tenant. No se calcularán conversiones ni tipos de cambio de divisas en vivo dentro del POS.

---

## 9. Definición de Entidades Principales (Data Model Consolidado)

- **Usuario:** `ID`, `Tenant ID`, `Perfil Base`, `Roles Asignados (SA, AC, AS, VO)`, `Nombre`, `Email Validado`, `Contraseña Encriptada`, `Cuota Descuento Asignada`, `is_active (Soft Delete)`.
- **Proveedor:** `ID`, `Tenant ID`, `Nombre / Razón Social`, `DNI/CUIT/CUIL`, `Contacto`, `Dirección`, `Saldo Adeudado`, `is_active`.
- **Pago_Proveedor:** `ID Pago`, `Proveedor ID`, `Tenant ID`, `Monto`, `Fecha`, `Método de Pago`, `Comprobante Ref`, `ID Usuario Registro`.
- **Producto / Combo:** `ID`, `Tenant ID`, `Nombre`, `Código de Barras`, `Categoría (Tasa IVA)`, `Costo`, `Imagen (Blob/Base64)`, `Tipo (Simple/Combo)`, `is_combo (Boolean)`, `Componentes Combo (Array de [Producto ID, Cantidad])`, `is_active`.
- **Inventario:** `ID`, `Sucursal ID`, `Producto ID`, `stock_disponible`, `stock_reservado`, `stock_revision`, `alerta_minima`.
- **Cliente:** `ID`, `Tenant ID`, `Nombre / Razón Social`, `DNI/CUIT`, `Datos de Contacto`, `Límite de Crédito Permitido`, `Saldo Actual (Cuenta Corriente)`, `is_active`.
- **Lista de Precios:** `ID`, `Tenant ID`, `Nombre`, `Regla de Cálculo (Precio Fijo / % sobre Costo / Regla por Grupo)`, `Tasa Impositiva Asociada`.
- **Venta / Transacción:** `ID Venta`, `Tenant ID`, `Sucursal ID`, `Caja ID`, `Vendedor ID`, `Cliente ID`, `Estado (Pagada, Pendiente AFIP/Contingencia, Crédito, Anulada)`, `Subtotal`, `Total`, `Descuento Aplicado`, `Array de Métodos de Pago (Método ID, Monto Abonado, Recargo/Descuento Aplicado)`.
- **Sesion_Caja:** `ID Sesión`, `Caja ID`, `Usuario Apertura ID`, `Fecha/Hora Apertura`, `Fecha/Hora Cierre`, `Saldo Inicial`, `Saldo Final Físico Declarado`, `Saldo Teórico`, `Diferencia Arqueo`, `Tipo de Cierre (Corte X / Corte Z)`.
- **Devolución / Nota de Crédito:** `ID Devolución`, `Venta Original ID`, `Sucursal ID`, `Ítems Devueltos (Array de [Producto ID, Cantidad])`, `Monto Reintegrado / Nota Crédito`, `Estado (Pendiente de Revisión, Reingresado a Stock, Merma)`, `ID Autorizador (AS)`.
- **Transferencia (Remito):** `ID Remito`, `Sucursal Origen ID`, `Sucursal Destino ID`, `Ítems (Array de [Producto ID, Cantidad])`, `Fecha Envío`, `Fecha Recepción`, `Estado (Enviado, Recibido, Rechazado)`, `ID Usuario Emisor`, `ID Usuario Receptor`.
- **Movimiento de Caja:** `ID Movimiento`, `Sesion_Caja ID`, `Tipo (Ingreso Manual, Retiro Manual)`, `Monto`, `Motivo / Justificación`, `ID Usuario`.
- **Historial / Logs (Auditoría):** `ID Log`, `Tenant ID`, `Usuario ID`, `Timestamp`, `Acción Realizada`, `Payload Before (Estado Previo)`, `Payload After (Estado Nuevo)`.

---

## 10. Constitución del Proyecto

1. **Stack:** Backend en Node.js con Express, frontend en React y PostgreSQL como base de datos y fuente de verdad; la aplicación funciona conectada.
2. **Contingencia:** solo la emisión fiscal admite cola temporal; no hay operación offline de catálogo o ventas.
3. **Aislamiento:** cada consulta y escritura valida el tenant en el servidor; ocultar datos en la interfaz no cuenta como protección.
4. **Permisos:** cada acción verifica rol y ámbito (comercio/sucursal); el Super Administrador no accede a datos comerciales.
5. **Retención:** las bajas son lógicas; las operaciones y auditorías no se eliminan físicamente.
6. **Integridad:** cambios de stock, ventas y caja se guardan de forma consistente, incluso ante concurrencia.
7. **Reglas de negocio:** precios, IVA, pagos mixtos, devoluciones y cierres se calculan en lógica verificable del dominio del backend, nunca en la interfaz.
8. **Calidad:** todo cambio debe pasar formato/lint y compilación o verificación de tipos antes de integrarse.
9. **Tests:** toda regla de negocio nueva o modificada incluye pruebas automatizadas.
10. **Seguridad probada:** los tests cubren accesos entre tenants y permisos insuficientes.
11. **Integraciones:** facturación y periféricos se mantienen detrás de límites explícitos; sus fallas no deben falsear una venta como exitosa.
12. **Límites:** quedan fuera de alcance fidelización, e-commerce y conversión multimoneda.
13. **Segregación de funciones:** quien autoriza una operación con PIN o credencial nunca puede ser quien la solicitó, aunque tenga ambos roles.
14. **Arquitectura hexagonal:** el backend sigue una arquitectura hexagonal (puertos y adaptadores). El dominio no depende de frameworks, de la base de datos ni de integraciones externas, que se conectan mediante adaptadores. La arquitectura, sus capas, puertos y adaptadores están documentados y la documentación se mantiene al día con el código.
15. **Separación frontend/backend:** el frontend y el backend son aplicaciones separadas que se comunican solo a través de endpoints del backend. El frontend no contiene lógica de negocio: solo presenta datos, captura entradas y hace validaciones de formato. Toda excepción a esta regla se consulta y se aprueba antes de implementarse.
16. **Endpoints protegidos:** todo endpoint exige autenticación con un token de API válido y vigente, que se verifica en el servidor. Solo son públicos el de salud del sistema, que no expone datos internos, los del flujo de acceso (inicio de sesión, validación de correo y recuperación de contraseña) y los de notificaciones de integraciones externas. Estos últimos se autentican con la firma del proveedor, tienen límite de frecuencia y nunca toman su contenido como verdadero: solo disparan una consulta a la API del proveedor.
17. **Ciberseguridad básica:** la comunicación usa siempre HTTPS. Todas las entradas se validan en el servidor y las consultas se parametrizan. Los intentos de acceso tienen límite de frecuencia. Los tokens vencen y se pueden revocar. Los secretos no se guardan en el código ni en el repositorio. Los registros nunca contienen contraseñas, PIN, tokens ni datos de pago. Las respuestas de error no exponen detalles internos. Las dependencias se mantienen sin vulnerabilidades conocidas.
