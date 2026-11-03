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

Los correos de validación y recuperación se muestran en la consola del backend (`[api]` en `npm run dev`).

## Comandos

| Comando                                   | Qué hace                                                                                                                            |
| :---------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                          | Todo lo que exige integrar un cambio: formato, lint, tipos, arquitectura, contrato, pruebas, trazabilidad, dependencias y secretos. |
| `npm test`                                | Pruebas unitarias y de integración (las de integración usan `pos_test`).                                                            |
| `npm run lint` / `npm run format`         | Lint y formato.                                                                                                                     |
| `npm run lint:arch`                       | Reglas de dependencias de la arquitectura hexagonal.                                                                                |
| `npm run db:migrate` / `npm run db:reset` | Aplica migraciones / vacía `pos_dev` y las vuelve a aplicar.                                                                        |
| `npm run db:seed`                         | Carga los usuarios de demostración en `pos_dev`.                                                                                    |
| `npm run db:migration:new -- <nombre>`    | Crea una migración vacía.                                                                                                           |
| `npm run contracts:generate`              | Genera los tipos desde `packages/contracts/openapi.yaml`.                                                                           |
| `npm run trazabilidad`                    | Regenera `sdd/trazabilidad.md` desde las etiquetas `[RF-xxx]` de las pruebas.                                                       |
| `npm run worker`                          | Worker de trabajos programados y outbox.                                                                                            |
