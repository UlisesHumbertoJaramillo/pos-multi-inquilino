# Spec — Sistema de Punto de Venta (POS) Multi-Inquilino

**Versión:** 1.2 (deriva de la Especificación Funcional v8.5 Master; incorpora la revisión QA del 2026-10-31 y las decisiones de implementación del 2026-11-02)
**Fecha:** 2026-11-02
**Alcance:** sistema completo (RF-01 a RF-20 de la v8.5)
**Naturaleza del documento:** describe solo el **QUÉ** y el **POR QUÉ**. No se fijan la tecnología, el diseño ni la implementación.

---

## 1. Propósito

Varios comercios deben poder vender, controlar su stock y rendir su caja en una misma plataforma web, con sus datos totalmente aislados entre sí. El sistema tiene que impedir tres cosas: vender stock que ya no existe, permitir manipulaciones de caja sin rastro y frenar la venta cuando falla el servicio fiscal.

## 2. Actores

| Actor | Sigla | Responsabilidad |
| :-- | :-- | :-- |
| Super Administrador | SA | Gestión global de comercios, cuentas y soporte. Sin acceso a datos comerciales. |
| Administrador de Comercio | AC | Estrategia del comercio: catálogo, precios, proveedores, usuarios, promociones, topes y parámetros. Puede autorizar en persona en lugar del AS (D-34). |
| Administrador de Sucursal | AS | Operación local: inventario, autorizaciones in situ, devoluciones y crédito. |
| Vendedor / Operador | VO | Ventas, cobros, movimientos de caja y cierres ciegos. |

## 3. Decisiones de alcance tomadas en la elicitación

| # | Tema | Decisión | Por qué |
| :-- | :-- | :-- | :-- |
| D-1 | Alcance | El spec cubre los 20 RF de la v8.5. | Se quiere una única referencia para todo el producto. |
| D-2 | Carritos abandonados | La reserva de stock expira tras un tiempo de inactividad configurable por comercio. | Evita que haya stock bloqueado sin dueño cuando se cierra el navegador o se cae la conexión. |
| D-3 | Rechazo fiscal posterior a la contingencia | La venta sigue siendo válida comercialmente. Se marca como rechazada fiscalmente, se alerta al AS y al AC y se corrige y reenvía de forma manual. Los reintentos tienen un plazo límite y, al vencer, se escala. | No se puede deshacer una entrega ya hecha, pero la irregularidad fiscal tiene que quedar visible y con responsables. |
| D-4 | Reintegro de devoluciones | Proporcional a los medios de pago originales, incluido el recargo o descuento de cada fracción. Si la venta fue a crédito, se descuenta de la cuenta corriente. | Mantiene la caja y la cuenta corriente coherentes con lo que realmente se cobró. |
| D-5 | Corte Z | Se bloquea mientras haya turnos o ventas abiertas. Si una jornada queda sin Corte Z, la caja no puede abrir otra. | Garantiza que cada jornada fiscal cierre completa y cuadrada. |
| D-6 | Cuota de descuento | El AC fija el tope del comercio y el AS asigna a cada VO una cuota dentro de ese tope. La cuota se reinicia en cada apertura de turno. *(El reinicio y la unidad de la cuota quedaron modificados por D-32.)* | Resuelve la contradicción entre RF-04 y RN-07 y acota el riesgo por turno. |

### 3.1 Decisiones de la revisión QA (2026-10-31)

