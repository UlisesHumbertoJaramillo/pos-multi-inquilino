# Tareas — Sistema POS Multi-Inquilino

**Deriva de:** [plan.md](plan.md) y [spec.md](spec.md) v1.1 (RF-001 a RF-169).
**Regla de tamaño:** cada tarea se completa en menos de 30 minutos. Si una tarea crece, se divide antes de empezarla.
**Orden:** el orden de la lista respeta las dependencias. "Dep" indica las tareas que tienen que estar terminadas antes.

---

## Cómo comprobar los avances en localhost

`npm run dev` levanta todo el entorno local:

| Servicio | Dirección | Para qué |
| :-- | :-- | :-- |
| Frontend (POS y Administración) | https://localhost:5173/pos y https://localhost:5173/admin | Probar las pantallas |
| API | https://localhost:3000 | Backend |
| Documentación de la API | https://localhost:3000/docs | Probar cada endpoint desde el navegador, antes de que exista su pantalla |
| Correos simulados | Consola del backend | Ver los correos de validación y recuperación, con sus enlaces. Solo en desarrollo |
| Simuladores de ARCA y Mercado Pago | https://localhost:3000/dev/simuladores | Elegir si el servicio responde bien, rechaza, demora o se cae |
| PostgreSQL (instalado en Windows, como servicio) | localhost:5432 | Inspeccionar datos. Bases `pos_dev` (desarrollo) y `pos_test` (pruebas) |

- El proyecto **no usa Docker**. PostgreSQL 16 se instala directamente en Windows y queda corriendo como servicio, así que `npm run dev` no lo levanta: solo verifica que responda.
- `npm run db:setup` se ejecuta **una sola vez** por equipo. Crea los roles y las dos bases (ver T-003).
- `npm run db:reset` deja la base vacía con las migraciones aplicadas, y `npm run db:seed` carga los datos de demostración: un SA, el comercio "Demo" con dos sucursales y una caja en cada una, y usuarios AC, AS y VO con contraseñas y PIN documentados en el README.
- Las rutas `/dev/*` y `/docs` existen **solo en desarrollo**. Una prueba verifica que no se registren en producción (Const. 16).
- Las tareas marcadas **[Localhost]** son puntos de control: un guion manual que se ejecuta en el navegador al terminar cada fase.

**Definición de hecho común a todas las tareas** (Const. 8 y 9): `npm run verify` pasa (formato, lint, tipos, reglas de arquitectura y pruebas). Toda regla de negocio nueva tiene su prueba, y cada prueba se etiqueta con los RF que verifica, por ejemplo `[RF-055]`.

---

## Fase 0 — Fundaciones

- [x] **T-001** · Crear el monorepo con workspaces `apps/backend`, `apps/frontend` y `packages/contracts`, todos en TypeScript estricto. · RF: — · Dep: —
  - Hecho cuando: `npm install` y `npm run typecheck` terminan sin errores en los tres paquetes.
- [x] **T-002** · Configurar ESLint y Prettier compartidos, con los scripts `lint`, `format` y `format:check`. · RF: — (Const. 8) · Dep: T-001
  - Hecho cuando: `npm run lint` y `npm run format:check` pasan, y un error introducido a propósito los hace fallar.
- [x] **T-003** · Instalar PostgreSQL 16 en Windows y crear el script `npm run db:setup`, que con el superusuario `postgres` crea los roles `pos_owner` (dueño, para migraciones) y `pos_app` (aplicación, sin privilegios de superusuario ni para saltear la seguridad a nivel de fila) y las bases `pos_dev` y `pos_test`. Agregar `.env.example` sin secretos y `.env` al `.gitignore`. · RF: — (Const. 17) · Dep: T-001
  - Hecho cuando: después de `npm run db:setup`, `psql -U pos_app -d pos_dev` conecta en localhost:5432, y `pos_app` no es dueño de la base.
- [x] **T-004** · Generar certificados locales con mkcert para servir backend y frontend por HTTPS en desarrollo. · RF: — (Const. 17) · Dep: T-001
  - Hecho cuando: el navegador abre https://localhost sin advertencias de certificado.
- [x] **T-005** · Crear el backend Express mínimo con `GET /salud`, que responde solo el estado, sin versiones ni datos internos. · RF: — (Const. 16) · Dep: T-004
  - Hecho cuando: https://localhost:3000/salud responde 200 con `{"estado":"ok"}` y nada más.
- [x] **T-006** · Crear el frontend React (Vite) con las rutas vacías `/pos` y `/admin` y un cliente HTTP base. · RF: — · Dep: T-004
  - Hecho cuando: https://localhost:5173/pos y https://localhost:5173/admin cargan y muestran su título.
- [x] **T-007** · Crear el script `npm run dev`, que verifica que PostgreSQL responda y levanta el backend y el frontend con un solo comando. · RF: — · Dep: T-003, T-005, T-006
  - Hecho cuando: con un solo comando responden el backend y el frontend, y con el servicio de PostgreSQL detenido el script avisa claramente qué falta.
- [x] **T-008** · Configurar la herramienta de migraciones, que se conecta como `pos_owner`, con los scripts `db:migrate` y `db:reset` (este último vacía el esquema de `pos_dev` y vuelve a aplicar las migraciones). · RF: — · Dep: T-003
  - Hecho cuando: `npm run db:reset` deja `pos_dev` con la tabla de control de migraciones.
- [x] **T-009** · Configurar los privilegios por defecto: `pos_app` recibe SELECT, INSERT y UPDATE sobre las tablas que crea `pos_owner`, pero nunca DELETE. · RF: RF-021 · Dep: T-008
  - Hecho cuando: una prueba de integración intenta un DELETE con el usuario de aplicación y falla.
- [x] **T-010** · Configurar Vitest en backend y frontend. Las pruebas de integración usan la base local `pos_test`: al iniciar la corrida se recrea su esquema con las migraciones, y entre pruebas se vacían las tablas con una conexión de `pos_owner` que solo existe en el arnés de pruebas. · RF: — (Const. 9) · Dep: T-008
  - Hecho cuando: `npm test` corre una prueba unitaria y una de integración, ambas pasan, y la corrida nunca toca `pos_dev`.
- [x] **T-011** · Crear la estructura hexagonal del backend (`dominio`, `aplicacion` y `adaptadores` por módulo) y la regla de dependencias `lint:arch`. · RF: — (Const. 14) · Dep: T-002
  - Hecho cuando: importar Express o el cliente de PostgreSQL desde una carpeta `dominio` hace fallar `npm run lint:arch`.
- [x] **T-012** · Agregar a `lint:arch` la regla de que el frontend solo puede importar `packages/contracts`. · RF: — (Const. 15) · Dep: T-011
  - Hecho cuando: un import de `apps/backend` desde el frontend hace fallar `npm run lint:arch`.
- [x] **T-013** · Crear la especificación OpenAPI base en `packages/contracts`, con generación de tipos y Swagger UI en `/docs` solo en desarrollo. · RF: — (AD-21) · Dep: T-005
  - Hecho cuando: https://localhost:3000/docs muestra `/salud`, y los tipos generados compilan en el frontend.
- [x] **T-014** · Validar en las pruebas que las respuestas de la API cumplan la especificación OpenAPI. · RF: — (AD-21) · Dep: T-010, T-013
  - Hecho cuando: si `/salud` devuelve un campo no documentado, la prueba falla.
- [x] **T-015** · Implementar el manejo uniforme de errores, sin detalles internos, y un logger que redacta contraseñas, PIN, tokens y datos de pago. · RF: — (Const. 17) · Dep: T-005
  - Hecho cuando: un error forzado responde `{codigo, mensaje}` sin traza, y una prueba verifica que un token no aparece en el log.
- [x] **T-016** · Configurar cabeceras de seguridad, CORS limitado al origen del frontend y límite de tamaño de las solicitudes. · RF: — (Const. 17) · Dep: T-005
  - Hecho cuando: `curl -I` muestra las cabeceras de seguridad y una solicitud desde un origen no permitido se rechaza.
- [x] **T-017** · Crear `docs/arquitectura` con los diagramas de contexto y de contenedores, el catálogo de puertos y adaptadores (vacío) y las decisiones AD-01 a AD-26. · RF: — (Const. 14) · Dep: T-011
  - Hecho cuando: los archivos existen y el README los enlaza.
- [x] **T-018** · Escribir el script de trazabilidad, que lee las etiquetas `[RF-xxx]` de las pruebas y genera `sdd/trazabilidad.md`, con un modo estricto que falla si falta algún RF. · RF: — (criterio 1) · Dep: T-010
  - Hecho cuando: genera una tabla de 169 filas, la mayoría todavía vacía.
- [x] **T-019** · Crear `npm run verify` (formato, lint, tipos, arquitectura, pruebas, auditoría de dependencias y búsqueda de secretos) y conectarlo a CI. · RF: — (Const. 8, 17) · Dep: T-002, T-010, T-011, T-018
  - Hecho cuando: `npm run verify` pasa, y un secreto falso agregado a un archivo lo hace fallar.
