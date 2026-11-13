// Carga desde Excel (T-296; RF-170 a RF-174), tipada con el contrato. El archivo se valida en el
// backend: acá solo se envía y se muestra el resumen que devuelve.
import type { ImportSummary } from '@pos/contracts';
import type { Request } from './platform';

export type ImportKind = 'productos' | 'proveedores' | 'precios';

export const IMPORT_KINDS: Record<ImportKind, { label: string; columns: string }> = {
  productos: {
    label: 'Productos',
    columns: 'Código de barras, Nombre, Categoría y Costo sin IVA. La categoría tiene que existir.',
  },
  proveedores: {
    label: 'Proveedores',
    columns: 'CUIT, Razón social y Contacto. El saldo adeudado no cambia.',
  },
  precios: {
    label: 'Precios',
    columns: 'Lista, Código de barras y Precio final. Solo listas de precio fijo.',
  },
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const upload = (file: File): RequestInit => ({
  method: 'POST',
  body: file,
  headers: { 'Content-Type': XLSX },
});

export const importsApi = (request: Request) => ({
  template: (kind: ImportKind) => request<Blob>(`/importaciones/${kind}/plantilla`),
  preview: (kind: ImportKind, file: File) =>
    request<ImportSummary>(`/importaciones/${kind}/vista-previa`, upload(file)),
  apply: (kind: ImportKind, file: File) =>
    request<ImportSummary>(`/importaciones/${kind}`, upload(file)),
});
