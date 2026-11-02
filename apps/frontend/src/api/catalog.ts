// Llamadas del catálogo y los precios (AC), tipadas con el contrato.
import type {
  BranchPriceList,
  Category,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  Combo,
  ComboCreateRequest,
  ComboUpdateRequest,
  PriceList,
  PriceListCreateRequest,
  PriceListUpdateRequest,
  PriceSheet,
  Product,
  ProductCreateRequest,
  ProductUpdateRequest,
} from '@pos/contracts';
import type { Request } from './platform';

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const catalogApi = (request: Request) => ({
  listCategories: () => request<Category[]>('/catalogo/categorias'),
  createCategory: (body: CategoryCreateRequest) =>
    request<Category>('/catalogo/categorias', send('POST', body)),
  updateCategory: (id: string, body: CategoryUpdateRequest) =>
    request<Category>(`/catalogo/categorias/${id}`, send('PATCH', body)),
  deactivateCategory: (id: string) =>
    request<undefined>(`/catalogo/categorias/${id}/baja`, send('POST')),
  listProducts: () => request<Product[]>('/catalogo/productos'),
  createProduct: (body: ProductCreateRequest) =>
    request<Product>('/catalogo/productos', send('POST', body)),
  updateProduct: (id: string, body: ProductUpdateRequest) =>
    request<Product>(`/catalogo/productos/${id}`, send('PATCH', body)),
  deactivateProduct: (id: string) =>
    request<undefined>(`/catalogo/productos/${id}/baja`, send('POST')),
  uploadImage: (id: string, file: File) =>
    request<undefined>(`/catalogo/productos/${id}/imagen`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    }),
  getImage: (id: string) => request<Blob>(`/catalogo/productos/${id}/imagen`),
  listCombos: () => request<Combo[]>('/catalogo/combos'),
  createCombo: (body: ComboCreateRequest) => request<Combo>('/catalogo/combos', send('POST', body)),
  updateCombo: (id: string, body: ComboUpdateRequest) =>
    request<Combo>(`/catalogo/combos/${id}`, send('PATCH', body)),
  listPriceLists: () => request<PriceList[]>('/catalogo/listas'),
  createPriceList: (body: PriceListCreateRequest) =>
    request<PriceList>('/catalogo/listas', send('POST', body)),
  updatePriceList: (id: string, body: PriceListUpdateRequest) =>
    request<PriceList>(`/catalogo/listas/${id}`, send('PATCH', body)),
  deactivatePriceList: (id: string) =>
    request<undefined>(`/catalogo/listas/${id}/baja`, send('POST')),
  getPriceSheet: (id: string) => request<PriceSheet>(`/catalogo/listas/${id}/precios`),
  setManualPrice: (listId: string, productId: string, precio: string | null) =>
    request<undefined>(`/catalogo/listas/${listId}/precios/${productId}`, send('PUT', { precio })),
  listBranches: () => request<BranchPriceList[]>('/catalogo/sucursales'),
  assignList: (branchId: string, listaId: string) =>
    request<BranchPriceList>(`/catalogo/sucursales/${branchId}/lista`, send('PUT', { listaId })),
});

// "169.40" → "$ 169,40". Solo presentación: el cálculo lo hace el backend.
export function formatMoney(value: string | null): string {
  if (value === null) return 'Sin precio';
  return `$ ${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "21.0000" → "21 %".
export function formatRate(value: string): string {
  return `${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 4 })} %`;
}