| # | Tema | Decisión | Por qué |
| :-- | :-- | :-- | :-- |
| D-7 | Retiros de efectivo | Todo retiro manual exige el PIN o la credencial de un AS de la sucursal. La validación contra el efectivo teórico se muestra solo al AS. | Si el rechazo de un retiro se le mostrara al VO, podría deducir el saldo teórico y se rompería el cierre ciego (RN-05). |
| D-8 | Autoautorización | Quien autoriza con PIN o credencial nunca puede ser quien solicitó la operación, aunque tenga los roles VO y AS. | Un usuario con varios roles podría aprobar sus propios descuentos, excesos de crédito o anulaciones (Const. 13). |
| D-9 | Auditoría técnica y comercial | Hay dos auditorías. La técnica (inicios de sesión, accesos denegados, altas y suspensiones de comercios y cuentas, errores) la ve el SA. La comercial (estado anterior y posterior de las operaciones) es de cada comercio y solo la ven su AC y, para su sucursal, el AS. | La auditoría comercial contiene datos comerciales, y el SA no puede verlos (RN-01, Const. 4). |
| D-10 | Turno abandonado | Un AS de la sucursal puede forzar el Corte X de un turno ajeno, haciendo él la declaración ciega. Las ventas en curso de ese turno se descartan y liberan sus reservas. El cierre queda marcado como forzado y se notifica al AC. | Sin esta salida, un turno abandonado bloquea la caja, el Corte Z y la jornada siguiente (D-5). |
| D-11 | Sesión vencida con turno abierto | El cierre de sesión por inactividad no cierra el turno ni descarta los carritos: cada uno sigue sujeto a su propio vencimiento (D-2) y, si nadie vuelve, al cierre forzado (D-10). La obligación de cerrar el turno solo rige para el cierre de sesión voluntario. | El vencimiento de sesión es una medida de seguridad, no un cierre de caja. |
| D-12 | Corte X con ventas en curso | Se rechaza hasta que cada venta en curso se cobre, se descarte o se traspase. La única excepción es el cierre forzado (D-10). | Ninguna venta queda en un turno ya cerrado. |
| D-13 | Jornada de caja | La jornada empieza con el primer turno posterior al último Corte Z de la caja y termina con el siguiente Corte Z, sin importar la fecha. Su fecha es la de apertura, en la zona horaria del comercio. | Se adapta a comercios que cierran después de medianoche sin forzar cortes artificiales. |
| D-14 | Ejecución del Corte Z | Lo ejecuta un VO o un AS de la sucursal que no tenga turno abierto en esa caja. Declara a ciegas el efectivo total y el sistema calcula el arqueo final contra el saldo teórico de la jornada. | Si D-5 exige que no haya turnos abiertos, el Corte Z necesita su propia declaración ciega. |
| D-15 | Lista de precios activa | El AC asigna a cada sucursal una única lista de precios activa, que usan todos sus POS. | Permite precios distintos por sede sin ambigüedad en el momento de la venta. |
| D-16 | IVA en el precio | Los precios de lista son finales, con IVA incluido. El IVA se desglosa hacia atrás según la tasa de la categoría. | Es lo habitual en la venta minorista a consumidor final. |
| D-17 | Orden de cálculo | 1) Precio fijado por ítem. 2) Promociones automáticas. 3) Descuento manual. El resultado es el total de la venta. 4) Cada medio de pago cubre una fracción de ese total, con su recargo o descuento calculado sobre esa fracción. El total a cobrar es la suma de las fracciones ajustadas. Los recargos integran la base del IVA. Los descuentos que afectan a varios ítems se prorratean según el importe de cada uno. Se redondea a 2 decimales por ítem y por fracción, y la diferencia se ajusta en la última línea. | Los cálculos tienen que ser verificables y reproducibles (Const. 7), incluidas las devoluciones parciales. |
| D-18 | IVA de combos | El precio del combo se prorratea entre sus componentes según el precio de lista de cada uno, y cada parte lleva la tasa de IVA de su categoría. El mismo prorrateo se usa en las devoluciones. | Un combo puede mezclar categorías con tasas de IVA distintas. |
| D-19 | Pago mixto con rechazo parcial | Los pagos aprobados se conservan imputados a la venta, que queda sin confirmar, y el saldo se puede cobrar con otro medio. Para descartar una venta con pagos aprobados, primero hay que revertirlos. | No se cobra al cliente sin venta y no se pierde un pago válido. |
| D-20 | Pago con resultado incierto | Si la pasarela no responde o se corta la conexión durante el cobro, la venta queda en "Pago por verificar" con sus reservas. No se puede reintentar ese medio hasta conocer el resultado: el sistema lo consulta y, si no lo obtiene, lo resuelve un AS. Una aprobación tardía de una venta descartada genera una alerta de reintegro pendiente. | Evita los cobros duplicados y las ventas falsamente exitosas o fallidas (Const. 11). |
| D-21 | Pedido fiscal atómico | El pedido de comprobante fiscal queda registrado como pendiente en la misma operación que confirma la venta, y se envía y reintenta después. | Ninguna venta confirmada puede quedar sin pedido de comprobante. |
| D-22 | Rechazo fiscal en línea | Se trata igual que el rechazo de un comprobante de contingencia (D-3). El ticket se emite como no fiscal y queda identificado como tal. | Mismo criterio: la venta es válida, pero la irregularidad queda visible. |
| D-23 | Cobros de cuenta corriente | Un VO con turno abierto registra el cobro con cualquier medio de pago. Reduce el saldo del cliente, entra en la caja del turno y forma parte del arqueo. Se emite un recibo y no se puede cobrar más de lo adeudado. | Sin cobros, el saldo de la cuenta corriente solo podría crecer. Pasar por caja mantiene el arqueo coherente. |
| D-24 | Gestión de catálogo y clientes | El AC gestiona productos, categorías y combos para todo el comercio. El AS da de alta y gestiona clientes, que se comparten en todo el comercio, y fija su límite de crédito. El código de barras es único dentro del comercio. | Precios y catálogo son estratégicos (AC). La relación con el cliente es local (AS). |
| D-25 | Ingreso de mercadería comprada | El AC registra la compra, que genera la deuda y actualiza el costo, indicando la sucursal de destino. Un AS de esa sucursal la recibe, y recién entonces las cantidades recibidas entran al stock disponible, con las diferencias registradas. | Igual que en las transferencias (S-4), no se puede vender lo que no llegó. |
| D-26 | Parámetros del comercio | El SA fija la moneda y la zona horaria al dar de alta el comercio, y la moneda no se puede cambiar una vez que hay operaciones. El AC configura los métodos de pago con su recargo o descuento, los tiempos de inactividad del carrito y de sesión y el plazo de regularización fiscal, dentro de los márgenes de la plataforma. | Cada parámetro configurable necesita un responsable. Cambiar la moneda alteraría el historial. |
| D-27 | Anulación | Anular es cancelar la venta entera, con su Nota de Crédito fiscal, mientras sigue abierto el turno en que se vendió y con PIN de un AS. El stock vuelve a disponible. Una cancelación parcial, posterior al turno o de una venta con devoluciones previas se tramita como devolución. | Distingue anulación de devolución y evita alterar turnos ya cerrados (RF-099). |
| D-28 | Lugar y caja de la devolución | La inicia un VO con turno abierto en cualquier sucursal del comercio. Los ítems quedan "En Revisión" en la sucursal que los recibe. El reintegro sale de la caja del turno actual. Si la caja no tiene efectivo suficiente, se rechaza informándolo solo al AS que autoriza. | Comodidad para el cliente, sin romper el cierre ciego (D-7). |
| D-29 | Devolución de una venta a crédito ya pagada | El monto devuelto se descuenta del saldo de la cuenta corriente hasta dejarlo en cero. El excedente se reintegra en efectivo, con PIN de un AS. | El saldo de la cuenta corriente nunca queda negativo. |
| D-30 | Nota de Crédito de un comprobante no regularizado | Se permite devolver o anular. La Nota de Crédito queda en cola y solo se envía después de que el ente acepte el comprobante original. Si el original sigue rechazado, la Nota de Crédito queda bloqueada y se suma a la alerta de D-3. | No se frena al cliente por un problema fiscal, y se respeta el orden que exige el ente. |
| D-31 | Otras reglas de devolución | El AC configura el plazo máximo para devolver. Un descuento manual consumido no se restituye a la cuota al devolver o anular. | Acota el riesgo y evita que una devolución sirva para recuperar cuota. |
| D-32 | Unidad y reinicio de la cuota | La cuota tiene dos límites: un porcentaje máximo de descuento por venta y un monto acumulado. Se asigna por VO y por sucursal, y el monto se restablece una sola vez por fecha de jornada (D-13), no en cada turno. El tope del AC tiene los mismos dos límites. Si el AC baja el tope, las cuotas que lo superan se recortan. | Impide recargar la cuota cerrando y abriendo turnos, y resuelve el caso de un VO que trabaja en varias sucursales. |
| D-33 | Combinación de promociones | Cada ítem recibe como máximo una promoción automática, la más beneficiosa para el cliente. Los componentes de un combo no reciben promociones. El descuento manual se suma después (D-17). Una promoción aplicada se mantiene aunque venza con el carrito abierto. | El resultado es predecible y coherente con S-1. |
| D-34 | Quién autoriza | Toda autorización que exige el PIN o la credencial de un AS de la sucursal también la puede dar en persona un AC del comercio, siempre que no sea el solicitante (D-8). Un descuento autorizado por encima de la cuota no la consume, pero queda en la auditoría. | No se frena la operación si falta el AS, y se mantiene la segregación de funciones. |
| D-35 | Crédito a clientes no habilitados | No se vende a crédito a un cliente dado de baja o sin cuenta corriente. | Solo un cliente activo con límite asignado puede tomar crédito. |
| D-36 | Diferencias en transferencias | Al recibir, el faltante sale del tránsito como merma por pérdida en tránsito y se alerta a los AS de origen y destino. No se puede recibir más de lo enviado. Se puede rechazar una parte, que vuelve al origen. El origen puede cancelar la transferencia mientras no se haya recibido. | Ninguna cantidad queda en tránsito para siempre (S-4). |
| D-37 | Orden de la cola fiscal | El orden se mantiene por punto de venta fiscal (caja). Un rechazo no frena el resto de la cola. Solo las Notas de Crédito esperan a su original (D-30). | Un comprobante con problemas no bloquea la regularización de los demás. |
| D-38 | Escalamiento fiscal | El plazo cubre los comprobantes en cola y los rechazados. Al vencer, se genera una alerta crítica en el dashboard del AC que no se puede descartar hasta regularizar, con recordatorios periódicos. Los reenvíos automáticos continúan. | Distingue el escalamiento de la alerta inicial de RF-103. |
| D-39 | Suspensión de un comercio | Las sesiones se cierran al instante, los carritos se descartan y liberan sus reservas, y los turnos quedan abiertos para cerrarse con cierre forzado (D-10) cuando se reactive el comercio. La cola fiscal se sigue enviando. | La suspensión es inmediata, pero no interrumpe una obligación legal. |
| D-55 | Credenciales fiscales | Cada comercio factura ante ARCA con su propio CUIT y certificado digital. El AC carga el certificado y la clave y define los puntos de venta. Se guardan cifrados, nunca se vuelven a mostrar y se alerta al AC antes de que venza el certificado. | Las credenciales fiscales pertenecen al comercio. El SA no debe manejarlas (RN-01). |
| D-56 | Contingencia con CAEA | La contingencia usa el régimen CAEA de ARCA. El sistema pide por adelantado el código de cada período. Si el servicio no responde, emite el comprobante con CAEA (válido fiscalmente) y lo informa a ARCA cuando el servicio vuelve. Si no hay un CAEA vigente, emite un ticket no fiscal identificado como tal, pide el CAE cuando vuelve el servicio y alerta al AC. *(Hay que confirmar con el contador del proyecto que el comercio puede usar el régimen CAEA.)* | Con ARCA, un comprobante sin código de autorización no es válido, así que la contingencia tiene que basarse en una autorización anticipada. |
| D-57 | Facturación como módulo opcional | La facturación con ARCA es un módulo del SaaS que el SA activa o desactiva por comercio según el plan contratado. Sin el módulo, las ventas se confirman sin comprobante fiscal, el ticket se identifica como no válido como factura, no se piden CAEA ni certificados y el comercio no ve funciones fiscales. Las decisiones y requisitos fiscales (D-3, D-21, D-22, D-30, D-38, D-52 a D-56) rigen solo para comercios con el módulo activo y para las ventas que se facturan. | Permite vender el SaaS a comercios chicos que no facturan electrónicamente, con la facturación como opción contratable. |
| D-58 | Facturación por venta | Con el módulo activo, el AC elige una política: "siempre" (toda venta se factura), "opcional, factura por defecto" (el VO puede desmarcarla) u "opcional, sin factura por defecto" (el VO la marca si el cliente la pide). Si el comprador identificado requiere factura A, la venta se factura siempre. La decisión y quién la tomó quedan registradas en la venta. Una venta sin factura se anula o se devuelve sin Nota de Crédito fiscal. El cumplimiento de la obligación de emitir comprobante es responsabilidad del comercio. | Da flexibilidad a cada comercio sin perder el registro de qué se facturó y quién lo decidió. |
| D-59 | Facturación posterior | Un AS o un AC puede facturar una venta confirmada sin factura dentro de un plazo que configura el AC (por defecto, la misma jornada). Queda en la auditoría. | Cubre al cliente que pide la factura después de pagar. |
| D-60 | Desactivación del módulo | El SA solo puede desactivar el módulo si el comercio no tiene comprobantes en cola, rechazados ni emitidos con CAEA sin informar. Los comprobantes ya emitidos se conservan y se pueden consultar. Mientras el módulo esté inactivo, no se puede devolver una venta que fue facturada. | Ningún comprobante queda sin regularizar, y una venta facturada no se devuelve sin su Nota de Crédito. |

### 3.2 Criterios por defecto de la revisión QA

Estos puntos tenían una solución razonable que no requería consulta. El responsable del producto los validó el 2026-10-31. D-43 se completó con sus parámetros.

