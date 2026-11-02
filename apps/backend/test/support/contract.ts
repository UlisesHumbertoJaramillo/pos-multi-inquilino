// Valida en las pruebas que una respuesta de la API cumpla el contrato OpenAPI (T-014, AD-21).
// Falla si el código de estado no está documentado para la operación, si el tipo de contenido
// no coincide o si el cuerpo no cumple el esquema (incluidos los campos no documentados).
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadOpenApiSpec } from '../../src/compartido/adaptadores/http/openapi-spec.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

// Lo mínimo de una respuesta que se valida. Lo cumple la respuesta de supertest.
export interface ContractResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: unknown;
}

interface Operation {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> } | undefined>;
}

// Los esquemas de components se registran como $defs de un documento propio, porque el
// documento OpenAPI completo no es un esquema JSON válido para Ajv en modo estricto.
const COMPONENTS_ID = 'openapi-components';
const JSON_CONTENT_TYPE = 'application/json';

// Lee el contrato y apunta las referencias de components a ese documento.
const spec = JSON.parse(
  JSON.stringify(loadOpenApiSpec()).replaceAll(
    '"#/components/schemas/',
    `"${COMPONENTS_ID}#/$defs/`,
  ),
) as {
  paths?: Record<string, Record<string, Operation | undefined> | undefined>;
  components?: { schemas?: Record<string, unknown> };
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats.default(ajv);
// Palabras de OpenAPI que no son de JSON Schema: Ajv las acepta sin validarlas.
ajv.addVocabulary(['discriminator', 'xml', 'externalDocs', 'example']);
ajv.addSchema({ $id: COMPONENTS_ID, $defs: spec.components?.schemas ?? {} });

const validators = new Map<string, ValidateFunction>();

function findOperation(method: HttpMethod, path: string): Operation {
  const operation = spec.paths?.[path]?.[method];
  if (!operation) {
    throw new Error(`La operación ${method.toUpperCase()} ${path} no está en el contrato.`);
  }
  return operation;
}

function getValidator(key: string, schema: unknown): ValidateFunction {
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema as object);
    validators.set(key, validate);
  }
  return validate;
}

export function expectToMatchContract(
  response: ContractResponse,
  method: HttpMethod,
  path: string,
): void {
  const label = `${method.toUpperCase()} ${path}`;
  const status = String(response.status);
  const documented = findOperation(method, path).responses?.[status];
  if (!documented) {
    throw new Error(`El estado ${status} no está documentado para ${label}.`);
  }

  if (!documented.content) {
    if (response.body !== undefined && response.body !== '' && !isEmptyObject(response.body)) {
      throw new Error(`${label} ${status} no documenta un cuerpo.`);
    }
    return;
  }

  const contentType = response.headers['content-type'] ?? '';
  const schema = documented.content[JSON_CONTENT_TYPE]?.schema;
  if (!contentType.startsWith(JSON_CONTENT_TYPE) || schema === undefined) {
    throw new Error(
      `${label} ${status} respondió "${contentType}", ` +
        `y el contrato documenta: ${Object.keys(documented.content).join(', ')}.`,
    );
  }

  const validate = getValidator(`${label} ${status}`, schema);
  if (!validate(response.body)) {
    const details = ajv.errorsText(validate.errors, { dataVar: 'cuerpo', separator: '\n  ' });
    throw new Error(`La respuesta de ${label} ${status} no cumple el contrato:\n  ${details}`);
  }
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length === 0;
}
