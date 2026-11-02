const path = require('node:path');

// Reglas de arquitectura verificadas con `npm run lint:arch` (T-011 y T-012, Const. 14 y 15).
// Las reglas de dominio y aplicación son listas de lo permitido: lo que no está, queda prohibido.

const SRC = '^apps/backend/src/';
const TESTS = '\\.(int\\.)?test\\.ts$';

// Librerías npm sin efectos externos que el dominio y la aplicación pueden usar.
// Cada una se agrega con una decisión explícita (por ejemplo, el tipo decimal de AD-08).
const PURE_PACKAGES = [];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'dominio-solo-dominio',
      comment:
        'El dominio de un módulo solo importa su propio dominio o el dominio compartido. ' +
        'Nada de frameworks, base de datos, integraciones ni módulos de Node (Const. 14).',
      severity: 'error',
      from: { path: `${SRC}modulos/([^/]+)/dominio/`, pathNot: TESTS },
      to: { pathNot: [`${SRC}(modulos/$1|compartido)/dominio/`, ...PURE_PACKAGES] },
    },
    {
      name: 'dominio-compartido-solo-dominio',
      comment: 'El dominio compartido solo importa dominio compartido (Const. 14).',
      severity: 'error',
      from: { path: `${SRC}compartido/dominio/`, pathNot: TESTS },
      to: { pathNot: [`${SRC}compartido/dominio/`, ...PURE_PACKAGES] },
    },
    {
      name: 'aplicacion-sin-adaptadores',
      comment:
        'La aplicación depende de su dominio, de la capa de aplicación de otros módulos y de lo ' +
        'compartido, nunca de adaptadores ni de infraestructura (Const. 14).',
      severity: 'error',
      from: { path: `${SRC}modulos/([^/]+)/aplicacion/`, pathNot: TESTS },
      to: {
        pathNot: [
          `${SRC}modulos/$1/dominio/`,
          `${SRC}modulos/[^/]+/aplicacion/`,
          `${SRC}compartido/(dominio|aplicacion)/`,
          ...PURE_PACKAGES,
        ],
      },
    },
    {
      name: 'aplicacion-compartida-sin-adaptadores',
      comment: 'La aplicación compartida solo depende de dominio y aplicación compartidos.',
      severity: 'error',
      from: { path: `${SRC}compartido/aplicacion/`, pathNot: TESTS },
      to: { pathNot: [`${SRC}compartido/(dominio|aplicacion)/`, ...PURE_PACKAGES] },
    },
    {
      name: 'sin-adaptadores-de-otro-modulo',
      comment:
        'Un módulo no usa los adaptadores de otro (por ejemplo, su persistencia): se comunican ' +
        'por casos de uso o por eventos.',
      severity: 'error',
      from: { path: `${SRC}modulos/([^/]+)/` },
      to: { path: `${SRC}modulos/[^/]+/adaptadores/`, pathNot: `${SRC}modulos/$1/` },
    },
    {
      name: 'frontend-solo-contratos',
      comment:
        'El frontend solo se comunica con el backend por endpoints: del resto del repositorio ' +
        'únicamente importa los tipos de packages/contracts (Const. 15, AD-01).',
      severity: 'error',
      from: { path: '^apps/frontend/' },
      to: { path: '^(apps|packages)/', pathNot: '^(apps/frontend|packages/contracts)/' },
    },
    {
      name: 'sin-ciclos',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'sin-imports-sin-resolver',
      comment: 'Un import que no se puede resolver podría esconder una dependencia prohibida.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // También cuenta los imports de solo tipos.
    tsPreCompilationDeps: true,
    // Ruta absoluta: con una relativa, el extends del tsconfig se resuelve mal.
    tsConfig: { fileName: path.join(__dirname, 'apps/backend/tsconfig.json') },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
  },
};