| # | Tema | Decisión | Por qué |
| :-- | :-- | :-- | :-- |
| D-40 | Cola fiscal y pasarela | La cola fiscal se guarda en el servidor, que es la fuente de verdad, no en el navegador. La caída de la pasarela de pagos no tiene contingencia: se aplican D-19 y D-20. | Const. 1 y 2. RN-10 de la v8.5 queda limitada a la emisión fiscal. |
| D-41 | Servicio fiscal no disponible | Un timeout o un error técnico cuentan como servicio no disponible y activan la contingencia. Una respuesta del ente que objeta el comprobante cuenta como rechazo. | Distingue la contingencia (RF-101) del rechazo (RF-103). |
| D-42 | Bajas con dependencias | No se puede dar de baja un producto con reservas, compras o transferencias pendientes, un cliente o un proveedor con saldo, un usuario con turno abierto ni una sucursal con stock. Si se da de baja un componente, su combo deja de estar disponible. | Ninguna operación en curso queda apuntando a una entidad inactiva. |
| D-43 | Protección del acceso | La contraseña y el PIN se bloquean 15 minutos tras 5 intentos fallidos seguidos. El bloqueo de un PIN se alerta al AC. La recuperación de contraseña responde lo mismo exista o no el correo. Se puede reenviar el correo de validación. | Evita la fuerza bruta y la enumeración de usuarios. |
| D-44 | Estados de la venta | La venta tiene tres estados independientes. Comercial: en curso, pago por verificar, confirmada, descartada o anulada. De cobro: pagada o con saldo en cuenta corriente. Fiscal: no se factura, pendiente, en contingencia, emitida o rechazada. La cuenta corriente es un medio de pago que se puede combinar con otros. | Una venta puede estar confirmada y a la vez rechazada fiscalmente (D-3). |
| D-45 | Rol activo | Al ingresar se activa el último rol usado, y la primera vez el usuario elige. Cambiar de rol no cierra el turno ni descarta los carritos, pero el usuario no puede operar el POS con un rol que no sea VO. | El cambio de rol es de vista y permisos, no de estado operativo. |
| D-46 | Traspaso pendiente | Un traspaso no aceptado vence con el tiempo de inactividad del carrito y vuelve al emisor. Mientras está pendiente, cuenta como venta en curso del emisor. | Ninguna venta queda en el limbo (RF-080). |
| D-47 | Desconexión | Durante la desconexión, las reservas siguen sujetas a su vencimiento en el servidor. Al reconectar, el POS muestra el carrito vigente o informa que fue descartado. | El servidor es la fuente de verdad (Const. 1). |
| D-48 | Apertura de turno | Un VO puede tener un solo turno abierto a la vez. Si el saldo inicial declarado difiere del efectivo que dejó el turno anterior de la misma jornada, se registra la diferencia y se notifica al AS. | Detecta faltantes entre turnos. |
| D-49 | Importación de catálogo | Los productos se identifican por código de barras. Se aplican las filas válidas y se informan las rechazadas. La importación y el recálculo de precios que provoca (RF-032) quedan en la auditoría como una sola operación, con su detalle. | Se puede reconstruir sin inundar la auditoría. |
| D-50 | Métricas y tiempos | Dashboards: ventas totales, cantidad de tickets, ticket promedio, ventas por medio de pago, por vendedor y por producto, arqueos con diferencia, productos bajo el stock mínimo y comprobantes fiscales sin regularizar. Los cambios de stock se reflejan en otros POS en 2 segundos como máximo. | Vuelve verificables RF-061, RF-110 y RF-111. |
| D-51 | Alertas | La alerta de stock mínimo se emite una vez al cruzar el umbral y se rearma cuando el stock lo vuelve a superar. El AC configura una tolerancia de arqueo, por defecto 0, por debajo de la cual no se notifica. | Evita el ruido de alertas repetidas. |
| D-52 | Baja de comercio | El SA puede dar de baja un comercio en forma lógica solo si no tiene comprobantes fiscales sin regularizar. Sus datos se conservan. | RF-01 de la v8.5 y RN-02. |
| D-53 | Tipo de comprobante | El tipo de comprobante depende de la condición fiscal del comprador. Si no se identifica a nadie, se emite a consumidor final. | Requisito fiscal mínimo para la venta a clientes registrados. |
| D-54 | Falla del lector de códigos | Si el lector de códigos de barras falla, el VO puede seguir con la búsqueda manual. | Una falla de periférico no debe frenar la venta (Const. 11). |

### 3.3 Decisiones de la implementación (2026-11-02)

Surgieron al construir las fases 3 y 4. El responsable del producto las validó el 2026-11-02.

| # | Tema | Decisión | Por qué |
| :-- | :-- | :-- | :-- |
| D-61 | Márgenes de la plataforma | Inactividad del carrito: de 2 a 120 minutos, 15 por defecto. Inactividad de sesión: de 5 a 480 minutos, 30 por defecto. Regularización fiscal: de 24 a 240 horas, 72 por defecto. Plazo de devolución: de 0 a 365 días, 30 por defecto. Facturación posterior: de 0 a 30 días, 0 (la misma jornada) por defecto. Tolerancia de arqueo: de 0 a 100.000, 0 por defecto. Recargo o descuento de un método de pago: de −50 % a +100 %. | D-26 pide márgenes de la plataforma sin fijarlos. Sin un rango, un valor extremo podría bloquear la operación o anular los controles. |
| D-62 | Cálculo del precio por regla | La regla "porcentaje sobre el costo" calcula el precio final como costo sin IVA × (1 + margen) × (1 + tasa de IVA de la categoría), redondeado al centavo (la mitad hacia arriba). La regla por grupo aplica un margen por categoría y uno por defecto para las categorías sin margen propio. El margen va de −90 % a +1000 %. En una lista de precio fijo, el AC carga cada precio a mano y un cambio de costo no lo modifica. | Vuelve verificables RF-028 y RF-032. Como el costo de compra se registra sin IVA, el IVA se suma al final para llegar al precio final de D-16. |
| D-63 | Precio de los combos | El precio único de un combo es el mismo en todas las listas de precios, cualquiera sea su regla. | Es la lectura de "precio único" de RF-049. El combo no tiene costo propio sobre el cual aplicar una regla. |
| D-64 | Bajas en el catálogo | No se puede dar de baja una categoría con productos activos ni una lista de precios que es la activa de alguna sucursal. | Completa D-42: ningún producto queda sin tasa de IVA y ninguna sucursal queda sin lista de precios (D-15). |
| D-65 | Historial de precios | Cada cambio de un precio de lista queda en un historial con el precio anterior, el nuevo y su causa (alta, cambio de costo, de tasa de IVA, de regla, precio manual o de combo). | Permite reconstruir por qué un producto tenía un precio en una fecha (Const. 7). |

## 4. Supuestos validados

Estos puntos quedaron fuera de la primera ronda de preguntas. El responsable del producto los validó el 2026-10-31.

| # | Tema | Decisión validada | Por qué |
| :-- | :-- | :-- | :-- |
| S-1 | Momento del precio | El precio de cada ítem se fija al agregarlo al carrito y se mantiene aunque la lista cambie mientras el carrito está abierto. | El cliente paga el precio que vio. Como la reserva expira por inactividad (D-2), un precio desactualizado no puede durar mucho. |
| S-2 | Exceso de crédito | Una venta a crédito que supere el límite disponible del cliente se rechaza, salvo que un AS de la sucursal la autorice con su PIN o credencial. | Da flexibilidad comercial, pero cada exceso tiene un responsable identificado y queda en la auditoría. |
| S-3 | Stock de combos | El combo no tiene stock propio. Su disponibilidad es el mínimo que permiten sus componentes y venderlo reserva cada componente. | Evita llevar dos inventarios de la misma mercadería que pueden contradecirse. |
| S-4 | Stock en tránsito | Una transferencia sale de la sucursal de origen al emitirse y entra en la de destino al recibirse. Mientras tanto no está disponible en ninguna. Si se rechaza, vuelve a la de origen. | Ninguna sucursal puede vender mercadería que no tiene en sus manos. |
| S-5 | SA y roles de comercio | Un usuario SA no puede tener roles de un comercio. Quien necesite ambos usa dos cuentas. | Garantiza la segregación de RN-01. |
| S-6 | Alcance del traspaso | Una venta solo se traspasa a un VO con turno abierto en la misma sucursal. Las reservas pasan al receptor. | Las reservas pertenecen al stock de una sucursal, y traspasar entre sucursales lo volvería inconsistente. |

---

## 5. Requisitos funcionales (EARS)

Patrones EARS usados: **Ubicuo** ("El sistema deberá…"), **Por evento** ("Cuando…"), **Por estado** ("Mientras…"), **No deseado** ("Si…, entonces…") y **Opcional** ("Donde…").
La columna *Origen* remite a la v8.5 (RF, RN, UC) o a las decisiones (D) y supuestos (S) de este documento.

### 5.1 Aislamiento, seguridad y acceso

**Por qué:** varios comercios comparten la plataforma. Una sola filtración de datos entre ellos invalida el producto.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-001 | El sistema deberá restringir toda lectura y escritura de datos comerciales al comercio (tenant) del usuario que la solicita. | RN-01 |
| RF-002 | Si un usuario solicita datos o acciones de otro comercio, entonces el sistema deberá rechazar la solicitud, no revelar si el recurso existe y registrar el intento en la auditoría técnica. | RN-01, D-9 |
| RF-003 | El sistema deberá impedir que el SA consulte datos comerciales de cualquier comercio: ventas, inventarios, productos, precios, promociones, clientes, proveedores, facturas, cajas, usuarios del comercio (salvo el primer AC que él crea) y auditoría comercial. | RN-01, RF-01, D-9 |
| RF-004 | El sistema deberá verificar en cada acción que el rol activo del usuario la permite según la matriz de permisos (§5.18) y que el recurso está dentro de su ámbito (comercio o sucursal). | Const. 4 |
| RF-005 | Cuando un usuario ingresa con un correo validado y la contraseña correcta, el sistema deberá iniciar su sesión con el último rol que usó como rol activo o, si es su primer ingreso, pedirle que elija uno de sus roles. | UC-TR-01, D-45 |
| RF-006 | Si un usuario intenta ingresar sin haber validado su correo, entonces el sistema deberá denegar el acceso, indicar que falta la validación y permitirle pedir un nuevo correo de validación. | RNF-04, D-43 |
| RF-007 | Cuando se solicita recuperar la contraseña de un correo, el sistema deberá enviar a ese correo, si está registrado, un token de un solo uso y de vigencia limitada, y responder lo mismo exista o no la cuenta. | UC-TR-02, D-43 |
| RF-145 | Si se ingresan una contraseña o un PIN incorrectos 5 veces seguidas, entonces el sistema deberá bloquear esa credencial durante 15 minutos, registrar el evento en la auditoría técnica y, si se trata de un PIN, alertar al AC. | D-43 |
| RF-008 | Si se usa un token de recuperación vencido o ya utilizado, entonces el sistema deberá rechazarlo. | UC-TR-02 |
| RF-009 | Mientras una sesión permanezca inactiva más allá del tiempo configurado, el sistema deberá cerrarla automáticamente sin cerrar el turno de caja ni descartar los carritos del usuario. | RNF-04, D-11 |
| RF-010 | Donde un usuario tenga más de un rol asignado, el sistema deberá permitirle cambiar de rol activo sin cerrar sesión. | RF-11, UC-TR-03 |
| RF-011 | Cuando un usuario cambia de rol activo, el sistema deberá aplicar de inmediato los permisos y el ámbito del nuevo rol, sin cerrar su turno ni descartar sus carritos. | RF-11, D-45 |
| RF-012 | El sistema deberá impedir que se asigne el rol SA junto con cualquier rol de un comercio a un mismo usuario. | S-5 |
| RF-141 | Cuando una operación exige el PIN o la credencial de un AS de la sucursal, el sistema deberá aceptar también el de un AC del comercio que esté presente, siempre que no sea el solicitante. | D-34 |
| RF-113 | Si el PIN o la credencial de autorización pertenece al mismo usuario que solicitó la operación, entonces el sistema deberá rechazar la autorización, aunque ese usuario tenga un rol que lo habilite a autorizar. | D-8, Const. 13 |