- [x] **T-020** · Implementar los puertos transversales `Reloj` (con versión simulada para pruebas), `GeneradorDeId` y `UnidadDeTrabajo` (transacción en PostgreSQL). · RF: — · Dep: T-010, T-011
  - Hecho cuando: una prueba de integración verifica que un rollback de la unidad de trabajo deshace una inserción.
- [x] **T-021** · Implementar los trabajos programados: tabla `trabajo_programado`, worker con bloqueo que omite filas tomadas y el script `npm run worker`. · RF: — (AD-19) · Dep: T-020
  - Hecho cuando: una prueba con dos workers verifica que el mismo trabajo no se ejecuta dos veces.
- [x] **T-022** · Implementar el outbox: tabla y despachador. · RF: — (AD-07) · Dep: T-021
  - Hecho cuando: un evento escrito en una transacción revertida no se despacha, y uno escrito en una transacción confirmada sí.
- [x] **T-023** · Implementar la base reutilizable de bajas lógicas (`is_active`, `desactivado_en`, `desactivado_por`), con filtro de activos por defecto en los repositorios. · RF: RF-020, RF-021 · Dep: T-020
  - Hecho cuando: una prueba da de baja una entidad de ejemplo, que deja de listarse pero sigue en la base con su historial.

## Fase 1 — Identidad, aislamiento y permisos

- [x] **T-024** · Crear las migraciones `comercio` (versión básica), `usuario` y `usuario_rol`, con la restricción de que el rol SA no se combine con roles de comercio. · RF: RF-012 · Dep: T-009
  - Hecho cuando: una prueba intenta asignarle a un SA el rol AC y la base lo rechaza.
- [x] **T-025** · Implementar el puerto `HashDeSecretos` con argon2, para contraseñas y PIN. · RF: RF-156 · Dep: T-011
  - Hecho cuando: una prueba verifica que el hash no contiene el secreto y que la verificación acepta el correcto y rechaza otro.
- [x] **T-026** · Escribir el seed de desarrollo: SA, comercio Demo y usuarios AC, AS y VO con contraseñas documentadas. · RF: — · Dep: T-024, T-025
  - Hecho cuando: `npm run db:seed` carga los usuarios y el README lista sus credenciales.
- [x] **T-027** · Implementar el inicio de sesión: token de acceso JWT corto y token de renovación opaco guardado con hash. · RF: RF-005 · Dep: T-026
  - Hecho cuando: en /docs, `POST /auth/login` con el VO demo devuelve los tokens, y una contraseña errónea devuelve 401 con mensaje genérico.
- [x] **T-028** · Rechazar el inicio de sesión de una cuenta con el correo sin validar, indicando que falta la validación. · RF: RF-006 · Dep: T-027
  - Hecho cuando: una prueba con un usuario sin validar recibe el error específico.
- [x] **T-029** · Implementar el puerto `EnvioDeCorreo` con un adaptador de consola, más la validación de correo y su reenvío con token de un solo uso. El adaptador escribe el correo en la consola, separado del logger de la aplicación, y el backend se niega a arrancar en modo producción si está configurado (Const. 17). · RF: RF-006 · Dep: T-028
  - Hecho cuando: el correo con su enlace aparece en la consola del backend, el enlace valida la cuenta una sola vez y una prueba verifica que el arranque en producción con este adaptador falla.
- [x] **T-030** · Implementar la recuperación de contraseña: misma respuesta exista o no el correo, token de un solo uso con vencimiento y restablecimiento. · RF: RF-007, RF-008 · Dep: T-029
  - Hecho cuando: hay pruebas de token vencido y de token ya usado, y el correo aparece en la consola del backend.
- [x] **T-031** · Implementar el middleware de autenticación con la lista blanca de AD-22, y una prueba que recorre todas las rutas registradas. · RF: — (Const. 16) · Dep: T-027
  - Hecho cuando: la prueba verifica que toda ruta fuera de la lista blanca responde 401 sin token, y que `/dev/*` y `/docs` no existen en modo producción.
- [x] **T-032** · Implementar la renovación de tokens, el cierre de sesión y la revocación. · RF: RF-009 · Dep: T-031
  - Hecho cuando: un token de renovación revocado responde 401.
- [x] **T-033** · Cerrar la sesión por inactividad según el parámetro configurado, sin tocar turnos ni carritos. · RF: RF-009 · Dep: T-032
  - Hecho cuando: una prueba con reloj simulado verifica que la renovación falla tras la inactividad.
- [x] **T-034** · Bloquear la contraseña 15 minutos tras 5 intentos fallidos seguidos y limitar la frecuencia de los endpoints públicos. · RF: RF-145 · Dep: T-027
  - Hecho cuando: el sexto intento responde "bloqueado" y, pasados 15 minutos simulados, se puede ingresar.
- [x] **T-035** · Armar el contexto de seguridad (usuario, comercio tomado del token, rol activo, sucursales). · RF: RF-001 · Dep: T-031
  - Hecho cuando: una prueba envía otro `tenant_id` como parámetro y se ignora.
- [x] **T-036** · Implementar el rol activo: último usado al ingresar, elección en el primer ingreso y cambio sin cerrar sesión. · RF: RF-005, RF-010, RF-011 · Dep: T-035
  - Hecho cuando: una prueba cambia de rol y verifica que una acción del rol anterior se rechaza de inmediato.
- [x] **T-037** · Implementar la política de permisos: tabla declarativa de la matriz §5.18 y verificación de ámbito. · RF: RF-004 · Dep: T-035
  - Hecho cuando: una prueba verifica que una acción que no está en la tabla queda denegada.
- [x] **T-038** · Crear el generador de pruebas de la matriz (acción × rol × ámbito), que se amplía en cada módulo. · RF: RF-004 · Dep: T-037
  - Hecho cuando: genera y corre las pruebas de las acciones existentes.
- [x] **T-039** · Implementar la seguridad a nivel de fila: la unidad de trabajo fija el comercio por transacción, más una política plantilla para las tablas comerciales. · RF: RF-001 · Dep: T-020, T-035
  - Hecho cuando: una prueba verifica que una consulta sin comercio fijado devuelve 0 filas.
- [x] **T-040** · Crear la tabla `auditoria_tecnica` y la respuesta uniforme ante un recurso de otro comercio, que se responde como inexistente y se registra. · RF: RF-002 · Dep: T-039
  - Hecho cuando: una prueba con un usuario del comercio B pidiendo un recurso del A recibe 404 y el intento queda en la auditoría técnica.
- [x] **T-041** · Crear la auditoría comercial: tabla de solo inserción, sin UPDATE ni DELETE para la aplicación, escrita por el puerto `RegistroDeAuditoria` en la misma transacción. · RF: RF-018, RF-019 · Dep: T-039
  - Hecho cuando: una prueba verifica que un UPDATE sobre la auditoría falla y que la auditoría se revierte junto con su transacción.
- [x] **T-042** · Rechazar en la política todo caso de uso comercial invocado por un SA. · RF: RF-003 · Dep: T-037
  - Hecho cuando: la matriz generada incluye al SA y todas sus acciones comerciales se rechazan.
- [x] **T-043** · Crear la tabla `credencial_autorizacion` y el endpoint para que un AS o un AC fije su PIN. · RF: RF-141 · Dep: T-025, T-037
  - Hecho cuando: el PIN queda guardado con hash y un VO no puede fijar uno.
- [x] **T-044** · Implementar `AutorizarOperacion`: autorización de un solo uso ligada a la operación y al solicitante, que acepta a un AS de la sucursal o a un AC presente y rechaza la autoautorización. · RF: RF-113, RF-141 · Dep: T-043
  - Hecho cuando: hay pruebas de autoautorización rechazada, de reutilización rechazada y de un AC aceptado.
- [x] **T-045** · Bloquear el PIN 15 minutos tras 5 intentos fallidos seguidos y registrarlo en la auditoría técnica. · RF: RF-145 · Dep: T-044
  - Hecho cuando: el sexto PIN erróneo queda bloqueado. La alerta al AC se conecta en T-209.
- [x] **T-046** · Frontend: pantalla de inicio de sesión, selector de rol, manejo de tokens y renovación, y cierre de sesión. · RF: RF-005, RF-010 · Dep: T-036
  - Hecho cuando: en https://localhost:5173 se ingresa con el VO demo, se ve el rol activo y se puede salir.
- [x] **T-047** · Frontend: validación de correo y recuperación de contraseña. · RF: RF-006, RF-007 · Dep: T-046, T-030
  - Hecho cuando: el flujo se completa en el navegador usando los enlaces que muestra la consola del backend.
- [x] **T-048** · **[Localhost]** Guion de la Fase 1. · RF: — · Dep: T-047
  - Hecho cuando: (1) el login funciona con cada rol demo, (2) el cambio de rol cambia el menú, (3) 5 contraseñas erróneas bloquean la cuenta, (4) el correo de recuperación aparece en la consola del backend, (5) sin token, cualquier ruta de /docs responde 401.

## Fase 2 — Plataforma (Super Administrador)

- [x] **T-049** · Completar la migración de `comercio`: moneda, zona horaria, estado, módulo de facturación y `tiene_operaciones`, con el bloqueo del cambio de moneda. · RF: RF-013, RF-134 · Dep: T-024
  - Hecho cuando: una prueba verifica que cambiar la moneda de un comercio con operaciones se rechaza.
