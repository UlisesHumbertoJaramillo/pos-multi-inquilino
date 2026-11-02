// Oculta datos sensibles antes de escribirlos en el log (T-015, Const. 17):
// contraseñas, PIN, tokens, secretos, datos de pago y credenciales fiscales.
export const REDACTED = '[OCULTO]';

const MAX_DEPTH = 10;

// Campos cuyo nombre normalizado contiene alguna de estas palabras.
const SENSITIVE_KEY_PARTS = [
  'password',
  'contrasena',
  'passwd',
  'token',
  'secret',
  'secreto',
  'authorization',
  'cookie',
  'apikey',
  'privatekey',
  'claveprivada',
  'certificado',
  'tarjeta',
  'cardnumber',
];

// Campos cortos que se comparan completos, para no ocultar, por ejemplo, "shipping" por "pin".
const SENSITIVE_KEYS = new Set(['pin', 'cvv', 'cvc', 'pan', 'clave', 'card']);

// Secretos reconocibles dentro de un texto, aunque el campo no lo indique.
const SENSITIVE_TEXT_PATTERNS: [RegExp, string][] = [
  [/\bBearer\s+[\w\-.~+/]+=*/gi, `Bearer ${REDACTED}`],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED],
];

function normalizeKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  );
}

export function redactText(text: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[...]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactValue(item, depth + 1, seen));
  }

  const source: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (value instanceof Error) {
    // message y stack no son propiedades enumerables: se copian a mano.
    Object.assign(source, { type: value.name, message: value.message, stack: value.stack });
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(item, depth + 1, seen);
  }
  return result;
}

// Devuelve una copia con los datos sensibles ocultos. No modifica el original.
export function redactSensitive<T>(value: T): T {
  return redactValue(value, 0, new WeakSet()) as T;
}