### 5.2 Super Administrador

**Por qué:** la plataforma necesita gobernarse y recibir soporte sin que eso exponga los datos de los comercios.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-013 | El sistema deberá permitir al SA dar de alta, modificar y suspender comercios, y fijar en el alta su moneda única y su zona horaria. | RF-01, UC-SA-01, D-26 |
| RF-134 | Si se intenta cambiar la moneda de un comercio que ya tiene operaciones registradas, entonces el sistema deberá rechazar el cambio. | D-26 |
| RF-014 | Mientras un comercio esté suspendido, el sistema deberá impedir el acceso de todos sus usuarios, conservar íntegros sus datos y seguir enviando su cola fiscal. | RF-01, RN-02, D-39 |
| RF-146 | Cuando el SA suspende un comercio, el sistema deberá cerrar de inmediato las sesiones de sus usuarios y descartar sus carritos liberando las reservas. Los turnos abiertos quedan pendientes de un cierre forzado (RF-115) para cuando se reactive el comercio. | D-39 |
| RF-147 | El sistema deberá permitir al SA dar de baja lógica un comercio sin comprobantes fiscales por regularizar, conservando todos sus datos. | RF-01, D-52 |
| RF-163 | El sistema deberá permitir al SA activar o desactivar el módulo de facturación de cada comercio. | D-57 |
| RF-164 | Si se intenta desactivar el módulo de facturación de un comercio con comprobantes en cola, rechazados o emitidos con CAEA sin informar, entonces el sistema deberá rechazar la desactivación e indicar qué comprobantes la impiden. | D-60 |
| RF-015 | El sistema deberá permitir al SA crear otros usuarios SA y el primer AC de cada comercio. Ambas cuentas requieren validar el correo. | RF-02, UC-SA-02 |
| RF-016 | El sistema deberá mostrar al SA un panel técnico con alertas de servidores, de periféricos y de errores técnicos, sin datos comerciales. | RF-02, UC-SA-04 |
| RF-017 | Cuando un AC o un AS envía un ticket de soporte, el sistema deberá ponerlo a disposición del SA para su seguimiento y respuesta. | UC-SA-05, UC-AC-09 |

### 5.3 Auditoría y retención

**Por qué:** cada operación sensible debe poder reconstruirse, y nada se pierde por borrado.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-018 | Cuando se ejecuta una acción crítica (venta, anulación, devolución, movimiento o cierre de caja, cambio de precio, de stock, de permisos o de cuota, o una autorización por PIN), el sistema deberá registrar en la auditoría comercial del comercio quién la hizo, cuándo, sobre qué y el estado anterior y posterior. | RF-03, D-9 |
| RF-019 | El sistema deberá impedir que cualquier usuario modifique o elimine registros de auditoría. | RF-03 |
| RF-020 | Cuando un usuario da de baja una entidad, el sistema deberá desactivarla de forma lógica y conservar el registro y su historial. | RN-02 |
| RF-021 | El sistema deberá impedir la eliminación física de registros de operaciones, entidades y auditoría. | RN-02 |
| RF-148 | Si se intenta dar de baja un producto con reservas, compras o transferencias pendientes, un cliente o un proveedor con saldo, un usuario con turno abierto o una sucursal con stock disponible, en revisión o en tránsito, entonces el sistema deberá rechazar la baja e indicar qué la impide. | D-42 |
| RF-149 | Cuando se da de baja un producto que es componente de un combo, el sistema deberá dejar ese combo no disponible para la venta. | D-42 |
| RF-022 | El sistema deberá permitir al SA consultar la auditoría técnica global (inicios de sesión, accesos denegados, altas y suspensiones de comercios y cuentas, errores técnicos), que nunca incluye contenido comercial. | RF-03, UC-SA-03, RN-01, D-9 |
| RF-114 | El sistema deberá permitir al AC consultar la auditoría comercial de su comercio y al AS solo la de su sucursal. | RF-03, D-9 |

### 5.4 Estructura organizativa y usuarios

**Por qué:** la jerarquía Comercio > Sucursal > Caja define dónde puede operar cada persona.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-023 | El sistema deberá permitir al AC dar de alta, modificar y dar de baja sucursales de su comercio. | RF-04, UC-AC-01 |
| RF-024 | El sistema deberá permitir al AC crear cajas y asignarlas a una sucursal de su comercio. | RF-04, UC-AC-02 |
| RF-025 | Si se intenta dar de baja una sucursal o una caja con turnos abiertos, ventas en curso o transferencias pendientes, entonces el sistema deberá rechazar la baja e indicar qué la impide. | Integridad |
| RF-026 | El sistema deberá permitir al AC crear usuarios de su comercio y asignarles roles y sucursales. | RF-04, UC-AC-03 |
| RF-027 | El sistema deberá mostrar la estructura del comercio como jerarquía Comercio > Sucursales > Cajas. | §3.1 |
| RF-135 | El sistema deberá permitir al AC configurar los métodos de pago del comercio con su recargo o descuento, el tiempo de inactividad del carrito, el de sesión, el plazo de regularización fiscal, el plazo de facturación posterior y el plazo máximo de devolución, siempre dentro de los márgenes que define la plataforma. | D-26, D-61, D-2, D-31, RF-009, RF-105 |

### 5.5 Precios, costos e IVA

**Por qué:** el precio de venta debe seguir al costo y aplicar el IVA correcto sin cálculos manuales.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-130 | El sistema deberá permitir al AC dar de alta, modificar y dar de baja productos, categorías y combos de su comercio. | D-24 |
| RF-131 | Si se intenta registrar un código de barras que ya usa otro producto activo del mismo comercio, entonces el sistema deberá rechazarlo. | D-24 |
| RF-028 | El sistema deberá permitir al AC crear listas de precios con una regla de cálculo de precio fijo, porcentaje sobre el costo o regla por grupo. | RF-05, UC-AC-04, D-62 |
| RF-029 | El sistema deberá permitir al AC asignar una tasa de IVA a cada categoría de producto. | RF-05, RN-04 |
| RF-119 | El sistema deberá permitir al AC asignar a cada sucursal una única lista de precios activa, que es la que usan todos sus POS. | D-15 |
| RF-030 | Cuando un VO agrega un ítem al carrito, el sistema deberá fijar su precio según la lista de precios activa de la sucursal en ese momento y desglosar el IVA según la categoría del producto. | RN-04 (modificada por S-1), S-1, D-15 |
| RF-120 | El sistema deberá tratar los precios de lista como precios finales con IVA incluido y desglosar el IVA hacia atrás según la tasa de la categoría del producto. | D-16 |
| RF-031 | Mientras un ítem permanezca en el carrito, el sistema deberá mantener el precio fijado al agregarlo, aunque la lista de precios cambie. | S-1 |
| RF-032 | Cuando cambia el costo de un producto, el sistema deberá recalcular los precios de las listas que dependen de ese costo. | RF-05 |
| RF-033 | El sistema deberá permitir imprimir una lista de precios. | UC-AC-04 |

### 5.6 Proveedores y cuentas por pagar

**Por qué:** el costo, que es la base del precio, y la deuda con proveedores deben estar en el mismo sistema.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-034 | El sistema deberá permitir al AC dar de alta, modificar y dar de baja proveedores. | RF-06, UC-AC-05 |
| RF-035 | Cuando el AC importa el catálogo de un proveedor, el sistema deberá identificar los productos por código de barras, crear o actualizar los productos y sus costos de las filas válidas, informar qué filas no pudo procesar y por qué, y registrar en la auditoría la importación y el recálculo que provoca como una sola operación con su detalle. | RF-06, UC-AC-05, D-49 |
| RF-036 | Cuando el AC registra una compra a crédito indicando la sucursal de destino, el sistema deberá aumentar el saldo adeudado al proveedor, actualizar el costo de los productos comprados y dejar la compra pendiente de recepción. | RF-06, UC-AC-06, D-25 |
| RF-133 | Cuando un AS de la sucursal de destino recibe una compra, el sistema deberá sumar las cantidades recibidas a su stock disponible y registrar cualquier diferencia con lo comprado. | D-25 |
| RF-037 | Cuando el AC registra un pago a un proveedor, el sistema deberá reducir su saldo adeudado y conservar el comprobante de referencia. | RF-06, UC-AC-06 |
| RF-038 | Si un pago supera el saldo adeudado al proveedor, entonces el sistema deberá advertirlo y exigir una confirmación explícita antes de registrarlo. | Integridad |