- [x] **T-050** · Casos de uso del SA para dar de alta y modificar comercios. · RF: RF-013 · Dep: T-049, T-042
  - Hecho cuando: en /docs, el SA crea un comercio y el alta queda en la auditoría técnica.
- [x] **T-051** · Crear otros SA y el primer AC de un comercio, ambos con validación de correo. · RF: RF-015 · Dep: T-050, T-029
  - Hecho cuando: el correo de validación del AC nuevo aparece en la consola del backend.
- [x] **T-052** · Suspender y reactivar comercios, revocando los tokens y publicando el evento de suspensión. · RF: RF-014, RF-146 · Dep: T-050, T-032, T-022
  - Hecho cuando: el VO del comercio suspendido recibe 401 en su siguiente solicitud. El descarte de carritos se conecta en T-150.
- [x] **T-053** · Crear el puerto `ConsultaPendientesFiscales` (devuelve "sin pendientes" hasta la Fase 12) y la baja lógica de comercio. · RF: RF-147 · Dep: T-052
  - Hecho cuando: hay pruebas de la baja con el puerto simulado devolviendo pendientes y sin pendientes.
- [x] **T-054** · Activar y desactivar el módulo de facturación de un comercio, validando los pendientes con el puerto de T-053. · RF: RF-163, RF-164 · Dep: T-053
  - Hecho cuando: hay pruebas de activación, de desactivación y de rechazo cuando hay pendientes simulados.
- [x] **T-055** · Tickets de soporte: los AC y AS los crean y el SA los sigue y responde. · RF: RF-017 · Dep: T-050
  - Hecho cuando: en /docs, un AC crea un ticket y el SA lo responde, y un VO no puede crearlo.
- [x] **T-056** · Consulta de la auditoría técnica para el SA. · RF: RF-022 · Dep: T-040
  - Hecho cuando: una prueba de esquema verifica que la respuesta no tiene campos comerciales.
- [x] **T-057** · Panel técnico: errores 5xx recientes y estado de los workers y del outbox. · RF: RF-016 · Dep: T-021, T-022
  - Hecho cuando: un error forzado aparece en el panel y el SA lo ve en /docs. Los periféricos se suman en T-241.
- [x] **T-058** · Frontend del SA: comercios (alta, suspensión, módulo de facturación), cuentas, tickets, auditoría técnica y panel. · RF: RF-013, RF-016, RF-017, RF-022, RF-163 · Dep: T-051 a T-057, T-046
  - Hecho cuando: en https://localhost:5173/admin, logueado como SA, se crea un comercio y se activa su módulo de facturación.
- [x] **T-059** · Sumar las acciones de plataforma al generador de la matriz. · RF: RF-003, RF-004 · Dep: T-058, T-038
  - Hecho cuando: las pruebas generadas de plataforma pasan y un AC no puede ejecutar ninguna acción del SA.

## Fase 3 — Organización

- [x] **T-060** · Crear las migraciones `sucursal`, `caja`, `parametro_comercio` y `metodo_pago`, con seguridad a nivel de fila. · RF: RF-001 · Dep: T-039, T-049
  - Hecho cuando: una prueba verifica que el comercio B no ve las sucursales del A.
- [x] **T-061** · ABM de sucursales para el AC. · RF: RF-023 · Dep: T-060, T-023
  - Hecho cuando: en /docs, el AC crea, modifica y da de baja una sucursal.
- [x] **T-062** · Alta de cajas y asignación a una sucursal. · RF: RF-024 · Dep: T-061
  - Hecho cuando: en /docs, el AC crea una caja en una sucursal de su comercio y no puede crearla en una ajena.
- [x] **T-063** · Crear el puerto `ConsultaDependencias` para las bajas (simulado hasta las Fases 9 y 10) y rechazar la baja de una sucursal o caja con dependencias. · RF: RF-025 · Dep: T-062
  - Hecho cuando: hay pruebas con dependencias simuladas que verifican que el rechazo indica qué impide la baja.
- [x] **T-064** · Usuarios del comercio: alta, roles y sucursales asignadas por el AC. · RF: RF-026 · Dep: T-061, T-029
  - Hecho cuando: el AC crea un VO para una sucursal y el correo de validación del VO aparece en la consola del backend.
- [x] **T-065** · Parámetros del comercio dentro de los márgenes de la plataforma. · RF: RF-135 · Dep: T-060
  - Hecho cuando: un valor fuera de los márgenes se rechaza.
- [x] **T-066** · Métodos de pago con recargo o descuento. · RF: RF-135 · Dep: T-060
  - Hecho cuando: el AC crea "Tarjeta crédito +10%" y "Efectivo −5%", y aparecen en /docs.
- [x] **T-067** · Endpoint de la jerarquía Comercio > Sucursales > Cajas. · RF: RF-027 · Dep: T-062
  - Hecho cuando: devuelve el árbol del comercio demo.
- [x] **T-068** · Actualizar el seed: dos sucursales, una caja cada una, métodos de pago y parámetros. · RF: — · Dep: T-061 a T-066
  - Hecho cuando: después de `npm run db:seed`, el AC demo ve la estructura completa.
- [x] **T-069** · Frontend del AC: estructura en cascada, sucursales y cajas. · RF: RF-023, RF-024, RF-027 · Dep: T-067, T-046
  - Hecho cuando: en /admin se ve el árbol y se crea una caja desde la pantalla.
- [x] **T-070** · Frontend del AC: usuarios, parámetros y métodos de pago. · RF: RF-026, RF-135 · Dep: T-069
  - Hecho cuando: desde /admin se crea un VO y se modifica un recargo.
- [x] **T-071** · Sumar las acciones de organización al generador de la matriz, incluido el acceso cruzado entre comercios. · RF: RF-001, RF-004 · Dep: T-070
  - Hecho cuando: las pruebas generadas pasan.

## Fase 4 — Catálogo y precios

- [x] **T-072** · Crear las migraciones `categoria`, `producto` (con código de barras único entre los activos), `combo_componente`, `lista_precio`, `precio_lista` e `historial_precio`. · RF: RF-131 · Dep: T-060
  - Hecho cuando: las migraciones aplican y la seguridad a nivel de fila cubre las tablas nuevas.
- [x] **T-073** · ABM de categorías con tasa de IVA. · RF: RF-029 · Dep: T-072
  - Hecho cuando: en /docs, el AC crea "Bebidas 21%" y "Libros 0%".
- [x] **T-074** · ABM de productos con imagen. · RF: RF-130, RF-159 · Dep: T-073
  - Hecho cuando: en /docs se crea un producto con imagen y la imagen se puede descargar.
- [x] **T-075** · Rechazar un código de barras repetido entre productos activos. · RF: RF-131 · Dep: T-074
  - Hecho cuando: una prueba verifica que repetir el código se rechaza, y que reutilizarlo tras la baja del producto anterior se permite.
- [x] **T-076** · Dominio: reglas de lista (precio fijo, porcentaje sobre costo y por grupo), con una tabla de casos esperados. · RF: RF-028 · Dep: T-011
  - Hecho cuando: pasan las pruebas parametrizadas de las tres reglas.
- [x] **T-077** · ABM de listas de precios y materialización de `precio_lista`. · RF: RF-028 · Dep: T-076, T-074
  - Hecho cuando: al crear una lista "costo + 40%", cada producto tiene su precio calculado.
- [x] **T-078** · Recalcular los precios ante un cambio de costo o de regla y registrar el historial. · RF: RF-032 · Dep: T-077
  - Hecho cuando: una prueba cambia el costo de un producto y su precio de lista cambia, con la fila de historial correspondiente.
- [x] **T-079** · Asignar la lista activa de cada sucursal. · RF: RF-119 · Dep: T-077, T-061
  - Hecho cuando: cada sucursal demo tiene su lista y una sucursal no puede tener dos.
- [x] **T-080** · Definir combos con sus componentes y su precio único. · RF: RF-049 · Dep: T-074
  - Hecho cuando: se crea un combo de dos productos y no se puede usar un combo como componente.
- [x] **T-081** · Dominio: disponibilidad de un combo como el mínimo, redondeado hacia abajo, del stock de cada componente dividido por la cantidad que requiere. · RF: RF-052 · Dep: T-011
  - Hecho cuando: pasa una tabla de casos con componentes que requieren distintas cantidades.
- [x] **T-082** · Dejar no disponible un combo cuando se da de baja uno de sus componentes. · RF: RF-149 · Dep: T-080, T-023
  - Hecho cuando: una prueba da de baja un componente y el combo deja de poder venderse.
- [x] **T-083** · Vista imprimible de una lista de precios. · RF: RF-033 · Dep: T-077
  - Hecho cuando: https://localhost:5173/admin/listas/:id/imprimir abre una vista lista para imprimir.
- [x] **T-084** · Actualizar el seed con categorías, unos 20 productos con código de barras, dos listas y un combo. · RF: — · Dep: T-079, T-080
  - Hecho cuando: el AC demo ve el catálogo completo.
- [x] **T-085** · Frontend del AC: categorías y productos. · RF: RF-029, RF-130 · Dep: T-084, T-070
  - Hecho cuando: desde /admin se crea un producto con imagen.
