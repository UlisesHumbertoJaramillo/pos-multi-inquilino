# Estructura hexagonal del backend

El backend es un monolito modular con arquitectura hexagonal (Const. 14, AD-02). `npm run lint:arch` verifica las reglas de dependencias de este documento.

```
src/
├── app.ts, server.ts      Raíz de composición: conecta adaptadores y casos de uso.
├── compartido/            Piezas transversales (Reloj, GeneradorDeId, UnidadDeTrabajo...).
│   ├── dominio/
│   ├── aplicacion/
│   └── adaptadores/
└── modulos/
    └── <modulo>/          Un contexto del dominio (plan §2): identidad, catalogo, ventas, caja...
        ├── dominio/       Entidades, objetos de valor, reglas, máquinas de estado, cálculos puros.
        ├── aplicacion/    Casos de uso, puertos de entrada y salida, permisos, transacciones.
        └── adaptadores/   HTTP, workers, repositorios PostgreSQL, clientes de integraciones.
```

Cada módulo se crea cuando se implementa su primera tarea.

## Reglas de dependencias

Las dependencias solo apuntan hacia adentro: adaptadores → aplicación → dominio.

| Desde                   | Puede importar                                                                                                  |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------- |
| `modulos/X/dominio`     | Solo `modulos/X/dominio` y `compartido/dominio`. Ninguna librería ni módulo de Node.                            |
| `modulos/X/aplicacion`  | `modulos/X/dominio`, la capa `aplicacion` de cualquier módulo y `compartido/dominio` o `compartido/aplicacion`. |
| `modulos/X/adaptadores` | Lo anterior, librerías externas y `compartido/adaptadores`. Nunca los adaptadores de otro módulo.               |
| `compartido/dominio`    | Solo `compartido/dominio`.                                                                                      |
| `compartido/aplicacion` | `compartido/dominio` y `compartido/aplicacion`.                                                                 |

Además: no hay ciclos, y todo import tiene que poder resolverse.

Las pruebas (`*.test.ts`, `*.int.test.ts`) pueden importar Vitest aunque estén junto al dominio.

Las librerías puras que el dominio necesite (por ejemplo, el tipo decimal de AD-08) se agregan con una decisión explícita en `PURE_PACKAGES`, en `.dependency-cruiser.cjs`.