### 5.7 Inventario, mermas y transferencias

**Por qué:** el stock de cada sucursal tiene que reflejar la realidad física, y las pérdidas no deben aparecer en la contabilidad como si fueran ventas.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-039 | El sistema deberá llevar por separado el stock disponible, el reservado, el que está en revisión y el que está en tránsito de cada producto en cada sucursal. | §9, RN-03, RN-08, S-4 |
| RF-040 | El sistema deberá permitir al AS ajustar el stock de su sucursal y configurar el umbral de stock mínimo de cada producto. | RF-07, UC-AS-02 |
| RF-041 | Cuando el stock disponible de un producto cae por debajo de su umbral mínimo, el sistema deberá alertar una vez al AS de esa sucursal y no repetir la alerta hasta que el stock vuelva a superar el umbral. | RF-07, D-51 |
| RF-042 | Cuando el AS registra una merma por rotura, vencimiento o pérdida, el sistema deberá descontar el stock con su motivo, sin generar ingresos ni egresos de dinero. | RF-07, UC-AS-03 |
| RF-043 | Si un ajuste o una merma deja el stock disponible por debajo de cero, entonces el sistema deberá rechazar la operación. | Integridad |
| RF-044 | Cuando el AS emite una transferencia a otra sucursal del mismo comercio, el sistema deberá descontar las cantidades del stock disponible de origen y registrarlas como stock en tránsito. | RF-08, UC-AS-04, S-4 |
| RF-045 | Cuando un AS de la sucursal de destino recibe una transferencia, el sistema deberá sumar las cantidades recibidas a su stock disponible, registrar el faltante como merma por pérdida en tránsito y alertar a los AS de origen y destino. | RF-08, D-36 |
| RF-150 | Si se intenta recibir una cantidad mayor que la enviada, entonces el sistema deberá rechazar la recepción. | D-36 |
| RF-046 | Cuando la sucursal de destino rechaza una transferencia, total o parcialmente, el sistema deberá devolver las cantidades rechazadas al stock disponible de la sucursal de origen. | RF-08, S-4, D-36 |
| RF-151 | Mientras una transferencia no haya sido recibida, el sistema deberá permitir que un AS de origen la cancele y devolver las cantidades a su stock disponible. | D-36 |
| RF-047 | El sistema deberá impedir transferencias entre sucursales de comercios distintos. | RN-01 |

### 5.8 Promociones y combos

**Por qué:** los descuentos tienen que aplicarse solos, sin depender de que el vendedor los recuerde, y los combos no deben dejar el stock inconsistente.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-048 | El sistema deberá permitir al AC crear reglas de promoción automáticas (por ejemplo, 2x1) con vigencia definida. | RF-09, UC-AC-08 |
| RF-049 | El sistema deberá permitir al AC definir combos con un precio único y una lista de componentes con sus cantidades. | RF-09, D-63 |
| RF-050 | Cuando un carrito cumple las condiciones de una o más promociones vigentes, el sistema deberá aplicar automáticamente a cada ítem como máximo una, la más beneficiosa para el cliente, sin aplicarlas a los componentes de un combo, y resaltarla en pantalla. | RF-13, UC-VO-02, D-33 |
| RF-143 | Mientras un ítem permanezca en el carrito, el sistema deberá mantener la promoción que se le aplicó aunque esta venza. | D-33, S-1 |
| RF-051 | Cuando se agrega un combo al carrito, el sistema deberá reservar el stock de cada componente en la cantidad que corresponde. | RF-09, S-3 |
| RF-124 | El sistema deberá prorratear el precio de un combo entre sus componentes según el precio de lista de cada uno, aplicar a cada parte la tasa de IVA de su categoría y usar ese mismo prorrateo en las devoluciones. | D-18 |
| RF-052 | El sistema deberá calcular el stock disponible de un combo como el mínimo, entre todos sus componentes, del stock disponible del componente dividido por la cantidad que requiere el combo, redondeado hacia abajo. | S-3 |

### 5.9 Venta en POS y reserva concurrente

**Por qué:** varios vendedores trabajan en paralelo y no pueden vender la misma unidad dos veces.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-053 | Mientras un VO no tenga un turno abierto en una caja, el sistema deberá impedirle registrar ventas. | UC-VO-01 |
| RF-054 | El sistema deberá permitir al VO buscar productos por nombre o por código de barras, y seguir con la búsqueda manual si falla el lector. | UC-VO-02, D-54 |
| RF-055 | Cuando un VO agrega una o más unidades al carrito, el sistema deberá pasarlas de stock disponible a stock reservado: todas o ninguna. | RN-03 |
| RF-152 | Cuando dos solicitudes simultáneas compiten por un mismo límite (stock, saldo de cuota, límite de crédito, cantidad devolvible, apertura de turno en una caja o recepción de una transferencia), el sistema deberá resolverlas de forma que el límite nunca se supere. | Const. 6 |
| RF-056 | Si no hay stock disponible suficiente al agregar un ítem, entonces el sistema deberá rechazar el agregado e informar la cantidad disponible. | RN-03 |
| RF-057 | Cuando dos VO intentan reservar la última unidad al mismo tiempo, el sistema deberá otorgarla a uno solo e informar al otro que no hay stock. | RN-03, Const. 6 |
| RF-058 | Cuando un ítem se quita del carrito o se descarta la venta, el sistema deberá devolver de inmediato su reserva al stock disponible. | RN-03 |
| RF-059 | Mientras un carrito permanezca inactivo más allá del tiempo configurado por el comercio, el sistema deberá liberar sus reservas y descartar el carrito, salvo que tenga pagos aprobados o esté en "Pago por verificar". | D-2, D-19, D-20 |
| RF-116 | Cuando se descarta un carrito, el sistema deberá conservarlo con estado "Descartado" y el motivo (manual, inactividad o cierre forzado de turno), sin eliminarlo. | Const. 5, RN-02 |
| RF-060 | El sistema deberá mostrar en el POS el subtotal, los descuentos aplicados y el total final, y actualizarlos ante cada cambio del carrito. | RF-13 |
| RF-061 | El sistema deberá reflejar en los POS conectados de la misma sucursal, sin que haga falta recargar y en 2 segundos como máximo, los cambios de stock disponible causados por otras sesiones, y nunca deberá enviar esa información a sesiones de otra sucursal o de otro comercio. | RNF-02, Const. 3 |
| RF-062 | Si se pierde la conexión con el servidor, entonces el sistema deberá impedir agregar ítems o cobrar e indicar al VO que está sin conexión. Las reservas siguen sujetas a su vencimiento, y al reconectar el sistema muestra el carrito vigente o informa que fue descartado. | RNF-02, Const. 2, D-47 |

### 5.10 Descuentos discrecionales

**Por qué:** dar margen al vendedor sin abrir la puerta a descuentos abusivos.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-063 | El sistema deberá permitir al AC fijar el tope de cuota de descuento de su comercio, compuesto por un porcentaje máximo por venta y un monto acumulado. | D-6, D-32, RF-04 |
| RF-064 | El sistema deberá permitir al AS asignar a cada VO, para su sucursal, una cuota de descuento (porcentaje máximo por venta y monto acumulado) que no supere ninguno de los dos límites del tope del comercio. | D-6, D-32, RN-07 |
| RF-142 | Cuando el AC reduce el tope del comercio, el sistema deberá recortar al nuevo tope las cuotas asignadas que lo superen. | D-32 |
| RF-065 | Cuando un VO aplica un descuento manual que no supera su porcentaje máximo por venta y cabe en el saldo de su cuota, el sistema deberá aplicarlo sin pedir autorización y descontar su importe del saldo. | RN-07, UC-VO-06, D-32 |
| RF-066 | Si un descuento manual supera el porcentaje máximo por venta o el saldo de la cuota del VO, entonces el sistema deberá exigir el PIN o la credencial de un AS de la sucursal para aplicarlo. Un descuento así autorizado no consume la cuota. | D-6, D-34 |
| RF-067 | Cuando un VO abre su primer turno de una fecha de jornada en una sucursal, el sistema deberá restablecer el saldo de su cuota al monto asignado para esa sucursal. Los turnos siguientes con la misma fecha de jornada no lo restablecen. | D-32 |

### 5.11 Cobro, pagos mixtos y crédito