- [x] **T-086** · Frontend del AC: listas de precios, asignación a sucursales, combos e impresión. · RF: RF-028, RF-049, RF-119 · Dep: T-085, T-083
  - Hecho cuando: desde /admin se cambia la regla de una lista y se ven los precios recalculados.
- [x] **T-087** · Sumar las acciones de catálogo al generador de la matriz. · RF: RF-004 · Dep: T-086
  - Hecho cuando: las pruebas generadas pasan y un AS no puede modificar precios.

## Fase 5 — Inventario

- [x] **T-088** · Crear las migraciones `inventario` (CHECK de los cuatro saldos ≥ 0), `movimiento_stock` (solo inserción), `transferencia` y `transferencia_item`, más la tabla base `alerta`. · RF: RF-039 · Dep: T-072
  - Hecho cuando: una prueba que intenta dejar un saldo negativo falla en la base.
- [x] **T-089** · Servicio de inventario con operaciones atómicas por actualización condicional (ingresar, reservar, liberar, consumir, pasar a revisión, pasar a tránsito), cada una con su movimiento. · RF: RF-039, RF-152 · Dep: T-088, T-020
  - Hecho cuando: hay pruebas de integración de cada operación, y reservar más de lo disponible no afecta ninguna fila.
- [x] **T-090** · Ajuste de stock con motivo, umbral mínimo y rechazo de saldos negativos. · RF: RF-040, RF-043 · Dep: T-089
  - Hecho cuando: en /docs, el AS ajusta el stock de su sucursal, y un ajuste que deja el saldo negativo se rechaza.
- [x] **T-091** · Mermas por rotura, vencimiento o pérdida, sin movimiento de dinero. · RF: RF-042, RF-043 · Dep: T-089
  - Hecho cuando: la merma descuenta stock, deja su movimiento con motivo y no crea movimientos de caja.
- [x] **T-092** · Alerta de stock mínimo, una vez por cruce del umbral. · RF: RF-041 · Dep: T-090
  - Hecho cuando: una prueba baja dos veces el stock por debajo del umbral y genera una sola alerta, y la alerta se rearma al reponer.
- [x] **T-093** · Emitir una transferencia: el stock pasa del disponible al tránsito, solo entre sucursales del mismo comercio. · RF: RF-044, RF-047 · Dep: T-089
  - Hecho cuando: una transferencia a una sucursal de otro comercio se rechaza.
- [x] **T-094** · Recibir una transferencia: el faltante va a merma con alerta a los dos AS y no se acepta recibir de más. · RF: RF-045, RF-150 · Dep: T-093, T-092
  - Hecho cuando: hay pruebas de recepción completa, con faltante y con exceso.
- [x] **T-095** · Rechazo total o parcial y cancelación por el origen. · RF: RF-046, RF-151 · Dep: T-093
  - Hecho cuando: las cantidades rechazadas o canceladas vuelven al disponible de origen.
- [x] **T-096** · Revisión de ítems "En Revisión": reingresar al disponible o pasar a merma. · RF: RF-088 · Dep: T-089
  - Hecho cuando: una prueba pasa stock a revisión (operación directa) y el AS lo resuelve en ambos sentidos.
- [x] **T-097** · Endpoint de disponibilidad de combos sobre el stock real. · RF: RF-052 · Dep: T-081, T-089
  - Hecho cuando: en /docs, el combo demo muestra la disponibilidad que corresponde a su componente más escaso.
- [x] **T-098** · Prueba de concurrencia: N reservas en paralelo contra M < N unidades. · RF: RF-057, RF-152 · Dep: T-089
  - Hecho cuando: la prueba termina con exactamente M reservas y stock 0, repetida 50 veces sin fallas.
- [x] **T-099** · Actualizar el seed con stock inicial por sucursal y umbrales. · RF: — · Dep: T-090
  - Hecho cuando: el AS demo ve el stock de su sucursal.
- [x] **T-100** · Frontend del AS: inventario, ajustes, umbrales y mermas. · RF: RF-040, RF-042 · Dep: T-099, T-070
  - Hecho cuando: desde /admin, el AS registra una merma y ve el stock actualizado.
- [x] **T-101** · Frontend del AS: transferencias (emitir, recibir, rechazar, cancelar) y revisión. · RF: RF-044 a RF-046, RF-088 · Dep: T-100
  - Hecho cuando: una transferencia entre las dos sucursales demo se completa desde la pantalla, con un faltante.
- [x] **T-102** · Sumar las acciones de inventario al generador de la matriz. · RF: RF-004 · Dep: T-101
  - Hecho cuando: las pruebas generadas pasan y el AS de una sucursal no puede ajustar el stock de otra.
- [x] **T-103** · **[Localhost]** Guion de las Fases 2 a 5. · RF: — · Dep: T-058, T-071, T-087, T-102
  - Hecho cuando: el SA crea un comercio, su AC arma sucursales, catálogo y listas, el AS carga stock y transfiere, y el comercio Demo no ve nada del comercio nuevo.

## Fase 6 — Proveedores y compras

- [x] **T-104** · Crear las migraciones `proveedor`, `importacion_catalogo`, `compra`, `compra_item`, `recepcion_compra_item` y `pago_proveedor`. · RF: RF-034 · Dep: T-072
  - Hecho cuando: las migraciones aplican con seguridad a nivel de fila.
- [x] **T-105** · ABM de proveedores. · RF: RF-034 · Dep: T-104, T-023
  - Hecho cuando: en /docs, el AC crea un proveedor.
- [x] **T-106** · Importación de catálogo desde CSV: identifica por código de barras, aplica las filas válidas, informa las erróneas y genera un único registro de auditoría. · RF: RF-035 · Dep: T-105, T-078, T-041
  - Hecho cuando: un CSV de prueba con 2 filas inválidas importa el resto y devuelve las 2 con su motivo.
- [x] **T-107** · Registrar una compra a crédito: aumenta la deuda, actualiza el costo (y dispara el recálculo) y queda pendiente de recepción. · RF: RF-036 · Dep: T-105, T-078
  - Hecho cuando: la deuda del proveedor sube y el precio de lista del producto se recalcula.
- [x] **T-108** · Recepción de la compra en la sucursal de destino. · RF: RF-133 · Dep: T-107, T-089
  - Hecho cuando: el stock disponible sube con lo recibido y la diferencia queda registrada.
- [x] **T-109** · Pagos a proveedor con advertencia y confirmación si exceden la deuda. · RF: RF-037, RF-038 · Dep: T-107
  - Hecho cuando: un pago de más sin confirmación se rechaza y con confirmación se registra.
- [x] **T-110** · Frontend: proveedores, importación, compras, recepción y pagos. · RF: RF-034 a RF-038, RF-133 · Dep: T-106 a T-109, T-086
  - Hecho cuando: desde /admin se importa un CSV y una compra se recibe en una sucursal.
- [x] **T-111** · Sumar las acciones de proveedores al generador de la matriz. · RF: RF-004 · Dep: T-110
  - Hecho cuando: las pruebas generadas pasan.

## Fase 7 — Motor de cálculo y promociones

- [x] **T-112** · Dominio: tipo decimal y reglas de redondeo de D-17, con ajuste de la diferencia en la última línea. · RF: RF-123 · Dep: T-011
  - Hecho cuando: pasa una tabla de casos en la que la suma redondeada coincide siempre con el total.
- [x] **T-113** · Dominio: desglose del IVA incluido hacia atrás. · RF: RF-120 · Dep: T-112
  - Hecho cuando: pasa una tabla de casos con tasas de 21%, 10,5% y 0%.
- [x] **T-114** · Dominio: total de la venta (precio fijado → promoción → descuento manual) con prorrateo. · RF: RF-121 · Dep: T-112
  - Hecho cuando: pasa una tabla de casos revisada contra cálculos manuales.
- [x] **T-115** · Dominio: fracciones por medio de pago con su recargo o descuento, total a cobrar y base del IVA. · RF: RF-069, RF-122 · Dep: T-113, T-114
  - Hecho cuando: pasa una tabla de casos de pagos mixtos con recargo.
- [x] **T-116** · Dominio: validación de que el pago cubre cada fracción, y cálculo del vuelto solo en efectivo. · RF: RF-070, RF-071 · Dep: T-115
  - Hecho cuando: hay casos de pago insuficiente, de pago exacto, de vuelto en efectivo y de pago de más con tarjeta (rechazado).
- [x] **T-117** · Dominio: IVA de combos por prorrateo según el precio de lista. · RF: RF-124 · Dep: T-113
  - Hecho cuando: pasa una tabla de casos de un combo que mezcla tasas.
- [x] **T-118** · Dominio: reintegro proporcional de una devolución, incluida la de una venta a crédito ya pagada. · RF: RF-085, RF-086 · Dep: T-115
  - Hecho cuando: pasa una tabla de casos, y una devolución total devuelve exactamente lo cobrado.
- [x] **T-119** · Pruebas por propiedades del motor de cálculo. · RF: RF-121 a RF-123 · Dep: T-114 a T-118
  - Hecho cuando: con 1000 casos generados, la suma de las fracciones iguala el total y nunca queda una diferencia de redondeo.
