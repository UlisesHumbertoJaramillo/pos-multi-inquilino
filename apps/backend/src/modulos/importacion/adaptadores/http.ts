// Rutas de la carga desde Excel (T-291, T-295; RF-170 a RF-174). Por cada tipo: la plantilla, la
// vista previa y la aplicación. El archivo se recibe como cuerpo binario y se valida en el servidor.
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { GetTemplate, ImportMode, RunImport } from '../aplicacion/imports.js';
import { IMPORT_ACTIONS } from '../aplicacion/imports.js';
import {
  IMPORT_KINDS,
  type ImportKind,
  type ImportSummary,
  MAX_FILE_BYTES,
} from '../dominio/templates.js';

export interface ImportUseCases {
  runImport: RunImport;
  getTemplate: GetTemplate;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Se aceptan también los tipos de los formatos que se rechazan, para explicar por qué.
const UPLOAD_TYPES = [
  XLSX,
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
] as const;

const summaryDto = (s: ImportSummary) => ({
  creados: s.created,
  actualizados: s.updated,
  rechazados: s.rejected,
  filas: s.rows.map((r) => ({
    fila: r.line,
    clave: r.key,
    resultado: r.outcome,
    motivo: r.outcome === 'error' ? r.reason : null,
  })),
});

function fileOf(body: unknown): Uint8Array {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new ApplicationError(
      'invalid_request',
      'ARCHIVO_INVALIDO',
      'Enviá la planilla como un libro de Excel (.xlsx) de hasta 5 MB.',
    );
  }
  return new Uint8Array(body);
}

function upload(useCases: ImportUseCases, kind: ImportKind, mode: ImportMode): HttpRoute {
  return {
    method: 'post',
    path: mode === 'aplicar' ? `/importaciones/${kind}` : `/importaciones/${kind}/vista-previa`,
    action: IMPORT_ACTIONS[kind],
    binaryBody: { types: UPLOAD_TYPES, maxBytes: MAX_FILE_BYTES },
    handler: async (req, res) => {
      const summary = await useCases.runImport.execute(
        securityContextOf(res),
        kind,
        fileOf(req.body),
        mode,
      );
      res.json(summaryDto(summary));
    },
  };
}

export function importRoutes(useCases: ImportUseCases): HttpRoute[] {
  return IMPORT_KINDS.flatMap((kind): HttpRoute[] => [
    {
      method: 'get',
      path: `/importaciones/${kind}/plantilla`,
      action: IMPORT_ACTIONS[kind],
      handler: async (_req, res) => {
        const file = await useCases.getTemplate.execute(securityContextOf(res), kind);
        res.type(XLSX).attachment(`plantilla-${kind}.xlsx`).send(Buffer.from(file));
      },
    },
    upload(useCases, kind, 'vista_previa'),
    upload(useCases, kind, 'aplicar'),
  ]);
}