**Por qué:** el cobro debe reflejar exactamente qué se pagó con cada medio y sus recargos, y el crédito no puede superar el riesgo aceptado.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-068 | El sistema deberá permitir cobrar una venta combinando varios métodos de pago, incluida la cuenta corriente del cliente, en la moneda única del comercio. | RF-14, UC-VO-03, D-44 |
| RF-153 | El sistema deberá llevar para cada venta, por separado, su estado comercial (en curso, pago por verificar, confirmada, descartada, anulada), su estado de cobro (pagada, con saldo en cuenta corriente) y su estado fiscal (no se factura, pendiente, en contingencia, emitida, rechazada). | D-44, D-57 |
| RF-121 | El sistema deberá calcular el total de la venta aplicando, en este orden, el precio fijado de cada ítem, las promociones automáticas y el descuento manual, y deberá prorratear entre los ítems afectados, según su importe, los descuentos que afectan a más de uno. | D-17, Const. 7 |
| RF-069 | El sistema deberá aplicar el recargo o descuento de cada método de pago solo sobre la fracción del monto abonada con ese método. | RN-09 |
| RF-122 | El sistema deberá calcular el total a cobrar como la suma de las fracciones asignadas a cada medio de pago, cada una con su recargo o descuento, e incluir esos recargos y descuentos en la base del IVA. | D-17 |
| RF-123 | El sistema deberá redondear los importes a 2 decimales por ítem y por fracción de pago y ajustar la diferencia de redondeo en la última línea. | D-17 |
| RF-070 | Si la suma de las fracciones asignadas no iguala el total de la venta, o lo abonado con algún medio no cubre su fracción con su recargo o descuento, entonces el sistema deberá impedir que se confirme la venta. | Integridad, D-17 |
| RF-071 | Cuando el pago en efectivo excede la fracción asignada al efectivo, el sistema deberá calcular y mostrar el vuelto. Con otros medios no se admite pagar de más. | UC-VO-03 |
| RF-132 | El sistema deberá permitir al AS dar de alta, modificar y dar de baja clientes, que se comparten en todo el comercio. | D-24 |
| RF-072 | El sistema deberá permitir al AS fijar el límite de crédito de cada cliente con cuenta corriente. | RF-10, UC-AS-05 |
| RF-144 | Si se intenta una venta a crédito a un cliente dado de baja o sin cuenta corriente, entonces el sistema deberá rechazarla. | D-35 |
| RF-128 | Cuando un VO con turno abierto registra un cobro de cuenta corriente, el sistema deberá reducir el saldo del cliente, registrar el ingreso en la caja del turno según el medio de pago y emitir un recibo. | D-23 |
| RF-129 | Si un cobro de cuenta corriente supera el saldo adeudado por el cliente, entonces el sistema deberá rechazarlo. | D-23 |
| RF-073 | Cuando se confirma una venta a crédito dentro del límite disponible del cliente, el sistema deberá registrarla como pendiente de pago y aumentar el saldo de su cuenta corriente. | UC-VO-04 |
| RF-074 | Si una venta a crédito supera el límite disponible del cliente, entonces el sistema deberá informar el disponible y exigir el PIN o la credencial de un AS de la sucursal para confirmarla. Sin esa autorización, deberá rechazarla. | RF-10, S-2 |
| RF-075 | Si un medio de pago electrónico informa un rechazo, entonces el sistema deberá dejar la venta sin confirmar, conservar el carrito, sus reservas y los pagos ya aprobados, y permitir cobrar el saldo con otro medio. | Const. 11, D-19 |
| RF-125 | Si se intenta descartar una venta con pagos electrónicos aprobados, entonces el sistema deberá exigir que esos pagos se reviertan antes de descartarla. | D-19 |
| RF-126 | Si un medio de pago electrónico no responde o se pierde la conexión durante el cobro, entonces el sistema deberá dejar la venta en "Pago por verificar" con sus reservas, impedir reintentar el cobro con ese medio hasta conocer el resultado y consultarlo a la pasarela. Si no lo obtiene, deberá permitir que un AS de la sucursal lo resuelva manualmente. | D-20, Const. 11 |
| RF-127 | Si la pasarela informa la aprobación de un pago cuya venta ya fue descartada, entonces el sistema deberá alertar al AS y al AC con un reintegro pendiente. | D-20 |
| RF-076 | Cuando se confirma una venta, el sistema deberá descontar las unidades reservadas del stock de forma definitiva y registrar la venta, los pagos, el impacto en caja y, si la venta se factura, el pedido de comprobante fiscal pendiente en una única operación, que se completa entera o no se aplica. | Const. 6, D-21, D-58 |

### 5.12 Traspaso de ventas y alertas de sesión

**Por qué:** las ventas en curso no deben perderse cuando un vendedor termina su turno o se va.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-077 | El sistema deberá permitir al VO traspasar una venta en curso a otro VO con turno abierto en la misma sucursal. | RF-15, UC-VO-05, S-6 |
| RF-078 | Cuando el VO receptor acepta un traspaso, el sistema deberá transferirle la venta y sus reservas sin liberarlas en ningún momento. | RF-15, S-6 |
| RF-079 | Si el VO receptor rechaza el traspaso o no lo acepta dentro del tiempo de inactividad del carrito, entonces el sistema deberá devolver la venta al VO que la envió. Mientras el traspaso esté pendiente, cuenta como venta en curso del emisor. | RF-15, D-46 |
| RF-080 | Cuando un VO intenta cerrar sesión voluntariamente con el turno abierto o con ventas en curso, el sistema deberá avisarle y exigirle que resuelva cada venta en curso (cobrándola, descartándola o traspasándola) y que cierre el turno con un Corte X antes de salir. | RF-16, UC-VO-01, D-11, D-12 |

### 5.13 Anulaciones y devoluciones

**Por qué:** las operaciones que sacan dinero o cancelan comprobantes son el principal riesgo de fraude, y la mercadería devuelta puede estar dañada.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-081 | Cuando se solicita anular una venta (facturada o no), anular un comprobante o reembolsar en efectivo, el sistema deberá exigir el PIN o la credencial de un AS de la sucursal antes de ejecutar la operación. | RN-06, UC-AS-07, UC-VO-07 |
| RF-082 | Cuando se anula una venta, el sistema deberá revertir íntegramente el stock (al disponible), la caja y la cuenta corriente que esa venta había afectado y, si la venta fue facturada, emitir la Nota de Crédito fiscal. | UC-VO-07, D-27, D-58 |
| RF-136 | Si se solicita anular una venta fuera del turno en que se registró, en forma parcial o con devoluciones previas, entonces el sistema deberá rechazar la anulación e indicar que corresponde una devolución. | D-27 |
| RF-083 | Cuando un VO con turno abierto en cualquier sucursal del comercio ingresa o escanea el número de un ticket, el sistema deberá mostrar sus ítems y las cantidades que aún se pueden devolver. | RF-17, UC-VO-08, D-28 |
| RF-138 | Si la venta original supera el plazo máximo de devolución configurado por el comercio, entonces el sistema deberá rechazar la devolución. | D-31 |
| RF-084 | Si se intenta devolver una cantidad mayor que la vendida menos la ya devuelta, entonces el sistema deberá rechazar la devolución. | Integridad |
| RF-085 | Cuando se confirma una devolución, el sistema deberá calcular el reintegro de forma proporcional a los medios de pago de la venta original, incluido el recargo o descuento de cada fracción. | D-4, RN-09 |
| RF-086 | Donde la venta original haya sido a crédito, el sistema deberá descontar el monto devuelto del saldo de la cuenta corriente del cliente hasta dejarlo en cero y reintegrar el excedente en efectivo, con PIN o credencial de un AS. | D-4, D-29 |
| RF-137 | El sistema deberá pagar el reintegro de una devolución desde la caja del turno actual. Si la caja no tiene efectivo suficiente para la parte en efectivo, deberá rechazar la devolución e informar el motivo solo al AS que autoriza. | D-28, D-7 |
| RF-169 | Si se intenta devolver una venta facturada mientras el módulo de facturación del comercio está inactivo, entonces el sistema deberá rechazar la devolución e indicar el motivo. | D-60 |
| RF-087 | Cuando se confirma una devolución, el sistema deberá emitir la Nota de Crédito fiscal si la venta original fue facturada, pagar el reintegro según RF-085 y RF-086 y dejar los ítems en estado "En Revisión" en la sucursal que los recibe, fuera del stock disponible. | RN-08, RF-17, D-28 |
| RF-139 | Mientras el comprobante original de una venta no haya sido aceptado por el ente fiscal, el sistema deberá mantener en cola su Nota de Crédito y, si el original está rechazado, sumarla a la alerta de regularización. | D-30 |
| RF-140 | Cuando se devuelve o se anula una venta con descuento manual, el sistema deberá mantener consumida la cuota de descuento que se usó. | D-31 |
| RF-088 | Cuando el AS revisa un ítem "En Revisión", el sistema deberá permitirle reingresarlo al stock disponible o registrarlo como merma. | RN-08, UC-AS-06 |

### 5.14 Caja, turnos y cierres ciegos