- [x] **T-120** · Promociones: migración y ABM con tipos cerrados y vigencia. · RF: RF-048 · Dep: T-072
  - Hecho cuando: en /docs, el AC crea un 2x1 con vigencia.
- [x] **T-121** · Dominio: evaluador de promociones que elige la mejor por ítem y excluye los componentes de combos. · RF: RF-050 · Dep: T-120, T-112
  - Hecho cuando: pasa una tabla de casos con promociones superpuestas.
- [x] **T-122** · Frontend del AC: promociones. · RF: RF-048 · Dep: T-121, T-086
  - Hecho cuando: desde /admin se crea una promoción y aparece en la lista de vigentes.

## Fase 8 — Cuota de descuento

- [ ] **T-123** · Crear las migraciones `tope_cuota`, `cuota_vo` y `saldo_cuota`. · RF: RF-063 · Dep: T-060
  - Hecho cuando: las migraciones aplican y `saldo_cuota` no admite saldos negativos.
- [ ] **T-124** · El AC fija el tope del comercio y las cuotas que lo superan se recortan. · RF: RF-063, RF-142 · Dep: T-123
  - Hecho cuando: una prueba baja el tope y recorta las cuotas mayores.
- [ ] **T-125** · El AS asigna la cuota de cada VO por sucursal, sin superar el tope. · RF: RF-064 · Dep: T-124
  - Hecho cuando: una cuota mayor que el tope se rechaza.
- [ ] **T-126** · Dominio: consumo de la cuota (porcentaje por venta y saldo) y restablecimiento por fecha de jornada. · RF: RF-065, RF-067 · Dep: T-123, T-112
  - Hecho cuando: hay casos dentro de la cuota, sobre el porcentaje y sin saldo, y dos turnos con la misma fecha no restablecen el saldo.
- [ ] **T-127** · Descuento por encima de la cuota con autorización, que no consume el saldo. · RF: RF-066 · Dep: T-126, T-044
  - Hecho cuando: con autorización se aplica y el saldo queda igual. Sin autorización se rechaza.
- [ ] **T-128** · Frontend: tope del comercio (AC) y cuotas de los VO (AS). · RF: RF-063, RF-064 · Dep: T-125, T-070
  - Hecho cuando: desde /admin, el AS asigna una cuota al VO demo.

## Fase 9 — Caja

- [ ] **T-129** · Crear las migraciones `jornada`, `turno` y `movimiento_caja`, con índices únicos parciales (una jornada abierta por caja, un turno abierto por caja y por VO). · RF: RF-090, RF-154 · Dep: T-060
  - Hecho cuando: una prueba que intenta abrir dos turnos en la misma caja falla en la base.
- [ ] **T-130** · Abrir un turno: abre la jornada si corresponde (fecha en la zona horaria del comercio) y rechaza si hay una jornada anterior sin Corte Z. · RF: RF-118, RF-097, RF-090, RF-154 · Dep: T-129
  - Hecho cuando: hay pruebas de primer turno, de segundo turno de la misma jornada y de jornada anterior sin Z.
- [ ] **T-131** · Saldo inicial declarado y diferencia con el efectivo del turno anterior, con aviso al AS. · RF: RF-089 · Dep: T-130, T-092
  - Hecho cuando: una diferencia genera una alerta al AS.
- [ ] **T-132** · Restablecer la cuota en el primer turno de cada fecha de jornada. · RF: RF-067 · Dep: T-130, T-126
  - Hecho cuando: una prueba con dos turnos en la misma fecha restablece una sola vez.
- [ ] **T-133** · Ingreso manual de efectivo con motivo. · RF: RF-091 · Dep: T-130
  - Hecho cuando: en /docs, el VO registra un ingreso y queda asociado a su turno.
- [ ] **T-134** · Dominio: saldo teórico de la caja a partir del saldo inicial y los movimientos en efectivo. · RF: RF-112 · Dep: T-133
  - Hecho cuando: pasa una tabla de casos con ingresos, retiros y ventas.
- [ ] **T-135** · DTO por rol: ninguna respuesta dirigida a un VO incluye el saldo teórico. · RF: RF-093, RF-112 · Dep: T-134
  - Hecho cuando: una prueba recorre los endpoints de caja como VO y verifica que el teórico no aparece en ninguna respuesta.
- [ ] **T-136** · Retiro manual con PIN, con validación contra el teórico y el detalle del rechazo solo para el AS. · RF: RF-092 · Dep: T-135, T-044
  - Hecho cuando: un retiro excesivo se rechaza, el VO recibe un mensaje genérico y el AS ve el motivo.
- [ ] **T-137** · Corte X ciego: cierre del turno, arqueo e inmutabilidad, con verificación de ventas en curso a través de un puerto simulado hasta T-149. · RF: RF-094, RF-099, RF-117 · Dep: T-135
  - Hecho cuando: hay pruebas de faltante, sobrante y cuadrado, y un cierre confirmado no se puede modificar.
- [ ] **T-138** · Corte Z ciego: sin turnos abiertos, ejecutado por un VO o un AS sin turno en esa caja, consolidación y arqueo final. · RF: RF-095, RF-096 · Dep: T-137
  - Hecho cuando: un Z con un turno abierto se rechaza indicando qué falta, y un Z válido cierra la jornada.
- [ ] **T-139** · Cierre forzado de un turno ajeno por un AS, con su declaración ciega. · RF: RF-115 · Dep: T-137, T-044
  - Hecho cuando: el turno queda marcado como forzado, con el VO titular y el AS, y el AC recibe una alerta.
- [ ] **T-140** · Notificación de un arqueo que supera la tolerancia. · RF: RF-098 · Dep: T-137, T-065
  - Hecho cuando: con tolerancia 0 cualquier diferencia notifica al AS y al AC, y con tolerancia 100 una diferencia de 50 no notifica.
- [ ] **T-141** · Frontend POS: apertura de turno, ingresos y retiros (con el modal de PIN). · RF: RF-089, RF-091, RF-092 · Dep: T-136, T-046
  - Hecho cuando: en https://localhost:5173/pos, el VO demo abre un turno y registra un retiro autorizado por el AS demo.
- [ ] **T-142** · Frontend POS: Corte X y Corte Z ciegos. · RF: RF-093, RF-094, RF-095 · Dep: T-141, T-138
  - Hecho cuando: el VO declara sin ver el teórico y luego ve el resultado del arqueo.
- [ ] **T-143** · Frontend del AS: turnos abiertos y cierre forzado. · RF: RF-115 · Dep: T-139, T-070
  - Hecho cuando: desde /admin, el AS fuerza el cierre de un turno del VO demo.
- [ ] **T-144** · Sumar las acciones de caja al generador de la matriz. · RF: RF-004 · Dep: T-143
  - Hecho cuando: las pruebas generadas pasan y un VO no puede forzar cierres.

## Fase 10 — Ventas (POS)

- [ ] **T-145** · Crear las migraciones `venta` (tres estados), `venta_item`, `traspaso` y `autorizacion` (CHECK de solicitante distinto del autorizante). · RF: RF-153 · Dep: T-129, T-072
  - Hecho cuando: las migraciones aplican y una autorización con solicitante igual al autorizante falla en la base.
- [ ] **T-146** · Crear una venta en curso, solo con un turno abierto. · RF: RF-053 · Dep: T-145, T-130
  - Hecho cuando: un VO sin turno recibe un rechazo.
- [ ] **T-147** · Búsqueda de productos por nombre y por código de barras. · RF: RF-054 · Dep: T-074
  - Hecho cuando: en /docs, la búsqueda por código exacto y por nombre parcial devuelve resultados del comercio propio.
- [ ] **T-148** · Agregar un ítem: reserva atómica de todo o nada, con el precio fijado de la lista activa de la sucursal y el disponible informado si no alcanza. · RF: RF-030, RF-055, RF-056 · Dep: T-146, T-089, T-079
  - Hecho cuando: agregar 5 unidades con 3 disponibles se rechaza informando 3, y no reserva ninguna.
- [ ] **T-149** · Puerto `ConsultaVentasEnCurso`: conectar el rechazo del Corte X y del Corte Z con ventas en curso reales. · RF: RF-117, RF-096 · Dep: T-148, T-138
  - Hecho cuando: un Corte X con una venta en curso se rechaza indicando cuál.
- [ ] **T-150** · Consumir el evento de suspensión de comercio para descartar sus carritos y liberar las reservas. · RF: RF-146 · Dep: T-148, T-052
  - Hecho cuando: al suspender el comercio demo, sus carritos pasan a "Descartado" y el stock vuelve.
- [ ] **T-151** · Agregar un combo reservando cada componente. · RF: RF-051 · Dep: T-148, T-097
  - Hecho cuando: agregar un combo descuenta del disponible la cantidad de cada componente.
- [ ] **T-152** · Quitar un ítem y descartar una venta: liberación inmediata, y la venta descartada se conserva con su motivo. · RF: RF-058, RF-116 · Dep: T-148
  - Hecho cuando: el stock vuelve y la venta queda en "Descartada" con el motivo "manual".
- [ ] **T-153** · Mantener el precio y la promoción fijados aunque cambien la lista o la vigencia. · RF: RF-031, RF-143 · Dep: T-148, T-121
  - Hecho cuando: una prueba cambia el precio de lista con el ítem en el carrito y el ítem conserva su precio.
