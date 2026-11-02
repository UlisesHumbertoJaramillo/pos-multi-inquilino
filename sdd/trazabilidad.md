# Trazabilidad RF ↔ pruebas

> Generado por `npm run trazabilidad` desde las etiquetas `[RF-xxx]` de las pruebas. No se edita a mano.

**Cobertura:** 20 de 169 RF con al menos una prueba.

| RF | Sección | Requisito | Pruebas |
| :-- | :-- | :-- | :-- |
| RF-001 | §5.1 | El sistema deberá restringir toda lectura y escritura de datos comerciales al comercio (t… | [aislamiento-rls.int.test.ts](../apps/backend/test/integration/aislamiento-rls.int.test.ts): [RF-001] aislamiento por comercio en la base<br>[sesiones.int.test.ts](../apps/backend/test/integration/sesiones.int.test.ts): [RF-001] contexto de seguridad |
| RF-002 | §5.1 | Si un usuario solicita datos o acciones de otro comercio, entonces el sistema deberá rech… | [autorizaciones.int.test.ts](../apps/backend/test/integration/autorizaciones.int.test.ts): [RF-002] recurso de otro comercio |
| RF-003 | §5.1 | El sistema deberá impedir que el SA consulte datos comerciales de cualquier comercio: ven… | [permissions.test.ts](../apps/backend/src/compartido/aplicacion/permissions.test.ts): [RF-003] el SA no accede a datos comerciales |
| RF-004 | §5.1 | El sistema deberá verificar en cada acción que el rol activo del usuario la permite según… | [permissions.test.ts](../apps/backend/src/compartido/aplicacion/permissions.test.ts): [RF-004] matriz de permisos §5.18 |
| RF-005 | §5.1 | Cuando un usuario ingresa con un correo validado y la contraseña correcta, el sistema deb… | [roles.test.ts](../apps/backend/src/modulos/identidad/dominio/roles.test.ts): [RF-005] rol activo al ingresar<br>[login.int.test.ts](../apps/backend/test/integration/login.int.test.ts): [RF-005] inicio de sesión<br>[sesiones.int.test.ts](../apps/backend/test/integration/sesiones.int.test.ts): [RF-005] [RF-010] [RF-011] rol activo<br>[LoginPage.test.tsx](../apps/frontend/src/pages/LoginPage.test.tsx): [RF-005] pantalla de inicio de sesión |
| RF-006 | §5.1 | Si un usuario intenta ingresar sin haber validado su correo, entonces el sistema deberá d… | [login.int.test.ts](../apps/backend/test/integration/login.int.test.ts): [RF-006] correo sin validar<br>[recuperacion.int.test.ts](../apps/backend/test/integration/recuperacion.int.test.ts): [RF-006] validación de correo<br>[LoginPage.test.tsx](../apps/frontend/src/pages/LoginPage.test.tsx): [RF-006] con el correo sin validar ofrece reenviar la validación |
| RF-007 | §5.1 | Cuando se solicita recuperar la contraseña de un correo, el sistema deberá enviar a ese c… | [recuperacion.int.test.ts](../apps/backend/test/integration/recuperacion.int.test.ts): [RF-007] [RF-008] recuperación de contraseña |
| RF-145 | §5.1 | Si se ingresan una contraseña o un PIN incorrectos 5 veces seguidas, entonces el sistema … | [lockout.test.ts](../apps/backend/src/modulos/identidad/dominio/lockout.test.ts): [RF-145] bloqueo de credenciales<br>[autorizaciones.int.test.ts](../apps/backend/test/integration/autorizaciones.int.test.ts): [RF-145] bloqueo del PIN<br>[login.int.test.ts](../apps/backend/test/integration/login.int.test.ts): [RF-145] bloqueo de la contraseña |
| RF-008 | §5.1 | Si se usa un token de recuperación vencido o ya utilizado, entonces el sistema deberá rec… | [recuperacion.int.test.ts](../apps/backend/test/integration/recuperacion.int.test.ts): [RF-007] [RF-008] recuperación de contraseña |
| RF-009 | §5.1 | Mientras una sesión permanezca inactiva más allá del tiempo configurado, el sistema deber… | [sesiones.int.test.ts](../apps/backend/test/integration/sesiones.int.test.ts): [RF-009] renovación, cierre y revocación de la sesión |
| RF-010 | §5.1 | Donde un usuario tenga más de un rol asignado, el sistema deberá permitirle cambiar de ro… | [sesiones.int.test.ts](../apps/backend/test/integration/sesiones.int.test.ts): [RF-005] [RF-010] [RF-011] rol activo<br>[LoginPage.test.tsx](../apps/frontend/src/pages/LoginPage.test.tsx): [RF-010] rol activo en la interfaz |
| RF-011 | §5.1 | Cuando un usuario cambia de rol activo, el sistema deberá aplicar de inmediato los permis… | [roles.test.ts](../apps/backend/src/modulos/identidad/dominio/roles.test.ts): [RF-011] ámbito del rol activo<br>[sesiones.int.test.ts](../apps/backend/test/integration/sesiones.int.test.ts): [RF-005] [RF-010] [RF-011] rol activo |
| RF-012 | §5.1 | El sistema deberá impedir que se asigne el rol SA junto con cualquier rol de un comercio … | [identidad-esquema.int.test.ts](../apps/backend/test/integration/identidad-esquema.int.test.ts): [RF-012] el rol SA no se combina con roles de un comercio |
| RF-141 | §5.1 | Cuando una operación exige el PIN o la credencial de un AS de la sucursal, el sistema deb… | [autorizaciones.int.test.ts](../apps/backend/test/integration/autorizaciones.int.test.ts): [RF-141] PIN de autorización<br>[autorizaciones.int.test.ts](../apps/backend/test/integration/autorizaciones.int.test.ts): [RF-113] [RF-141] autorización in situ |
| RF-113 | §5.1 | Si el PIN o la credencial de autorización pertenece al mismo usuario que solicitó la oper… | [autorizaciones.int.test.ts](../apps/backend/test/integration/autorizaciones.int.test.ts): [RF-113] [RF-141] autorización in situ |
| RF-013 | §5.2 | El sistema deberá permitir al SA dar de alta, modificar y suspender comercios, y fijar en… | — |
| RF-134 | §5.2 | Si se intenta cambiar la moneda de un comercio que ya tiene operaciones registradas, ento… | — |
| RF-014 | §5.2 | Mientras un comercio esté suspendido, el sistema deberá impedir el acceso de todos sus us… | — |
| RF-146 | §5.2 | Cuando el SA suspende un comercio, el sistema deberá cerrar de inmediato las sesiones de … | — |
| RF-147 | §5.2 | El sistema deberá permitir al SA dar de baja lógica un comercio sin comprobantes fiscales… | — |
| RF-163 | §5.2 | El sistema deberá permitir al SA activar o desactivar el módulo de facturación de cada co… | — |
| RF-164 | §5.2 | Si se intenta desactivar el módulo de facturación de un comercio con comprobantes en cola… | — |
| RF-015 | §5.2 | El sistema deberá permitir al SA crear otros usuarios SA y el primer AC de cada comercio.… | — |
| RF-016 | §5.2 | El sistema deberá mostrar al SA un panel técnico con alertas de servidores, de periférico… | — |
| RF-017 | §5.2 | Cuando un AC o un AS envía un ticket de soporte, el sistema deberá ponerlo a disposición … | — |
| RF-018 | §5.3 | Cuando se ejecuta una acción crítica (venta, anulación, devolución, movimiento o cierre d… | [autorizaciones.int.test.ts](../apps/backend/test/integration/autorizaciones.int.test.ts): [RF-018] [RF-019] auditoría comercial |
| RF-019 | §5.3 | El sistema deberá impedir que cualquier usuario modifique o elimine registros de auditorí… | [autorizaciones.int.test.ts](../apps/backend/test/integration/autorizaciones.int.test.ts): [RF-018] [RF-019] auditoría comercial |
| RF-020 | §5.3 | Cuando un usuario da de baja una entidad, el sistema deberá desactivarla de forma lógica … | [soft-delete.test.ts](../apps/backend/src/compartido/dominio/soft-delete.test.ts): [RF-020] baja lógica<br>[soft-delete.int.test.ts](../apps/backend/test/integration/soft-delete.int.test.ts): [RF-020] [RF-021] bajas lógicas |
| RF-021 | §5.3 | El sistema deberá impedir la eliminación física de registros de operaciones, entidades y … | [privilegios.int.test.ts](../apps/backend/test/integration/privilegios.int.test.ts): [RF-021] privilegios de pos_app sobre las tablas nuevas<br>[soft-delete.int.test.ts](../apps/backend/test/integration/soft-delete.int.test.ts): [RF-020] [RF-021] bajas lógicas |
| RF-148 | §5.3 | Si se intenta dar de baja un producto con reservas, compras o transferencias pendientes, … | — |
| RF-149 | §5.3 | Cuando se da de baja un producto que es componente de un combo, el sistema deberá dejar e… | — |
| RF-022 | §5.3 | El sistema deberá permitir al SA consultar la auditoría técnica global (inicios de sesión… | — |
| RF-114 | §5.3 | El sistema deberá permitir al AC consultar la auditoría comercial de su comercio y al AS … | — |
| RF-023 | §5.4 | El sistema deberá permitir al AC dar de alta, modificar y dar de baja sucursales de su co… | — |
| RF-024 | §5.4 | El sistema deberá permitir al AC crear cajas y asignarlas a una sucursal de su comercio. | — |
| RF-025 | §5.4 | Si se intenta dar de baja una sucursal o una caja con turnos abiertos, ventas en curso o … | — |
| RF-026 | §5.4 | El sistema deberá permitir al AC crear usuarios de su comercio y asignarles roles y sucur… | — |
| RF-027 | §5.4 | El sistema deberá mostrar la estructura del comercio como jerarquía Comercio > Sucursales… | — |
| RF-135 | §5.4 | El sistema deberá permitir al AC configurar los métodos de pago del comercio con su recar… | — |
| RF-130 | §5.5 | El sistema deberá permitir al AC dar de alta, modificar y dar de baja productos, categorí… | — |
| RF-131 | §5.5 | Si se intenta registrar un código de barras que ya usa otro producto activo del mismo com… | — |
| RF-028 | §5.5 | El sistema deberá permitir al AC crear listas de precios con una regla de cálculo de prec… | — |
| RF-029 | §5.5 | El sistema deberá permitir al AC asignar una tasa de IVA a cada categoría de producto. | — |
| RF-119 | §5.5 | El sistema deberá permitir al AC asignar a cada sucursal una única lista de precios activ… | — |
| RF-030 | §5.5 | Cuando un VO agrega un ítem al carrito, el sistema deberá fijar su precio según la lista … | — |
| RF-120 | §5.5 | El sistema deberá tratar los precios de lista como precios finales con IVA incluido y des… | — |
| RF-031 | §5.5 | Mientras un ítem permanezca en el carrito, el sistema deberá mantener el precio fijado al… | — |
| RF-032 | §5.5 | Cuando cambia el costo de un producto, el sistema deberá recalcular los precios de las li… | — |
| RF-033 | §5.5 | El sistema deberá permitir imprimir una lista de precios. | — |
| RF-034 | §5.6 | El sistema deberá permitir al AC dar de alta, modificar y dar de baja proveedores. | — |
| RF-035 | §5.6 | Cuando el AC importa el catálogo de un proveedor, el sistema deberá identificar los produ… | — |
| RF-036 | §5.6 | Cuando el AC registra una compra a crédito indicando la sucursal de destino, el sistema d… | — |
| RF-133 | §5.6 | Cuando un AS de la sucursal de destino recibe una compra, el sistema deberá sumar las can… | — |
| RF-037 | §5.6 | Cuando el AC registra un pago a un proveedor, el sistema deberá reducir su saldo adeudado… | — |
| RF-038 | §5.6 | Si un pago supera el saldo adeudado al proveedor, entonces el sistema deberá advertirlo y… | — |
| RF-039 | §5.7 | El sistema deberá llevar por separado el stock disponible, el reservado, el que está en r… | — |
| RF-040 | §5.7 | El sistema deberá permitir al AS ajustar el stock de su sucursal y configurar el umbral d… | — |
| RF-041 | §5.7 | Cuando el stock disponible de un producto cae por debajo de su umbral mínimo, el sistema … | — |
| RF-042 | §5.7 | Cuando el AS registra una merma por rotura, vencimiento o pérdida, el sistema deberá desc… | — |
| RF-043 | §5.7 | Si un ajuste o una merma deja el stock disponible por debajo de cero, entonces el sistema… | — |
| RF-044 | §5.7 | Cuando el AS emite una transferencia a otra sucursal del mismo comercio, el sistema deber… | — |
| RF-045 | §5.7 | Cuando un AS de la sucursal de destino recibe una transferencia, el sistema deberá sumar … | — |
| RF-150 | §5.7 | Si se intenta recibir una cantidad mayor que la enviada, entonces el sistema deberá recha… | — |
| RF-046 | §5.7 | Cuando la sucursal de destino rechaza una transferencia, total o parcialmente, el sistema… | — |
| RF-151 | §5.7 | Mientras una transferencia no haya sido recibida, el sistema deberá permitir que un AS de… | — |
| RF-047 | §5.7 | El sistema deberá impedir transferencias entre sucursales de comercios distintos. | — |
| RF-048 | §5.8 | El sistema deberá permitir al AC crear reglas de promoción automáticas (por ejemplo, 2x1)… | — |
| RF-049 | §5.8 | El sistema deberá permitir al AC definir combos con un precio único y una lista de compon… | — |
| RF-050 | §5.8 | Cuando un carrito cumple las condiciones de una o más promociones vigentes, el sistema de… | — |
| RF-143 | §5.8 | Mientras un ítem permanezca en el carrito, el sistema deberá mantener la promoción que se… | — |
| RF-051 | §5.8 | Cuando se agrega un combo al carrito, el sistema deberá reservar el stock de cada compone… | — |
| RF-124 | §5.8 | El sistema deberá prorratear el precio de un combo entre sus componentes según el precio … | — |
| RF-052 | §5.8 | El sistema deberá calcular el stock disponible de un combo como el mínimo, entre todos su… | — |
| RF-053 | §5.9 | Mientras un VO no tenga un turno abierto en una caja, el sistema deberá impedirle registr… | — |
| RF-054 | §5.9 | El sistema deberá permitir al VO buscar productos por nombre o por código de barras, y se… | — |
| RF-055 | §5.9 | Cuando un VO agrega una o más unidades al carrito, el sistema deberá pasarlas de stock di… | — |
| RF-152 | §5.9 | Cuando dos solicitudes simultáneas compiten por un mismo límite (stock, saldo de cuota, l… | — |
| RF-056 | §5.9 | Si no hay stock disponible suficiente al agregar un ítem, entonces el sistema deberá rech… | — |
| RF-057 | §5.9 | Cuando dos VO intentan reservar la última unidad al mismo tiempo, el sistema deberá otorg… | — |
| RF-058 | §5.9 | Cuando un ítem se quita del carrito o se descarta la venta, el sistema deberá devolver de… | — |
| RF-059 | §5.9 | Mientras un carrito permanezca inactivo más allá del tiempo configurado por el comercio, … | — |
| RF-116 | §5.9 | Cuando se descarta un carrito, el sistema deberá conservarlo con estado "Descartado" y el… | — |
| RF-060 | §5.9 | El sistema deberá mostrar en el POS el subtotal, los descuentos aplicados y el total fina… | — |
| RF-061 | §5.9 | El sistema deberá reflejar en los POS conectados de la misma sucursal, sin que haga falta… | — |
| RF-062 | §5.9 | Si se pierde la conexión con el servidor, entonces el sistema deberá impedir agregar ítem… | — |
| RF-063 | §5.10 | El sistema deberá permitir al AC fijar el tope de cuota de descuento de su comercio, comp… | — |
| RF-064 | §5.10 | El sistema deberá permitir al AS asignar a cada VO, para su sucursal, una cuota de descue… | — |
| RF-142 | §5.10 | Cuando el AC reduce el tope del comercio, el sistema deberá recortar al nuevo tope las cu… | — |
| RF-065 | §5.10 | Cuando un VO aplica un descuento manual que no supera su porcentaje máximo por venta y ca… | — |
| RF-066 | §5.10 | Si un descuento manual supera el porcentaje máximo por venta o el saldo de la cuota del V… | — |
| RF-067 | §5.10 | Cuando un VO abre su primer turno de una fecha de jornada en una sucursal, el sistema deb… | — |
| RF-068 | §5.11 | El sistema deberá permitir cobrar una venta combinando varios métodos de pago, incluida l… | — |
| RF-153 | §5.11 | El sistema deberá llevar para cada venta, por separado, su estado comercial (en curso, pa… | — |
| RF-121 | §5.11 | El sistema deberá calcular el total de la venta aplicando, en este orden, el precio fijad… | — |
| RF-069 | §5.11 | El sistema deberá aplicar el recargo o descuento de cada método de pago solo sobre la fra… | — |
| RF-122 | §5.11 | El sistema deberá calcular el total a cobrar como la suma de las fracciones asignadas a c… | — |
| RF-123 | §5.11 | El sistema deberá redondear los importes a 2 decimales por ítem y por fracción de pago y … | — |
| RF-070 | §5.11 | Si la suma de las fracciones asignadas no iguala el total de la venta, o lo abonado con a… | — |
| RF-071 | §5.11 | Cuando el pago en efectivo excede la fracción asignada al efectivo, el sistema deberá cal… | — |
| RF-132 | §5.11 | El sistema deberá permitir al AS dar de alta, modificar y dar de baja clientes, que se co… | — |
| RF-072 | §5.11 | El sistema deberá permitir al AS fijar el límite de crédito de cada cliente con cuenta co… | — |
| RF-144 | §5.11 | Si se intenta una venta a crédito a un cliente dado de baja o sin cuenta corriente, enton… | — |
| RF-128 | §5.11 | Cuando un VO con turno abierto registra un cobro de cuenta corriente, el sistema deberá r… | — |
| RF-129 | §5.11 | Si un cobro de cuenta corriente supera el saldo adeudado por el cliente, entonces el sist… | — |
| RF-073 | §5.11 | Cuando se confirma una venta a crédito dentro del límite disponible del cliente, el siste… | — |
| RF-074 | §5.11 | Si una venta a crédito supera el límite disponible del cliente, entonces el sistema deber… | — |
| RF-075 | §5.11 | Si un medio de pago electrónico informa un rechazo, entonces el sistema deberá dejar la v… | — |
| RF-125 | §5.11 | Si se intenta descartar una venta con pagos electrónicos aprobados, entonces el sistema d… | — |
| RF-126 | §5.11 | Si un medio de pago electrónico no responde o se pierde la conexión durante el cobro, ent… | — |
| RF-127 | §5.11 | Si la pasarela informa la aprobación de un pago cuya venta ya fue descartada, entonces el… | — |
| RF-076 | §5.11 | Cuando se confirma una venta, el sistema deberá descontar las unidades reservadas del sto… | — |
| RF-077 | §5.12 | El sistema deberá permitir al VO traspasar una venta en curso a otro VO con turno abierto… | — |
| RF-078 | §5.12 | Cuando el VO receptor acepta un traspaso, el sistema deberá transferirle la venta y sus r… | — |
| RF-079 | §5.12 | Si el VO receptor rechaza el traspaso o no lo acepta dentro del tiempo de inactividad del… | — |
| RF-080 | §5.12 | Cuando un VO intenta cerrar sesión voluntariamente con el turno abierto o con ventas en c… | — |
| RF-081 | §5.13 | Cuando se solicita anular una venta (facturada o no), anular un comprobante o reembolsar … | — |
| RF-082 | §5.13 | Cuando se anula una venta, el sistema deberá revertir íntegramente el stock (al disponibl… | — |
| RF-136 | §5.13 | Si se solicita anular una venta fuera del turno en que se registró, en forma parcial o co… | — |
| RF-083 | §5.13 | Cuando un VO con turno abierto en cualquier sucursal del comercio ingresa o escanea el nú… | — |
| RF-138 | §5.13 | Si la venta original supera el plazo máximo de devolución configurado por el comercio, en… | — |
| RF-084 | §5.13 | Si se intenta devolver una cantidad mayor que la vendida menos la ya devuelta, entonces e… | — |
| RF-085 | §5.13 | Cuando se confirma una devolución, el sistema deberá calcular el reintegro de forma propo… | — |
| RF-086 | §5.13 | Donde la venta original haya sido a crédito, el sistema deberá descontar el monto devuelt… | — |
| RF-137 | §5.13 | El sistema deberá pagar el reintegro de una devolución desde la caja del turno actual. Si… | — |
| RF-169 | §5.13 | Si se intenta devolver una venta facturada mientras el módulo de facturación del comercio… | — |
| RF-087 | §5.13 | Cuando se confirma una devolución, el sistema deberá emitir la Nota de Crédito fiscal si … | — |
| RF-139 | §5.13 | Mientras el comprobante original de una venta no haya sido aceptado por el ente fiscal, e… | — |
| RF-140 | §5.13 | Cuando se devuelve o se anula una venta con descuento manual, el sistema deberá mantener … | — |
| RF-088 | §5.13 | Cuando el AS revisa un ítem "En Revisión", el sistema deberá permitirle reingresarlo al s… | — |
| RF-089 | §5.14 | Cuando un VO abre un turno en una caja, el sistema deberá registrar el saldo inicial decl… | — |
| RF-090 | §5.14 | Mientras una caja tenga un turno abierto, el sistema deberá impedir que otro usuario abra… | — |
| RF-154 | §5.14 | Mientras un VO tenga un turno abierto, el sistema deberá impedirle abrir otro en cualquie… | — |
| RF-091 | §5.14 | Cuando un VO registra un ingreso o un retiro manual de efectivo, el sistema deberá exigir… | — |
| RF-092 | §5.14 | Cuando se solicita un retiro manual, el sistema deberá exigir el PIN o la credencial de u… | — |
| RF-093 | §5.14 | Mientras se declara el dinero físico en un cierre, el sistema deberá ocultarle el saldo t… | — |
| RF-112 | §5.14 | Mientras un turno esté abierto, el sistema deberá impedir que el VO conozca o deduzca el … | — |
| RF-094 | §5.14 | Cuando un VO confirma un Corte X, el sistema deberá cerrar su turno, calcular el arqueo (… | — |
| RF-117 | §5.14 | Si se solicita un Corte X con ventas en curso en ese turno, entonces el sistema deberá re… | — |
| RF-118 | §5.14 | El sistema deberá abrir la jornada de una caja con el primer turno posterior a su último … | — |
| RF-095 | §5.14 | Cuando un VO o un AS de la sucursal sin turno abierto en esa caja confirma un Corte Z, el… | — |
| RF-096 | §5.14 | Si se solicita un Corte Z con turnos abiertos o ventas en curso en esa caja, entonces el … | — |
| RF-097 | §5.14 | Si una caja tiene una jornada anterior sin Corte Z, entonces el sistema deberá impedir qu… | — |
| RF-098 | §5.14 | Cuando un arqueo da un faltante o un sobrante mayor que la tolerancia configurada por el … | — |
| RF-099 | §5.14 | El sistema deberá impedir que se modifique un cierre ya confirmado. | — |
| RF-115 | §5.14 | Cuando un AS de la sucursal fuerza el cierre de un turno ajeno, el sistema deberá exigirl… | — |
| RF-165 | §5.15 | Mientras un comercio no tenga activo el módulo de facturación, el sistema deberá confirma… | — |
| RF-166 | §5.15 | Donde el comercio tenga activo el módulo de facturación, el sistema deberá permitir al AC… | — |
| RF-167 | §5.15 | Cuando un VO cobra una venta con una política opcional, el sistema deberá proponer factur… | — |
| RF-168 | §5.15 | Cuando un AS o un AC solicita facturar una venta confirmada sin factura, el sistema deber… | — |
| RF-100 | §5.15 | Cuando se confirma una venta que se factura, el sistema deberá enviar al servicio del ent… | — |
| RF-101 | §5.15 | Si el servicio fiscal no está disponible (timeout o error técnico), entonces el sistema d… | — |
| RF-160 | §5.15 | El sistema deberá solicitar por adelantado el código de autorización anticipado de cada p… | — |
| RF-161 | §5.15 | Si el servicio fiscal no está disponible y no hay un código de autorización anticipado vi… | — |
| RF-162 | §5.15 | Donde el comercio tenga activo el módulo de facturación, el sistema deberá permitir al AC… | — |
| RF-102 | §5.15 | Cuando el servicio fiscal vuelve a estar disponible, el sistema deberá enviar automáticam… | — |
| RF-103 | §5.15 | Si el ente fiscal rechaza un comprobante, sea en línea o emitido en contingencia, entonce… | — |
| RF-104 | §5.15 | El sistema deberá permitir al AC o al AS corregir un comprobante rechazado y reenviarlo. | — |
| RF-105 | §5.15 | Si un comprobante en cola o rechazado no se regulariza dentro del plazo configurado, ento… | — |
| RF-106 | §5.15 | El sistema deberá impedir que una venta figure como fiscalmente emitida mientras el ente … | — |
| RF-155 | §5.15 | El sistema deberá determinar el tipo de comprobante según la condición fiscal del comprad… | — |
| RF-107 | §5.16 | Cuando se confirma una venta, el sistema deberá emitir un ticket con la sucursal, el vend… | — |
| RF-108 | §5.16 | Si la impresora no responde, entonces el sistema deberá mantener la venta confirmada, avi… | — |
| RF-109 | §5.16 | El sistema deberá generar a demanda un informe diario de ventas por sucursal, agrupado po… | — |
| RF-110 | §5.16 | El sistema deberá mostrar al AC un dashboard con las métricas de D-50 y las alertas, cons… | — |
| RF-111 | §5.16 | El sistema deberá mostrar al AS un dashboard con las métricas de D-50, las ventas diarias… | — |
| RF-156 | §5.17 | El sistema deberá guardar contraseñas y PIN de forma irreversible, de modo que nadie, ni … | [crypto.test.ts](../apps/backend/src/modulos/identidad/adaptadores/crypto.test.ts): [RF-156] HashDeSecretos con argon2 |
| RF-157 | §5.17 | El sistema deberá permitir operar el POS completo en pantallas táctiles de tablet, y la a… | — |
| RF-158 | §5.17 | El sistema deberá comunicarse con la impresora de tickets, el lector de códigos y la term… | — |
| RF-159 | §5.17 | El sistema deberá permitir asociar una imagen a cada producto. | — |