**Por qué:** las diferencias de caja deben detectarse sin que el cajero pueda ajustar lo que declara al saldo esperado.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-089 | Cuando un VO abre un turno en una caja, el sistema deberá registrar el saldo inicial declarado y, si difiere del efectivo que dejó el turno anterior de la misma jornada, registrar la diferencia y notificar al AS. | UC-VO-01, D-48 |
| RF-090 | Mientras una caja tenga un turno abierto, el sistema deberá impedir que otro usuario abra un turno en esa misma caja. | Glosario (Corte X) |
| RF-154 | Mientras un VO tenga un turno abierto, el sistema deberá impedirle abrir otro en cualquier caja. | D-48 |
| RF-091 | Cuando un VO registra un ingreso o un retiro manual de efectivo, el sistema deberá exigir un motivo y asociar el movimiento a su turno. | RF-18, UC-VO-09 |
| RF-092 | Cuando se solicita un retiro manual, el sistema deberá exigir el PIN o la credencial de un AS de la sucursal. Si el retiro supera el efectivo teórico de la caja, deberá rechazarlo e informar el motivo solo al AS que autoriza. | D-7, Integridad |
| RF-093 | Mientras se declara el dinero físico en un cierre, el sistema deberá ocultarle el saldo teórico a quien declara. | RN-05, D-10 |
| RF-112 | Mientras un turno esté abierto, el sistema deberá impedir que el VO conozca o deduzca el saldo teórico por cualquier vía, incluidos los mensajes de rechazo. | RN-05, D-7 |
| RF-094 | Cuando un VO confirma un Corte X, el sistema deberá cerrar su turno, calcular el arqueo (faltante, sobrante o cuadrado) y dejar la caja disponible para un nuevo turno de la misma jornada. | RN-05, RF-18 |
| RF-117 | Si se solicita un Corte X con ventas en curso en ese turno, entonces el sistema deberá rechazarlo e indicar qué ventas hay que cobrar, descartar o traspasar, salvo en un cierre forzado (RF-115). | D-12 |
| RF-118 | El sistema deberá abrir la jornada de una caja con el primer turno posterior a su último Corte Z, cerrarla con el siguiente Corte Z y fecharla con su fecha de apertura en la zona horaria configurada para el comercio. | D-13 |
| RF-095 | Cuando un VO o un AS de la sucursal sin turno abierto en esa caja confirma un Corte Z, el sistema deberá exigirle la declaración ciega del efectivo total, consolidar todos los turnos de la jornada, calcular el arqueo final contra el saldo teórico de la jornada y cerrarla. | RN-05, RF-18, D-14 |
| RF-096 | Si se solicita un Corte Z con turnos abiertos o ventas en curso en esa caja, entonces el sistema deberá rechazarlo e indicar qué falta cerrar. | D-5 |
| RF-097 | Si una caja tiene una jornada anterior sin Corte Z, entonces el sistema deberá impedir que abra una nueva jornada y alertar al AS. | D-5 |
| RF-098 | Cuando un arqueo da un faltante o un sobrante mayor que la tolerancia configurada por el AC (por defecto 0), el sistema deberá notificar al AS de la sucursal y al AC. | RN-05, D-51 |
| RF-099 | El sistema deberá impedir que se modifique un cierre ya confirmado. | RN-05, RN-02 |
| RF-115 | Cuando un AS de la sucursal fuerza el cierre de un turno ajeno, el sistema deberá exigirle la declaración ciega del efectivo, descartar las ventas en curso de ese turno liberando sus reservas, registrar el Corte X como forzado con el VO titular y el AS que lo ejecutó, y notificar al AC. | D-10 |

### 5.15 Facturación y contingencia fiscal

**Por qué:** la caída del servicio fiscal no puede frenar las ventas, pero ningún comprobante puede quedar sin regularizar.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-165 | Mientras un comercio no tenga activo el módulo de facturación, el sistema deberá confirmar sus ventas sin pedir comprobante fiscal, emitir un ticket identificado como no válido como factura y no mostrar funciones fiscales a sus usuarios. | D-57 |
| RF-166 | Donde el comercio tenga activo el módulo de facturación, el sistema deberá permitir al AC elegir la política de facturación por venta: "siempre", "opcional, factura por defecto" u "opcional, sin factura por defecto". | D-58 |
| RF-167 | Cuando un VO cobra una venta con una política opcional, el sistema deberá proponer facturarla o no según la política y permitirle cambiarlo, salvo que el comprador identificado requiera factura A, en cuyo caso la venta se factura siempre. La decisión y quién la tomó quedan registradas en la venta. | D-58 |
| RF-168 | Cuando un AS o un AC solicita facturar una venta confirmada sin factura, el sistema deberá emitir su comprobante si la solicitud está dentro del plazo de facturación posterior configurado, o rechazarla si está fuera de plazo. | D-59 |
| RF-100 | Cuando se confirma una venta que se factura, el sistema deberá enviar al servicio del ente regulador el pedido de comprobante registrado en la confirmación y reintentarlo hasta obtener una respuesta. | RF-19, UC-VO-10, D-21 |
| RF-101 | Si el servicio fiscal no está disponible (timeout o error técnico), entonces el sistema deberá emitir el comprobante en modo contingencia con el código de autorización anticipado vigente (CAEA), identificado como tal, y encolarlo en el servidor para informarlo después. | RN-10, RF-19, D-40, D-41, D-56 |
| RF-160 | El sistema deberá solicitar por adelantado el código de autorización anticipado de cada período para cada comercio con el módulo de facturación activo y alertar al AC si no logra obtenerlo antes de que empiece el período. | D-56 |
| RF-161 | Si el servicio fiscal no está disponible y no hay un código de autorización anticipado vigente, entonces el sistema deberá emitir un ticket no fiscal identificado como tal, encolar el pedido de comprobante para cuando vuelva el servicio y alertar al AC. | D-56 |
| RF-162 | Donde el comercio tenga activo el módulo de facturación, el sistema deberá permitir al AC cargar el certificado digital fiscal del comercio y definir sus puntos de venta, guardar el certificado y su clave cifrados sin volver a mostrarlos nunca, y alertar al AC antes de que el certificado venza. | D-55 |
| RF-102 | Cuando el servicio fiscal vuelve a estar disponible, el sistema deberá enviar automáticamente los comprobantes encolados en el orden en que se emitieron dentro de cada punto de venta fiscal, sin que un rechazo detenga el envío de los siguientes. | RN-10, D-37 |
| RF-103 | Si el ente fiscal rechaza un comprobante, sea en línea o emitido en contingencia, entonces el sistema deberá marcar la venta como "Rechazada fiscalmente", conservarla como venta válida y alertar al AS y al AC. Si el rechazo es en línea, el ticket se emite como no fiscal y queda identificado como tal. | D-3, D-22 |
| RF-104 | El sistema deberá permitir al AC o al AS corregir un comprobante rechazado y reenviarlo. | D-3 |
| RF-105 | Si un comprobante en cola o rechazado no se regulariza dentro del plazo configurado, entonces el sistema deberá mostrar en el dashboard del AC una alerta crítica que no se puede descartar hasta regularizarlo, enviar recordatorios periódicos y seguir reintentando el envío. | D-3, D-38 |
| RF-106 | El sistema deberá impedir que una venta figure como fiscalmente emitida mientras el ente fiscal no la haya aceptado. | Const. 11 |
| RF-155 | El sistema deberá determinar el tipo de comprobante según la condición fiscal del comprador identificado y, si no se identifica a nadie, emitirlo a consumidor final. | D-53 |

### 5.16 Tickets, reportes y dashboards

**Por qué:** cada nivel de la organización necesita ver lo que le corresponde para decidir, y nada más que eso.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-107 | Cuando se confirma una venta, el sistema deberá emitir un ticket con la sucursal, el vendedor, los ítems, las promociones aplicadas con su desglose, los medios de pago y los totales, identificado como comprobante fiscal o como ticket no válido como factura. | RF-20, D-57, D-58 |
| RF-108 | Si la impresora no responde, entonces el sistema deberá mantener la venta confirmada, avisar al VO y permitir reimprimir el ticket. | Const. 11 |
| RF-109 | El sistema deberá generar a demanda un informe diario de ventas por sucursal, agrupado por la fecha de jornada (RF-118), para el AS de esa sucursal y para el AC. | RF-20, D-13 |
| RF-110 | El sistema deberá mostrar al AC un dashboard con las métricas de D-50 y las alertas, consolidadas para todas las sucursales de su comercio y filtrables por período y por sucursal. | RF-12, UC-AC-07, D-50 |
| RF-111 | El sistema deberá mostrar al AS un dashboard con las métricas de D-50, las ventas diarias y las alertas de stock de su sucursal únicamente. | RF-12, UC-AS-01, D-50 |

### 5.17 Requisitos no funcionales

**Por qué:** la v8.5 fija exigencias de seguridad, de uso y de periféricos que también se tienen que verificar.

| ID | Requisito | Origen |
| :-- | :-- | :-- |
| RF-156 | El sistema deberá guardar contraseñas y PIN de forma irreversible, de modo que nadie, ni siquiera el SA, pueda recuperarlos en texto plano. | RNF-04 |
| RF-157 | El sistema deberá permitir operar el POS completo en pantallas táctiles de tablet, y la administración y los dashboards en escritorio. | RNF-05 |
| RF-158 | El sistema deberá comunicarse con la impresora de tickets, el lector de códigos y la terminal de pago desde el navegador, sin diálogos del sistema operativo en cada operación. | RNF-03 |
| RF-159 | El sistema deberá permitir asociar una imagen a cada producto. | RNF-01 |

### 5.18 Matriz de permisos

**Por qué:** cada acción verifica el rol y el ámbito (Const. 4). Esta matriz es la referencia para RF-004 y para las pruebas de permisos insuficientes (Const. 10). Lo que no figura aquí está denegado.

Ámbitos: el **AC** actúa sobre todo su comercio, el **AS** sobre las sucursales que tiene asignadas y el **VO** sobre la sucursal y la caja de su turno. El **SA** nunca accede a datos comerciales (RF-003).