- [ ] **T-154** · Respuesta del carrito con subtotal, descuentos y total calculados por el motor en cada cambio. · RF: RF-060, RF-121, RF-050 · Dep: T-153, T-114
  - Hecho cuando: agregar dos unidades con un 2x1 vigente devuelve el descuento aplicado y resaltado.
- [ ] **T-155** · Descuento manual en el carrito con cuota o autorización. · RF: RF-065, RF-066 · Dep: T-154, T-127
  - Hecho cuando: un descuento dentro de la cuota se aplica sin PIN y uno mayor pide autorización.
- [ ] **T-156** · Prueba de concurrencia de la última unidad entre dos VO, a través de la API. · RF: RF-057, RF-152 · Dep: T-148
  - Hecho cuando: con 20 repeticiones, uno solo obtiene la unidad y el otro recibe "sin stock".
- [ ] **T-157** · Worker de expiración de carritos inactivos, con la excepción de los que tienen pagos aprobados o por verificar. · RF: RF-059 · Dep: T-152, T-021
  - Hecho cuando: una prueba con reloj simulado descarta el carrito vencido por "inactividad" y libera su stock.
- [ ] **T-158** · Confirmar una venta en efectivo de forma atómica: consume las reservas, registra la caja, la auditoría y la cuota y, si se factura, deja el pedido fiscal en el outbox. · RF: RF-076, RF-153 · Dep: T-154, T-133, T-022, T-041
  - Hecho cuando: una prueba que fuerza una falla a mitad de la confirmación verifica que no quedan cambios parciales.
- [ ] **T-159** · Traspaso: enviar, aceptar sin liberar reservas, rechazar y vencer. · RF: RF-077, RF-078, RF-079 · Dep: T-152, T-157
  - Hecho cuando: hay pruebas de los cuatro caminos, y el stock reservado no cambia durante el traspaso.
- [ ] **T-160** · Aviso al cerrar sesión voluntariamente con turno abierto o ventas en curso. · RF: RF-080 · Dep: T-159, T-137
  - Hecho cuando: el endpoint de cierre de sesión devuelve las ventas pendientes y exige el Corte X.
- [ ] **T-161** · Conectar el puerto `ConsultaDependencias` con ventas y transferencias reales: bajas de sucursal, caja, producto, cliente, proveedor y usuario. · RF: RF-025, RF-148 · Dep: T-158, T-093, T-063
  - Hecho cuando: hay pruebas de cada baja con dependencias y el mensaje de cada rechazo indica la causa.
- [ ] **T-162** · Frontend POS: búsqueda y carrito táctil con los totales que devuelve el backend. · RF: RF-054, RF-060, RF-157 · Dep: T-154, T-141
  - Hecho cuando: en /pos se arma un carrito por búsqueda y la pantalla muestra la promoción resaltada.
- [ ] **T-163** · Frontend POS: descuento manual, descarte, cobro en efectivo y traspasos. · RF: RF-065, RF-077, RF-080 · Dep: T-162, T-158, T-159
  - Hecho cuando: se confirma una venta en efectivo y se traspasa otra entre dos VO demo en dos navegadores.
- [ ] **T-164** · Sumar las acciones de ventas al generador de la matriz. · RF: RF-004 · Dep: T-163
  - Hecho cuando: las pruebas generadas pasan y un AC no puede vender desde el POS.
- [ ] **T-165** · **[Localhost]** Guion de las Fases 6 a 10. · RF: — · Dep: T-110, T-122, T-128, T-144, T-164
  - Hecho cuando: (1) se abre un turno, (2) se vende con un 2x1 y un descuento manual, (3) dos navegadores compiten por la última unidad, (4) un carrito abandonado expira, (5) se hacen los cortes X y Z, (6) el teórico no aparece en la pestaña de red del VO.

## Fase 11 — Cobros, clientes y crédito

- [ ] **T-166** · Crear las migraciones `pago` (clave de idempotencia única), `cliente`, `movimiento_cuenta_corriente` y `recibo`. · RF: RF-068 · Dep: T-145
  - Hecho cuando: las migraciones aplican y el saldo de un cliente no admite negativos.
- [ ] **T-167** · ABM de clientes con su condición fiscal, a cargo del AS. · RF: RF-132 · Dep: T-166, T-023
  - Hecho cuando: en /docs, el AS crea un cliente que se ve en todas las sucursales del comercio.
- [ ] **T-168** · Límite de crédito por cliente. · RF: RF-072 · Dep: T-167
  - Hecho cuando: el AS fija el límite y un VO no puede hacerlo.
- [ ] **T-169** · Pago mixto en la confirmación: fracciones, vuelto y validación con el motor de cálculo. · RF: RF-068, RF-070, RF-071 · Dep: T-158, T-116
  - Hecho cuando: una venta efectivo + débito con recargo se confirma con los importes esperados de la tabla de casos.
- [ ] **T-170** · Venta a crédito dentro del límite, y rechazo para un cliente dado de baja o sin cuenta corriente. · RF: RF-073, RF-144 · Dep: T-169, T-168
  - Hecho cuando: el saldo del cliente sube y un cliente sin cuenta corriente recibe un rechazo.
- [ ] **T-171** · Exceso de crédito con autorización. · RF: RF-074 · Dep: T-170, T-044
  - Hecho cuando: sin PIN se rechaza informando el disponible, con PIN se confirma, y queda en la auditoría.
- [ ] **T-172** · Cobro de cuenta corriente con recibo, que entra en la caja, y rechazo si excede la deuda. · RF: RF-128, RF-129 · Dep: T-170, T-133
  - Hecho cuando: el saldo baja, el teórico del turno sube y un cobro de más se rechaza.
- [ ] **T-173** · Prueba de concurrencia del límite de crédito con dos ventas simultáneas. · RF: RF-152 · Dep: T-170
  - Hecho cuando: el límite nunca se supera en 20 repeticiones.
- [ ] **T-174** · Puerto `PasarelaDePagos` y simulador local controlable desde /dev/simuladores. · RF: RF-075 · Dep: T-166
  - Hecho cuando: desde https://localhost:3000/dev/simuladores se elige "aprobar", "rechazar", "no responder" o "aprobar tarde".
- [ ] **T-175** · Pago electrónico rechazado: la venta queda sin confirmar y conserva sus reservas y los pagos aprobados. · RF: RF-075 · Dep: T-174, T-169
  - Hecho cuando: con el simulador en "rechazar", la segunda tarjeta falla y la primera sigue imputada.
- [ ] **T-176** · Exigir la reversión de los pagos aprobados antes de descartar una venta. · RF: RF-125 · Dep: T-175
  - Hecho cuando: el descarte se rechaza hasta revertir el pago aprobado.
- [ ] **T-177** · "Pago por verificar": clave de idempotencia, bloqueo del reintento con ese medio y estado de la venta. · RF: RF-126 · Dep: T-175
  - Hecho cuando: con el simulador en "no responder", la venta queda por verificar y un reintento con el mismo medio se rechaza.
- [ ] **T-178** · Worker de verificación de pagos y resolución manual por un AS. · RF: RF-126 · Dep: T-177, T-021, T-044
  - Hecho cuando: el worker resuelve el pago al reactivar el simulador, y un AS lo resuelve a mano si sigue sin respuesta.
- [ ] **T-179** · Alerta de reintegro pendiente ante la aprobación tardía de una venta descartada. · RF: RF-127 · Dep: T-178
  - Hecho cuando: con el simulador en "aprobar tarde", se descarta la venta y aparece la alerta para el AS y el AC.
- [ ] **T-180** · Adaptador de Mercado Pago: crear la intención de pago en una terminal Point (sandbox). · RF: RF-075 · Dep: T-174
  - Hecho cuando: una prueba manual contra el sandbox crea la intención con la clave de idempotencia como referencia externa.
- [ ] **T-181** · Adaptador de Mercado Pago: consultar el estado de un pago (sandbox). · RF: RF-126 · Dep: T-180
  - Hecho cuando: el worker de verificación resuelve un pago del sandbox.
- [ ] **T-182** · Adaptador de Mercado Pago: cobro por QR dinámico (sandbox). · RF: RF-068 · Dep: T-181
  - Hecho cuando: se genera un QR del sandbox y su pago se refleja en la venta.
- [ ] **T-183** · Webhook de Mercado Pago: verifica la firma, limita la frecuencia y solo dispara la consulta a la API. · RF: RF-075 (Const. 16) · Dep: T-181, T-031
  - Hecho cuando: una firma inválida responde 401, y un webhook con firma válida y contenido falso no cambia el estado del pago.
- [ ] **T-184** · Asociación de una terminal Point a cada caja en los parámetros de la caja. · RF: RF-024 · Dep: T-180, T-062
  - Hecho cuando: cada caja demo tiene su terminal del sandbox y el cobro se envía a la terminal correcta.
- [ ] **T-185** · Frontend POS: pago mixto, cliente, crédito y modal de autorización. · RF: RF-068, RF-073, RF-074 · Dep: T-171, T-163
  - Hecho cuando: en /pos se cobra una venta con efectivo y tarjeta del simulador, y otra a crédito con exceso autorizado.
