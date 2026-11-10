# Sistema POS Multi-Inquilino

Punto de venta web para múltiples comercios: sucursales, cajas, inventario concurrente, facturación electrónica con contingencia, cierres ciegos y dashboards. El proyecto sigue Spec-Driven Development.

## Documentación

| Documento                                           | Contenido                                                             |
| :-------------------------------------------------- | :-------------------------------------------------------------------- |
| [Constitución](sdd/constitution.md)                 | Principios que todo cambio respeta.                                   |
| [Spec](sdd/spec.md)                                 | Requisitos funcionales (RF-001 a RF-169) y criterios de finalización. |
| [Plan técnico](sdd/plan.md)                         | Módulos, modelo de datos y decisiones de arquitectura.                |
| [Tareas](sdd/tareas.md) y [roadmap](sdd/roadmap.md) | Orden de implementación y entregas.                                   |
| [Trazabilidad](sdd/trazabilidad.md)                 | Qué pruebas verifican cada RF (generado).                             |
| [Arquitectura](docs/arquitectura/README.md)         | Diagramas, puertos y adaptadores, decisiones y guía de módulos.       |

## Requisitos

- Node.js 22.18 o más nuevo.
- PostgreSQL 16 instalado como servicio, en `localhost:5432`.
- [mkcert](https://github.com/FiloSottile/mkcert), con `mkcert -install` ejecutado una vez.

## Primeros pasos

```powershell
npm install
npm run certs        # certificados HTTPS de desarrollo
npm run db:setup     # una vez por equipo: roles, bases y .env (pide la contraseña de postgres)
npm run db:reset     # aplica las migraciones en pos_dev
npm run db:seed      # carga los usuarios de demostración
npm run dev          # backend, frontend y worker
```

| Servicio                                  | Dirección                    |
| :---------------------------------------- | :--------------------------- |
| POS                                       | https://localhost:5173/pos   |
| Administración                            | https://localhost:5173/admin |
| API                                       | https://localhost:3000       |
| Documentación de la API (solo desarrollo) | https://localhost:3000/docs  |

## Usuarios de demostración

`npm run db:seed` carga el comercio **Demo** (sucursales Centro y Norte) y estos usuarios. **Solo para desarrollo:** el seed se niega a correr en producción.

Todos usan la contraseña **`Demo-2026!`**.

| Correo                 | Rol                               | PIN de autorización | Para probar                                                                                              |
| :--------------------- | :-------------------------------- | :------------------ | :------------------------------------------------------------------------------------------------------- |
| `sa@demo.local`        | SA                                | —                   | Plataforma, sin datos comerciales                                                                        |
| `ac@demo.local`        | AC                                | `1111`              | Administración del comercio; autoriza en cualquier sucursal                                              |
| `as@demo.local`        | AS (Centro y Norte) y VO (Centro) | `2222`              | Primer ingreso con elección de rol, cambio de rol, segregación de funciones, inventario y transferencias |
| `vo@demo.local`        | VO (Centro)                       | —                   | Punto de venta                                                                                           |
| `vo.norte@demo.local`  | VO (Norte)                        | —                   | Ámbito de otra sucursal                                                                                  |
| `pendiente@demo.local` | VO (Centro), correo sin validar   | —                   | Validación de correo                                                                                     |

El comercio arranca con un tope de cuota de descuento de 15 % por venta y $ 20.000; el AS asigna la cuota de cada VO desde **Cuotas de descuento**.

Los correos de validación y recuperación se muestran en la consola del backend (`[api]` en `npm run dev`).

## Guion de demostración

Un día completo de un comercio, desde cero (T-250). **Borra los datos de `pos_dev`.**

```bash
npm run db:reset && npm run db:seed && npm run dev
```

Abrí <https://localhost:5173> en una ventana por usuario (o en ventanas privadas). La contraseña de todos es `Demo-2026!`.

1. **Activar la facturación.** Como `sa@demo.local`, en **Comercios**, activá el módulo de facturación de Demo. Como `ac@demo.local`, volvé a iniciar sesión y en **Configuración fiscal** cargá un CUIT y elegí los archivos `certificado-prueba.crt` y `clave.txt` de `apps/backend/test/support/`. El worker pide el CAEA en menos de un minuto.
2. **Apertura.** Como `vo@demo.local`, abrí el turno de Caja 1 con un saldo inicial de $ 1.000. Como `vo.norte@demo.local`, abrí el de Norte con $ 5.000.
3. **Venta con pago mixto.** En Centro, **Nueva venta**, agregá un producto y **Cobrar**: pagá una parte con Débito y confirmá el resto en efectivo. Anotá el número de ticket.
4. **Devolución en otra sucursal.** En Norte, **Devolución o anulación**: buscá ese ticket, devolvé una unidad y autorizá con el PIN `2222` de Sergio Sucursal. Como `as@demo.local` (Administrador de Sucursal), en **Inventario** de Norte, revisá el producto y reingresalo.
5. **Contingencia fiscal.** En `/dev/simuladores`, poné ARCA en **Caído** y vendé en Centro. En **Comprobantes** (AC o AS) aparece **Con CAEA, por informar**. Volvé a **Acepta**: en el siguiente reintento (2 minutos o más) pasa a **Emitido**.
6. **Cortes.** Como `vo.norte@demo.local`, hacé el **Corte X**: el arqueo es ciego, solo ves lo que declaraste. Como `as@demo.local`, en **Caja**, forzá el cierre del turno de Centro y hacé el **Corte Z** de las dos cajas: acá sí aparecen el teórico y la diferencia.
7. **Dashboards.** Como `ac@demo.local`, mirá **Dashboard**, **Informe diario** y **Auditoría comercial**. Las alertas del día están en la campana.

## Comandos

| Comando                                   | Qué hace                                                                                                                                                                                                          |
| :---------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                          | Todo lo que exige integrar un cambio: formato, lint, tipos, arquitectura, contrato, pruebas, trazabilidad, dependencias y secretos.                                                                               |
| `npm test`                                | Pruebas unitarias y de integración (las de integración usan `pos_test`).                                                                                                                                          |
| `npm run test:e2e`                        | Pruebas punta a punta en navegador con Playwright, sobre `pos_test` y con puertos propios (3100 y 5174). No corre junto con `npm test`, que usa la misma base. La primera vez: `npx playwright install chromium`. |
| `npm run lint` / `npm run format`         | Lint y formato.                                                                                                                                                                                                   |
| `npm run lint:arch`                       | Reglas de dependencias de la arquitectura hexagonal.                                                                                                                                                              |
| `npm run db:migrate` / `npm run db:reset` | Aplica migraciones / vacía `pos_dev` y las vuelve a aplicar.                                                                                                                                                      |
| `npm run db:seed`                         | Carga los usuarios de demostración en `pos_dev`.                                                                                                                                                                  |
| `npm run db:migration:new -- <nombre>`    | Crea una migración vacía.                                                                                                                                                                                         |
| `npm run contracts:generate`              | Genera los tipos desde `packages/contracts/openapi.yaml`.                                                                                                                                                         |
| `npm run trazabilidad`                    | Regenera `sdd/trazabilidad.md` desde las etiquetas `[RF-xxx]` de las pruebas.                                                                                                                                     |
| `npm run worker`                          | Worker de trabajos programados y outbox.                                                                                                                                                                          |
