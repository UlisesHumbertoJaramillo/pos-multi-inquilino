// Cliente HTTP base hacia la API. El frontend se comunica con el backend solo por endpoints (Const. 15).
const API_URL = import.meta.env.VITE_API_URL ?? 'https://localhost:3000';

const UNEXPECTED_ERROR_MESSAGE = 'Ocurrió un error inesperado.';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  codigo?: unknown;
  mensaje?: unknown;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as ErrorBody;
  return new ApiError(
    response.status,
    typeof body.codigo === 'string' ? body.codigo : null,
    typeof body.mensaje === 'string' ? body.mensaje : UNEXPECTED_ERROR_MESSAGE,
  );
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && init.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, null, 'No hay conexión con el servidor.');
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