- [ ] **T-186** · Frontend POS: pago por verificar, cobro de cuenta corriente y recibo. · RF: RF-126, RF-128 · Dep: T-185, T-178, T-172
  - Hecho cuando: con el simulador en "no responder", la pantalla muestra la venta por verificar, y un cobro de cuenta corriente imprime su recibo en pantalla.
- [ ] **T-187** · Frontend del AS: clientes y límites de crédito. · RF: RF-132, RF-072 · Dep: T-168, T-070
  - Hecho cuando: desde /admin, el AS crea un cliente con límite.
- [ ] **T-188** · Sumar las acciones de cobros al generador de la matriz. · RF: RF-004 · Dep: T-187
  - Hecho cuando: las pruebas generadas pasan.

## Fase 12 — Facturación fiscal (módulo opcional)

- [ ] **T-189** · Crear las migraciones `comprobante`, `intento_envio_fiscal`, `credencial_fiscal` y `caea`, más la política de facturación en `parametro_comercio` y `se_factura` en `venta`. · RF: RF-155 · Dep: T-145, T-060
  - Hecho cuando: las migraciones aplican y el número de comprobante es único por punto de venta.
- [ ] **T-190** · Sin el módulo activo: las ventas se confirman sin pedido fiscal y los endpoints fiscales se rechazan. · RF: RF-165 · Dep: T-189, T-158, T-054
  - Hecho cuando: con el módulo inactivo, una venta queda en "no se factura" y el outbox no tiene pedidos fiscales.
- [ ] **T-191** · Política de facturación del AC (tres modos). · RF: RF-166 · Dep: T-189, T-054
  - Hecho cuando: en /docs, el AC cambia la política y, con el módulo inactivo, no puede hacerlo.
- [ ] **T-192** · Decisión de facturar en cada venta según la política, con factura A obligatoria y registro de quién decidió. · RF: RF-167 · Dep: T-191, T-169
  - Hecho cuando: hay pruebas de los tres modos y de un cliente responsable inscripto que fuerza la factura.
- [ ] **T-193** · Credencial fiscal cifrada con la clave maestra del entorno, nunca devuelta, con alerta antes del vencimiento. · RF: RF-162 · Dep: T-189
  - Hecho cuando: ningún endpoint devuelve el certificado, el valor guardado en la base está cifrado y un certificado que vence en 15 días genera la alerta.
- [ ] **T-194** · Puerto `ServicioFiscal` y simulador de ARCA controlable desde /dev/simuladores. · RF: RF-100 · Dep: T-189, T-174
  - Hecho cuando: el simulador se puede poner en "acepta", "rechaza" o "caído".
- [ ] **T-195** · Tipo de comprobante (A, B o C) según emisor y comprador, y numeración por punto de venta. · RF: RF-155 · Dep: T-194
  - Hecho cuando: pasa una tabla de casos de tipos, y la numeración de dos cajas es independiente.
- [ ] **T-196** · Worker de envío: toma el pedido del outbox, obtiene el CAE y reintenta. La venta solo figura emitida tras la aceptación. · RF: RF-100, RF-106 · Dep: T-195, T-022
  - Hecho cuando: con el simulador en "acepta", la venta pasa a "emitida" con su CAE, y antes de eso nunca figura emitida.
- [ ] **T-197** · Solicitar por adelantado el CAEA de cada quincena para los comercios con el módulo activo, con alerta si falla. · RF: RF-160 · Dep: T-194, T-021
  - Hecho cuando: el worker guarda el CAEA del período, y con el simulador caído antes del período alerta al AC.
- [ ] **T-198** · Emitir con CAEA cuando el servicio está caído. · RF: RF-101 · Dep: T-197, T-196
  - Hecho cuando: con el simulador "caído", la venta se emite con CAEA y queda en cola para informar.
- [ ] **T-199** · Informar la cola en orden por punto de venta, sin que un rechazo detenga el resto. · RF: RF-102 · Dep: T-198
  - Hecho cuando: al volver el simulador, la cola se informa en orden, y un comprobante rechazado no frena a los siguientes.
- [ ] **T-200** · Sin un CAEA vigente: ticket no fiscal, pedido de CAE posterior y alerta. · RF: RF-161 · Dep: T-198
  - Hecho cuando: sin CAEA y con el simulador caído, la venta sale con ticket no fiscal y el AC recibe la alerta.
- [ ] **T-201** · Rechazo, en línea o de un comprobante con CAEA: se marca, se alerta al AS y al AC, y un rechazo en línea emite el ticket como no fiscal. · RF: RF-103 · Dep: T-196, T-199
  - Hecho cuando: con el simulador en "rechaza", la venta queda "Rechazada fiscalmente" y válida, con las dos alertas.
- [ ] **T-202** · Corrección y reenvío de un comprobante rechazado por un AC o un AS. · RF: RF-104 · Dep: T-201
  - Hecho cuando: se corrige un dato, el reenvío es aceptado y queda en la auditoría.
- [ ] **T-203** · Vencimiento del plazo: alerta crítica persistente, recordatorios periódicos y reintentos. · RF: RF-105 · Dep: T-201, T-021
  - Hecho cuando: con reloj simulado vencido, la alerta no se puede descartar y se repite el recordatorio.
- [ ] **T-204** · Facturación posterior dentro del plazo. · RF: RF-168 · Dep: T-196, T-192
  - Hecho cuando: una venta sin factura se factura dentro del plazo, y fuera de plazo se rechaza.
- [ ] **T-205** · Implementar el puerto `ConsultaPendientesFiscales` real (reemplaza el simulado de T-053) para la desactivación del módulo y la baja de comercio. · RF: RF-164, RF-147 · Dep: T-199, T-053
  - Hecho cuando: con un comprobante en cola, la desactivación y la baja se rechazan indicando el comprobante.
- [ ] **T-206** · Adaptador de ARCA: autenticación con el certificado del comercio (homologación). · RF: RF-162 · Dep: T-193, T-194
  - Hecho cuando: se obtiene el ticket de acceso de homologación con un certificado de prueba.
- [ ] **T-207** · Adaptador de ARCA: emisión con CAE (homologación). · RF: RF-100 · Dep: T-206
  - Hecho cuando: una venta de prueba obtiene un CAE de homologación.
- [ ] **T-208** · Adaptador de ARCA: solicitud y aviso de comprobantes con CAEA (homologación). · RF: RF-101, RF-160 · Dep: T-207
  - Hecho cuando: se obtiene un CAEA de homologación y se informa un comprobante emitido con él.
- [ ] **T-209** · Conectar la alerta al AC por bloqueo de PIN (pendiente de T-045). · RF: RF-145 · Dep: T-045, T-092
  - Hecho cuando: el sexto PIN erróneo genera la alerta al AC.
- [ ] **T-210** · Frontend del AC: configuración fiscal (certificado, puntos de venta, política). · RF: RF-162, RF-166 · Dep: T-193, T-191, T-070
  - Hecho cuando: desde /admin se carga un certificado de prueba y la pantalla muestra solo su fecha de vencimiento.
- [ ] **T-211** · Frontend: comprobantes con su estado, corrección y reenvío, y facturación posterior. · RF: RF-104, RF-168 · Dep: T-202, T-204, T-210
  - Hecho cuando: desde /admin se reenvía un comprobante rechazado por el simulador.
- [ ] **T-212** · Frontend POS: opción de facturar al cobrar según la política, oculta si no hay módulo. · RF: RF-165, RF-167 · Dep: T-192, T-185
  - Hecho cuando: con el modo "opcional, sin factura por defecto" la opción aparece desmarcada, y con el módulo inactivo no aparece.
- [ ] **T-213** · **[Localhost]** Guion de las Fases 11 y 12. · RF: — · Dep: T-188, T-211, T-212
  - Hecho cuando: (1) pago mixto con rechazo parcial, (2) pago por verificar, (3) venta a crédito con exceso, (4) simulador de ARCA caído → venta con CAEA → vuelve → la cola se informa, (5) rechazo y reenvío, (6) el comercio sin módulo vende con ticket no fiscal.

## Fase 13 — Devoluciones y anulaciones

- [ ] **T-214** · Crear las migraciones `devolucion`, `devolucion_item`, `reintegro` y `anulacion`. · RF: RF-084 · Dep: T-166, T-189
  - Hecho cuando: las migraciones aplican y la cantidad devuelta nunca supera la vendida.
- [ ] **T-215** · Anulación total dentro del turno con PIN: revierte stock, caja y cuenta corriente, y emite la Nota de Crédito si la venta se facturó. · RF: RF-081, RF-082 · Dep: T-214, T-044, T-196
  - Hecho cuando: una venta anulada devuelve el stock al disponible y el teórico del turno vuelve al valor anterior.
- [ ] **T-216** · Rechazar la anulación fuera del turno, parcial o con devoluciones previas. · RF: RF-136 · Dep: T-215
  - Hecho cuando: hay pruebas de los tres casos y el mensaje indica que corresponde una devolución.
- [ ] **T-217** · Buscar un ticket desde cualquier sucursal del comercio y obtener las cantidades devolvibles. · RF: RF-083 · Dep: T-214
  - Hecho cuando: un VO de la sucursal 2 ve un ticket de la sucursal 1, y un VO de otro comercio recibe 404.
