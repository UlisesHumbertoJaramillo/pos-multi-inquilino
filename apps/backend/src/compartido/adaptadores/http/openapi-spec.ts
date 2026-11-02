// Carga el contrato de la API desde packages/contracts/openapi.yaml (AD-21).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export type OpenApiSpec = Record<string, unknown>;

const SPEC_PATH = fileURLToPath(import.meta.resolve('@pos/contracts/openapi.yaml'));

export function loadOpenApiSpec(): OpenApiSpec {
  return parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiSpec;
}
