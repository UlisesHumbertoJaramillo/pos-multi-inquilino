// Catálogo del AC: categorías con IVA y productos con imagen (T-085; RF-029, RF-130, RF-159).
// El código de barras único, el IVA y los precios los valida y calcula el backend.
import type { Category, Product } from '@pos/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { catalogApi, formatMoney, formatRate } from '../../api/catalog';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { Status } from '../../components/Status';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { ProductImage } from './ProductImage';

interface ProductForm {
  id: string | null;
  nombre: string;
  codigoBarras: string;
  categoriaId: string;
  costo: string;
  imagen: File | null;
}

export function CatalogPage() {
  const { request } = useAuth();
  const api = useMemo(() => catalogApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [category, setCategory] = useState<{
    id: string | null;
    nombre: string;
    tasaIva: string;
  } | null>(null);
  const [product, setProduct] = useState<ProductForm | null>(null);
  const [imageVersion, setImageVersion] = useState(0);

  const fetchData = useCallback(
    async () => ({ categories: await api.listCategories(), products: await api.listProducts() }),
    [api],
  );
  const loaded = useLoader(fetchData, 'No se pudo cargar el catálogo.');
  const categories = loaded.data?.categories ?? [];
  const products = (loaded.data?.products ?? []).filter((p) => p.tipo === 'simple');
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.nombre ?? '—';
  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      loaded.reload();
      return true;
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo completar la acción.'));
      return false;
    }
  }

  async function saveCategory() {
    if (!category) return;
    const body = { nombre: category.nombre, tasaIva: category.tasaIva };
    const ok = await run(
      () => (category.id ? api.updateCategory(category.id, body) : api.createCategory(body)),
      category.id
        ? `Categoría «${category.nombre}» modificada.`
        : `Categoría «${category.nombre}» creada.`,
    );
    if (ok) setCategory(null);
  }

  async function saveProduct() {
    if (!product) return;
    const body = {
      nombre: product.nombre,
      codigoBarras: product.codigoBarras.trim() ? product.codigoBarras : null,
      categoriaId: product.categoriaId,
      costo: product.costo,
    };
    const ok = await run(
      async () => {
        const saved = product.id
          ? await api.updateProduct(product.id, body)
          : await api.createProduct(body);
        if (product.imagen) {
          await api.uploadImage(saved.id, product.imagen);
          setImageVersion((v) => v + 1);
        }
      },
      product.id
        ? `Producto «${product.nombre}» modificado.`
        : `Producto «${product.nombre}» creado.`,
    );
    if (ok) setProduct(null);
  }

  const editProduct = (p: Product) => {
    setProduct({
      id: p.id,
      nombre: p.nombre,
      codigoBarras: p.codigoBarras ?? '',
      categoriaId: p.categoriaId ?? '',
      costo: p.costo ?? '',
      imagen: null,
    });
  };

  return (
    <AppShell>
      <Stack spacing={3}>
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}

        <PageSection
          title="Categorías"
          actions={
            <Button
              variant="contained"
              onClick={() => {
                setCategory({ id: null, nombre: '', tasaIva: '21' });
              }}
            >
              Nueva categoría
            </Button>
          }
        >
          <TableContainer>
            <Table size="small" aria-label="Categorías">
              <TableHead>
                <TableRow>
                  <TableCell>Categoría</TableCell>
                  <TableCell>IVA</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {categories.map((c: Category) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.nombre}</TableCell>
                    <TableCell>{formatRate(c.tasaIva)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          onClick={() => {
                            setCategory({
                              id: c.id,
                              nombre: c.nombre,
                              tasaIva: String(Number(c.tasaIva)),
                            });
                          }}
                        >
                          Modificar
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            if (window.confirm(`¿Dar de baja la categoría ${c.nombre}?`)) {
                              void run(
                                () => api.deactivateCategory(c.id),
                                `Categoría ${c.nombre} dada de baja.`,
                              );
                            }
                          }}
                        >
                          Dar de baja
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </PageSection>

        <PageSection
          title="Productos"
          actions={
            <Button
              variant="contained"
              disabled={categories.length === 0}
              onClick={() => {
                setProduct({
                  id: null,
                  nombre: '',
                  codigoBarras: '',
                  categoriaId: categories[0]?.id ?? '',
                  costo: '',
                  imagen: null,
                });
              }}
            >
              Nuevo producto
            </Button>
          }
        >
          <TableContainer>
            <Table size="small" aria-label="Productos">
              <TableHead>
                <TableRow>
                  <TableCell />
                  <TableCell>Producto</TableCell>
                  <TableCell>Código</TableCell>
                  <TableCell>Categoría</TableCell>
                  <TableCell>Costo sin IVA</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell sx={{ width: 56 }}>
                      <ProductImage
                        productId={p.id}
                        name={p.nombre}
                        version={imageVersion}
                        load={p.tieneImagen ? api.getImage : null}
                      />
                    </TableCell>
                    <TableCell>{p.nombre}</TableCell>
                    <TableCell>
                      {p.codigoBarras ?? <Status severity="informativa" label="Sin código" />}
                    </TableCell>
                    <TableCell>{categoryName(p.categoriaId)}</TableCell>
                    <TableCell>{formatMoney(p.costo)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          onClick={() => {
                            editProduct(p);
                          }}
                        >
                          Modificar
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            if (
                              window.confirm(
                                `¿Dar de baja ${p.nombre}? Los combos que lo usan dejan de venderse.`,
                              )
                            ) {
                              void run(
                                () => api.deactivateProduct(p.id),
                                `${p.nombre} dado de baja.`,
                              );
                            }
                          }}
                        >
                          Dar de baja
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </PageSection>
      </Stack>

      <Dialog
        open={category !== null}
        onClose={() => {
          setCategory(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{category?.id ? 'Modificar categoría' : 'Nueva categoría'}</DialogTitle>
        <DialogContent>
          {category !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Nombre"
                value={category.nombre}
                onChange={(e) => {
                  setCategory({ ...category, nombre: e.target.value });
                }}
                required
                autoFocus
              />
              <TextField
                label="Tasa de IVA (%)"
                value={category.tasaIva}
                onChange={(e) => {
                  setCategory({ ...category, tasaIva: e.target.value });
                }}
                helperText="Por ejemplo 21, 10.5 o 0. Cambiarla recalcula los precios de sus productos."
                required
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCategory(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={() => void saveCategory()}
            disabled={!category?.nombre || !category.tasaIva}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={product !== null}
        onClose={() => {
          setProduct(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{product?.id ? 'Modificar producto' : 'Nuevo producto'}</DialogTitle>
        <DialogContent>
          {product !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Nombre"
                value={product.nombre}
                onChange={(e) => {
                  setProduct({ ...product, nombre: e.target.value });
                }}
                required
                autoFocus
              />
              <TextField
                label="Código de barras (opcional)"
                value={product.codigoBarras}
                onChange={(e) => {
                  setProduct({ ...product, codigoBarras: e.target.value });
                }}
                helperText="No se repite entre los productos activos del comercio."
              />
              <TextField
                select
                label="Categoría"
                value={product.categoriaId}
                onChange={(e) => {
                  setProduct({ ...product, categoriaId: e.target.value });
                }}
              >
                {categories.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.nombre} ({formatRate(c.tasaIva)})
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Costo sin IVA"
                value={product.costo}
                onChange={(e) => {
                  setProduct({ ...product, costo: e.target.value });
                }}
                helperText="Cambiarlo recalcula sus precios en las listas que dependen del costo."
                required
              />
              <Button variant="outlined" component="label">
                {product.imagen
                  ? `Imagen: ${product.imagen.name}`
                  : 'Elegir imagen (PNG, JPEG o WebP, hasta 1 MB)'}
                <input
                  hidden
                  type="file"
                  aria-label="Imagen del producto"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    setProduct({ ...product, imagen: e.target.files?.[0] ?? null });
                  }}
                />
              </Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setProduct(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={() => void saveProduct()}
            disabled={!product?.nombre || !product.costo || !product.categoriaId}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