| Acción | SA | AC | AS | VO | RF |
| :-- | :-: | :-: | :-: | :-: | :-- |
| Alta, modificación, suspensión y baja de comercios, con moneda y zona horaria | ✔ | | | | RF-013, RF-014, RF-146, RF-147 |
| Crear usuarios SA y el primer AC de un comercio | ✔ | | | | RF-015 |
| Activar o desactivar el módulo de facturación de un comercio | ✔ | | | | RF-163, RF-164 |
| Consultar la auditoría técnica, el panel técnico y responder tickets de soporte | ✔ | | | | RF-016, RF-017, RF-022 |
| Enviar tickets de soporte | | ✔ | ✔ | | RF-017 |
| Consultar la auditoría comercial | | ✔ | ✔ (su sucursal) | | RF-114 |
| Sucursales, cajas, usuarios del comercio y sus roles | | ✔ | | | RF-023 a RF-026 |
| Parámetros del comercio, métodos de pago y plazos | | ✔ | | | RF-135 |
| Certificado fiscal, puntos de venta y política de facturación (con el módulo activo) | | ✔ | | | RF-162, RF-166 |
| Facturar una venta posterior, dentro del plazo (con el módulo activo) | | ✔ | ✔ | | RF-168 |
| Catálogo, categorías e IVA, combos, listas de precios y su asignación a sucursales, promociones | | ✔ | | | RF-028, RF-029, RF-048, RF-049, RF-119, RF-130 |
| Tope de cuota de descuento del comercio | | ✔ | | | RF-063 |
| Proveedores, importación de catálogo, compras y pagos | | ✔ | | | RF-034 a RF-038 |
| Recibir compras | | | ✔ (destino) | | RF-133 |
| Ajustes de stock, umbrales, mermas y revisión de ítems "En Revisión" | | | ✔ | | RF-040, RF-042, RF-088 |
| Emitir, recibir, rechazar y cancelar transferencias | | | ✔ | | RF-044 a RF-046, RF-151 |
| Clientes, límites de crédito y cuotas de los VO | | | ✔ | | RF-064, RF-072, RF-132 |
| Autorizar con PIN (descuento fuera de cuota, exceso de crédito, anulación, reembolso en efectivo, retiro, pago por verificar), nunca la propia operación | | ✔ (presente) | ✔ | | RF-066, RF-074, RF-081, RF-092, RF-126, RF-141, RF-113 |
| Forzar el cierre de un turno ajeno | | | ✔ | | RF-115 |
| Corregir y reenviar comprobantes rechazados | | ✔ | ✔ | | RF-104 |
| Abrir turno, vender, cobrar, aplicar descuentos de su cuota, traspasar ventas | | | | ✔ | RF-053 a RF-080 |
| Iniciar devoluciones y anulaciones, movimientos de caja, cobros de cuenta corriente | | | | ✔ | RF-081 a RF-091, RF-128 |
| Corte X de su turno | | | | ✔ | RF-094 |
| Corte Z (sin turno abierto en esa caja) | | | ✔ | ✔ | RF-095 |
| Dashboard estratégico | | ✔ | | | RF-110 |
| Dashboard operativo e informe diario | | ✔ | ✔ (su sucursal) | | RF-109, RF-111 |

---

## 6. Fuera de alcance

| Exclusión | Por qué |
| :-- | :-- |
| Fidelización: puntos, club de beneficios, clientes VIP | Excluido por la v8.5. No forma parte del núcleo de venta y control. |
| Omnicanalidad o e-commerce (WooCommerce, Magento, Mercado Libre) | Excluido por la v8.5. La sincronización externa de stock y pedidos multiplica la complejidad. |
| Multimoneda y tipos de cambio | Excluido por la v8.5. Cada comercio opera en una única moneda. |
| Operación offline de catálogo o de ventas | La reserva concurrente exige conexión. Solo la emisión fiscal admite cola. |
| Corte Z automático sin declaración física | Rompe el principio de cierre ciego (RN-05). |
| Anulación automática de ventas rechazadas fiscalmente | Descartada en D-3. La regularización es manual. |
| Reintegro a elección (efectivo o Nota de Crédito) al margen del pago original | Descartado en D-4. |
| Recalcular el precio de ítems ya agregados al carrito | Descartado en S-1. El precio se fija al agregar el ítem. |
| Combos pre-armados con stock propio | Descartados en S-3. El stock del combo se deriva de sus componentes. |
| Traspaso de ventas entre sucursales o con usuarios de otro rol | Descartado en S-6. |
| Transferencias de stock entre comercios distintos | Contradicen la segregación estricta (RN-01). |
| Contingencia de la pasarela de pagos (cobro sin respuesta de la pasarela) | La constitución solo admite cola para la emisión fiscal (Const. 2). Ver D-20 y D-40. |
| Anulación parcial de una venta | Se tramita como devolución (D-27). |
| Saldo a favor del cliente en cuenta corriente | Descartado en D-23 y D-29. El saldo nunca queda negativo. |
| Reinicio de la cuota de descuento en cada turno | Reemplazado por el reinicio por fecha de jornada (D-32). |
| Autoautorización con PIN | Prohibida por Const. 13 (D-8). |

---

## 7. Criterios de finalización

El spec se considera implementado cuando se cumplen **todas** estas condiciones:

1. **Trazabilidad completa:** cada RF de la sección 5 tiene al menos una prueba de aceptación automatizada que lo verifica, y la tabla de trazabilidad RF ↔ prueba está completa.
2. **Aislamiento probado:** existen pruebas que intentan leer y modificar cada tipo de recurso desde otro comercio y con roles sin permiso según la matriz de §5.18 (incluido el SA sobre datos comerciales y sobre la auditoría comercial), y todas se rechazan. Los tipos de recurso son: comercio, sucursal, caja, usuario, producto, categoría, combo, lista de precios, promoción, proveedor, compra, pago a proveedor, inventario, transferencia, cliente, cuenta corriente, venta, pago, devolución, Nota de Crédito, comprobante fiscal, turno, movimiento de caja, cierre, auditoría comercial y ticket de soporte. Las notificaciones de stock en tiempo real no llegan a otras sucursales ni a otros comercios (RF-001 a RF-004, RF-022, RF-061, RF-114).
3. **Segregación de funciones:** una autorización con el PIN o la credencial del propio solicitante se rechaza, incluso si tiene el rol AS o AC (RF-113, RF-141).
4. **Concurrencia probada:** una prueba con N sesiones simultáneas que compiten por M < N unidades termina con exactamente M unidades vendidas o reservadas y nunca deja stock negativo. Hay pruebas equivalentes para el saldo de cuota, el límite de crédito, la cantidad devolvible, la apertura de turno en una caja y la recepción de una transferencia (RF-055 a RF-057, RF-152).
5. **Expiración de reservas:** un carrito inactivo más allá del tiempo configurado devuelve sus reservas al stock disponible, salvo que tenga pagos aprobados o por verificar. Un traspaso no aceptado vuelve al emisor (RF-059, RF-079).
6. **Cálculos verificados:** hay casos de prueba con resultados esperados conocidos para precios por regla, recálculo por cambio de costo, desglose de IVA incluido, orden de aplicación de promociones y descuentos, elección de la mejor promoción, consumo y reinicio de la cuota, prorrateo, redondeo, pagos mixtos con recargo por fracción, stock e IVA de combos, límite y cobros de crédito, devolución proporcional (incluida la de una venta a crédito ya pagada) y arqueo (RF-030, RF-032, RF-050, RF-052, RF-065 a RF-069, RF-085, RF-086, RF-094, RF-095, RF-120 a RF-124, RF-128).
7. **Contingencia fiscal de punta a punta:** se simula la caída del servicio, se vende con CAEA, el servicio se restablece y la cola se informa en orden por punto de venta. También se simula la caída sin un CAEA vigente, que emite un ticket no fiscal y alerta al AC (RF-160, RF-161). Un comercio sin el módulo de facturación vende sin generar ningún pedido fiscal. Se prueban los tres modos de la política por venta, la factura A obligatoria, la facturación posterior dentro y fuera de plazo, y el rechazo de la desactivación con comprobantes pendientes (RF-163 a RF-169). También se simulan un rechazo, que genera la alerta, no frena la cola y permite reenviar, una Nota de Crédito que espera a su original y el vencimiento del plazo, que genera la alerta crítica (RF-101 a RF-106, RF-139).
8. **Cierres:** un Corte X con ventas en curso se rechaza, un Corte Z con turnos abiertos se rechaza, el Corte Z exige su propia declaración ciega, el vencimiento de sesión no cierra el turno, una caja con un Z pendiente no abre una nueva jornada, el VO nunca ve el saldo teórico durante la declaración, un retiro sin PIN de un AS se rechaza y su resultado no se le revela al VO, y un AS puede forzar el cierre de un turno abandonado, que queda marcado como forzado (RF-092, RF-093, RF-096, RF-097, RF-112, RF-115).
9. **Retención:** no existe ninguna ruta funcional que elimine físicamente registros de operaciones o de auditoría, los carritos descartados se conservan, las bajas con dependencias se rechazan y toda acción crítica deja su registro con el estado anterior y el posterior (RF-018 a RF-021, RF-116, RF-148).
10. **Fallas de integraciones:** las fallas de impresora, de pasarela de pago o del servicio fiscal nunca hacen que una venta figure como exitosa cuando no lo es. Se prueban el rechazo parcial en un pago mixto, el timeout de la pasarela, la pérdida de conexión durante el cobro, la aprobación tardía, una caída entre la confirmación y el pedido fiscal, y el rechazo fiscal en línea (RF-075, RF-076, RF-100, RF-103, RF-106, RF-108, RF-125 a RF-127).
11. **Supuestos respetados:** hay pruebas de que el precio y la promoción fijados al agregar un ítem no cambian aunque cambien la lista o la vigencia, y de que un exceso de crédito solo se confirma con el PIN de un AS o un AC y queda en la auditoría (RF-030, RF-031, RF-074, RF-143).
12. **Tiempo real:** un cambio de stock se refleja en los demás POS de la sucursal en 2 segundos como máximo (RF-061).
13. **Calidad:** el código pasa formato, lint y compilación o verificación de tipos, según la constitución del proyecto.