- [ ] **T-218** · Validar el plazo de devolución y la cantidad. · RF: RF-138, RF-084 · Dep: T-217
  - Hecho cuando: hay pruebas fuera de plazo y con cantidad excesiva.
- [ ] **T-219** · Confirmar la devolución: reintegro proporcional desde la caja actual, rechazo por efectivo insuficiente informado solo al AS e ítems "En Revisión" en la sucursal que los recibe. · RF: RF-085, RF-087, RF-137 · Dep: T-218, T-118, T-089
  - Hecho cuando: el reintegro coincide con la tabla de casos de T-118, y el stock queda en revisión en la sucursal receptora.
- [ ] **T-220** · Devolución de una venta a crédito: descuento hasta cero y excedente en efectivo con PIN. · RF: RF-086 · Dep: T-219
  - Hecho cuando: con un cliente que ya pagó, el saldo queda en cero y el excedente exige PIN.
- [ ] **T-221** · Nota de Crédito que espera a su comprobante original, y bloqueo si el original está rechazado. · RF: RF-139 · Dep: T-219, T-201
  - Hecho cuando: con el original en cola, la Nota de Crédito no se envía, y con el original rechazado se suma a la alerta.
- [ ] **T-222** · Mantener consumida la cuota al devolver o anular. · RF: RF-140 · Dep: T-219, T-155
  - Hecho cuando: el saldo de la cuota no cambia tras devolver una venta con descuento manual.
- [ ] **T-223** · Rechazar la devolución de una venta facturada con el módulo inactivo. · RF: RF-169 · Dep: T-219, T-054
  - Hecho cuando: tras desactivar el módulo, la devolución de una venta facturada se rechaza y la de una no facturada funciona.
- [ ] **T-224** · Prueba de concurrencia de la cantidad devolvible con dos devoluciones simultáneas del mismo ticket. · RF: RF-152 · Dep: T-219
  - Hecho cuando: nunca se devuelve más de lo vendido en 20 repeticiones.
- [ ] **T-225** · Frontend POS: anulación y devolución. · RF: RF-081, RF-083 · Dep: T-219, T-185
  - Hecho cuando: en /pos se anula una venta del turno con el PIN del AS demo, y se devuelve un ítem de un ticket de la otra sucursal.
- [ ] **T-226** · Sumar las acciones de devoluciones al generador de la matriz. · RF: RF-004 · Dep: T-225
  - Hecho cuando: las pruebas generadas pasan.

## Fase 14 — Alertas, tiempo real y reportes

- [ ] **T-227** · Alertas: listar y resolver por destinatario, más el worker de recordatorios para las persistentes. · RF: RF-041, RF-098, RF-127 · Dep: T-092, T-021
  - Hecho cuando: en /docs, el AS ve sus alertas y no las del AS de otra sucursal.
- [ ] **T-228** · WebSocket autenticado con el token, con un canal por comercio y sucursal asignado por el servidor. · RF: RF-061 · Dep: T-031, T-035
  - Hecho cuando: una conexión sin token se rechaza y un cliente no puede suscribirse a otra sucursal.
- [ ] **T-229** · Difusión de los cambios de stock desde el outbox. · RF: RF-061 · Dep: T-228, T-022, T-089
  - Hecho cuando: una prueba mide que el evento llega en 2 segundos como máximo a la misma sucursal y nunca a otra.
- [ ] **T-230** · Frontend POS: stock en vivo y centro de alertas. · RF: RF-061 · Dep: T-229, T-227, T-162
  - Hecho cuando: con dos navegadores, una venta en uno actualiza el disponible en el otro sin recargar.
- [ ] **T-231** · Frontend POS: desconexión (bloquea agregar y cobrar) y reconexión (muestra el carrito vigente o informa el descarte). · RF: RF-062 · Dep: T-230
  - Hecho cuando: al detener el backend, el POS muestra "sin conexión", y al volver muestra el carrito o el aviso de descarte.
- [ ] **T-232** · Documento del ticket: sucursal, vendedor, ítems, promociones, pagos, totales y si es fiscal o no válido como factura. · RF: RF-107 · Dep: T-158, T-196
  - Hecho cuando: el endpoint del ticket devuelve el documento completo para una venta facturada y para una no facturada.
- [ ] **T-233** · Informe diario por sucursal según la fecha de jornada. · RF: RF-109 · Dep: T-158, T-130
  - Hecho cuando: una venta hecha después de medianoche en una jornada abierta antes aparece en la fecha de la jornada.
- [ ] **T-234** · Dashboard del AC con las métricas de D-50, filtrable por período y sucursal. · RF: RF-110 · Dep: T-158, T-172, T-201
  - Hecho cuando: las métricas del seed coinciden con los valores esperados de una prueba.
- [ ] **T-235** · Dashboard del AS, limitado a su sucursal. · RF: RF-111 · Dep: T-234
  - Hecho cuando: el AS de la sucursal 1 no ve datos de la sucursal 2.
- [ ] **T-236** · Consulta de la auditoría comercial: el AC ve su comercio y el AS su sucursal. · RF: RF-114 · Dep: T-041
  - Hecho cuando: hay pruebas de ámbito y el SA recibe un rechazo.
- [ ] **T-237** · Frontend: dashboards, informe diario y auditoría comercial. · RF: RF-109 a RF-111, RF-114 · Dep: T-233 a T-236, T-070
  - Hecho cuando: desde /admin, el AC filtra el dashboard por sucursal y el AS ve el informe de su sucursal.

## Fase 15 — Periféricos y experiencia táctil

- [ ] **T-238** · Adaptador de impresora en el frontend: WebUSB o WebSerial en Chrome y Edge, y agente local como alternativa. Imprime el documento que arma el backend. · RF: RF-158 · Dep: T-232
  - Hecho cuando: una impresora térmica de prueba imprime el ticket de una venta demo desde https://localhost:5173/pos.
- [ ] **T-239** · Falla de impresión: la venta sigue confirmada, el VO recibe un aviso y puede reimprimir. · RF: RF-108 · Dep: T-238
  - Hecho cuando: con la impresora desconectada, la venta figura confirmada y el botón de reimprimir funciona al reconectarla.
- [ ] **T-240** · Lector de códigos como teclado, con búsqueda manual si el lector falla. · RF: RF-054 · Dep: T-162
  - Hecho cuando: un lector USB agrega productos al carrito, y sin lector se sigue vendiendo por búsqueda.
- [ ] **T-241** · Informar el estado de los periféricos al backend y mostrarlo en el panel técnico del SA. · RF: RF-016 · Dep: T-238, T-057
  - Hecho cuando: desconectar la impresora genera una alerta técnica visible para el SA, sin datos comerciales.
- [ ] **T-242** · Revisión táctil del POS en una tablet Android con Chrome, y de la administración en escritorio. · RF: RF-157 · Dep: T-231, T-240
  - Hecho cuando: el guion de venta completo se hace en una tablet sin teclado físico, y los botones cumplen el tamaño táctil mínimo.

## Fase 16 — Cierre

- [ ] **T-243** · Completar la matriz de seguridad con todas las acciones y los tipos de recurso del criterio 2. · RF: RF-001 a RF-004 · Dep: T-226, T-237
  - Hecho cuando: las pruebas generadas cubren cada fila de §5.18 y cada tipo de recurso, en lectura y escritura cruzada.
- [ ] **T-244** · Prueba punta a punta: venta con pago mixto y cierre ciego, inspeccionando el tráfico de red. · RF: RF-068, RF-093, RF-112 · Dep: T-243
  - Hecho cuando: la prueba de Playwright pasa y verifica que el teórico no viaja hacia el VO.
- [ ] **T-245** · Prueba punta a punta: devolución en otra sucursal y revisión. · RF: RF-083, RF-087, RF-088 · Dep: T-243
  - Hecho cuando: la prueba de Playwright pasa.
- [ ] **T-246** · Prueba punta a punta: contingencia fiscal y cierre forzado. · RF: RF-101, RF-115 · Dep: T-243
  - Hecho cuando: la prueba de Playwright pasa con el simulador de ARCA caído y recuperado.
- [ ] **T-247** · Prueba punta a punta: comercio sin módulo de facturación. · RF: RF-165 · Dep: T-243
  - Hecho cuando: la prueba de Playwright vende, anula y devuelve sin ningún comprobante fiscal.
- [ ] **T-248** · Activar el modo estricto de la trazabilidad en `npm run verify`. · RF: todos (criterio 1) · Dep: T-244 a T-247
  - Hecho cuando: `sdd/trazabilidad.md` tiene los 169 RF con al menos una prueba y `npm run verify` pasa en modo estricto.
- [ ] **T-249** · Actualizar `docs/arquitectura` con el catálogo final de puertos y adaptadores. · RF: — (Const. 14) · Dep: T-248
  - Hecho cuando: cada puerto del código figura en el catálogo con sus adaptadores.
- [ ] **T-250** · **[Localhost]** Guion de demostración completo. · RF: — · Dep: T-249
  - Hecho cuando: desde `npm run db:reset && npm run db:seed && npm run dev` se recorre un día completo de un comercio (apertura, ventas, devolución, contingencia, cortes, dashboards) siguiendo el guion del README.
