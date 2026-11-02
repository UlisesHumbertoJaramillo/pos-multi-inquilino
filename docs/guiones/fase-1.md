# Guion de la Fase 1: acceso seguro (T-048)

Recorrido manual en el navegador que cierra la Fase 1 y la entrega E1. Tarda unos 10 minutos.

## Preparación

```powershell
npm run db:reset   # base vacía con las migraciones
npm run db:seed    # comercio Demo y usuarios de demostración
npm run dev        # API, frontend y worker
```

Las credenciales están en el [README](../../README.md#usuarios-de-demostración). Todos los usuarios usan la contraseña `Demo-2026!`.

## 1. El inicio de sesión funciona con cada rol demo

En https://localhost:5173/login, ingresar con cada usuario y salir con **Salir**:

| Usuario         | Resultado esperado                                                          |
| :-------------- | :-------------------------------------------------------------------------- |
| `vo@demo.local` | Llega a **Punto de venta**; la barra muestra "Vendedor".                    |
| `ac@demo.local` | Llega a **Administración**; la barra muestra "Administrador de Comercio".   |
| `sa@demo.local` | Llega a **Administración**; la barra muestra "Super Administrador".         |
| `as@demo.local` | Primer ingreso: pide **elegir el rol**. Elegir "Administrador de Sucursal". |

- [ ] Los cuatro ingresos se comportan como en la tabla.

## 2. El cambio de rol cambia el menú

Con `as@demo.local` y el rol "Administrador de Sucursal":

- [ ] El menú muestra Inventario, Transferencias, Clientes e Informe diario.
- [ ] **Cambiar rol → Vendedor** lleva a Punto de venta, la barra muestra "Vendedor" y el menú pasa a Punto de venta y Caja, sin pedir la contraseña de nuevo.
- [ ] Al salir y volver a ingresar, entra directo como Vendedor (el último rol usado).

## 3. Cinco contraseñas erróneas bloquean la cuenta

Con `vo.norte@demo.local`:

- [ ] 5 contraseñas erróneas muestran "El correo o la contraseña no son correctos."
- [ ] El sexto intento, aun con la contraseña correcta, muestra que la credencial está bloqueada y en cuántos minutos se puede volver a probar.
- [ ] Para desbloquearla antes de los 15 minutos: `npm run db:seed`.

## 4. El correo de recuperación aparece en la consola del backend

- [ ] En la pantalla de inicio de sesión, **¿Olvidaste tu contraseña?** con `vo@demo.local` muestra "Si el correo está registrado, te enviamos un enlace…".
- [ ] En la terminal de `npm run dev` aparece el recuadro **CORREO SIMULADO** (líneas `[api]`) con el enlace.
- [ ] Al abrir el enlace se puede elegir una contraseña nueva e ingresar con ella. Volver a abrir el mismo enlace muestra que ya no es válido.
- [ ] Repetir con un correo inexistente: la pantalla muestra exactamente el mismo mensaje y no aparece ningún correo.
- [ ] Validación de correo: ingresar con `pendiente@demo.local`, tocar **Reenviar** y abrir el enlace de la consola. La cuenta queda validada y ya puede ingresar.

## 5. Sin token, las rutas de la API responden 401

En https://localhost:3000/docs (solo existe en desarrollo):

- [ ] Sin autorizar, **Try it out** en `GET /auth/sesion`, `PUT /auth/pin` o `POST /autorizaciones` responde **401**.
- [ ] Con `POST /auth/login` y el VO demo se obtienen los tokens. Con **Authorize** y el `tokenAcceso`, `GET /auth/sesion` responde 200 con el comercio y el rol activo.

## Resultado

Si todos los puntos se cumplen, se marcan T-048 en `sdd/tareas.md` y E1 en `sdd/roadmap.md`.
