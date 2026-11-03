// Compras del AC: registrar una compra a crédito con su sucursal de destino y ver su estado
// (T-110; RF-036). El total, la deuda y el recálculo de precios los hace el backend.
import type { Purchase } from '@pos/contracts';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
import { catalogApi, formatMoney } from '../../api/catalog';
import { formatQuantity } from '../../api/inventory';
import { suppliersApi } from '../../api/suppliers';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

interface PurchaseForm {
  proveedorId: string;
  sucursalId: string;
  comprobante: string;
  items: { productoId: string; cantidad: string; costoUnitario: string }[];
}

// "Agua: 10 de 12" en una compra recibida con diferencia.
export function describeItems(purchase: Purchase): string {
  return purchase.items
    .map((item) => {
      const missing = Number(item.diferencia ?? 0);
      return `${formatQuantity(item.cantidad)} × ${item.nombre}${missing > 0 ? ` (faltaron ${formatQuantity(item.diferencia)})` : ''}`;
    })
    .join(', ');
}

export function PurchasesPage() {
  const { request } = useAuth();
  const api = useMemo(() => suppliersApi(request), [request]);
  const catalog = useMemo(() => catalogApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<PurchaseForm | null>(null);

  const fetchData = useCallback(
    async () => ({
      purchases: await api.listPurchases(),
      suppliers: await api.listSuppliers(),
      branches: await catalog.listBranches(),
      products: (await catalog.listProducts()).filter((p) => p.tipo === 'simple'),
    }),
    [api, catalog],
  );
  const loaded = useLoader(fetchData, 'No se pudieron cargar las compras.');
  const data = loaded.data;
  const products = data?.products ?? [];
  const costOf = (id: string) => products.find((p) => p.id === id)?.costo ?? '';

  async function save() {
    if (!form) return;
    setError(null);
    setNotice(null);
    try {
      const purchase = await api.registerPurchase({
        proveedorId: form.proveedorId,
        sucursalId: form.sucursalId,
        comprobante: form.comprobante.trim() || null,
        items: form.items,
      });
      setForm(null);
      setNotice(
        `Compra registrada por ${formatMoney(purchase.total)}. Queda pendiente de recepción en ${purchase.sucursal.nombre}.`,
      );
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo registrar la compra.'));
    }
  }

  const newItem = () => {
    const first = products[0];
    return { productoId: first?.id ?? '', cantidad: '', costoUnitario: first?.costo ?? '' };
  };

  return (
    <AppShell>
      <PageSection
        title="Compras"
        actions={
          <Button
            variant="contained"
            disabled={(data?.suppliers.length ?? 0) === 0 || products.length === 0}
            onClick={() => {
              setForm({
                proveedorId: data?.suppliers[0]?.id ?? '',
                sucursalId: data?.branches[0]?.sucursalId ?? '',
                comprobante: '',
                items: [newItem()],
              });
            }}
          >
            Nueva compra
          </Button>
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Compras">
            <TableHead>
              <TableRow>
                <TableCell>Fecha</TableCell>
                <TableCell>Proveedor</TableCell>
                <TableCell>Destino</TableCell>
                <TableCell>Productos</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Estado</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.purchases.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.registradaEn).toLocaleDateString('es-AR')}</TableCell>
                  <TableCell>
                    {p.proveedor.razonSocial}
                    {p.comprobante ? ` · ${p.comprobante}` : ''}
                  </TableCell>
                  <TableCell>{p.sucursal.nombre}</TableCell>
                  <TableCell>{describeItems(p)}</TableCell>
                  <TableCell align="right">{formatMoney(p.total)}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={p.estado === 'pendiente' ? 'info' : 'default'}
                      label={p.estado === 'pendiente' ? 'Pendiente de recepción' : 'Recibida'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </PageSection>

      <Dialog
        open={form !== null}
        onClose={() => {
          setForm(null);
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Nueva compra a crédito</DialogTitle>
        <DialogContent>
          {form !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Proveedor"
                  value={form.proveedorId}
                  onChange={(e) => {
                    setForm({ ...form, proveedorId: e.target.value });
                  }}
                  sx={{ flexGrow: 1 }}
                >
                  {data?.suppliers.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.razonSocial}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Sucursal de destino"
                  value={form.sucursalId}
                  onChange={(e) => {
                    setForm({ ...form, sucursalId: e.target.value });
                  }}
                  sx={{ minWidth: 180 }}
                >
                  {data?.branches.map((b) => (
                    <MenuItem key={b.sucursalId} value={b.sucursalId}>
                      {b.nombre}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Factura o remito (opcional)"
                  value={form.comprobante}
                  onChange={(e) => {
                    setForm({ ...form, comprobante: e.target.value });
                  }}
                />
              </Stack>
              {form.items.map((item, index) => {
                const update = (change: Partial<typeof item>) => {
                  const items = [...form.items];
                  items[index] = { ...item, ...change };
                  setForm({ ...form, items });
                };
                return (
                  <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      select
                      label={`Producto ${String(index + 1)}`}
                      value={item.productoId}
                      onChange={(e) => {
                        update({
                          productoId: e.target.value,
                          costoUnitario: costOf(e.target.value),
                        });
                      }}
                      sx={{ flexGrow: 1 }}
                    >
                      {products.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                          {p.nombre}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label={`Cantidad ${String(index + 1)}`}
                      value={item.cantidad}
                      onChange={(e) => {
                        update({ cantidad: e.target.value });
                      }}
                      sx={{ width: 120 }}
                    />
                    <TextField
                      label={`Costo unitario ${String(index + 1)}`}
                      value={item.costoUnitario}
                      onChange={(e) => {
                        update({ costoUnitario: e.target.value });
                      }}
                      helperText={index === 0 ? 'Sin IVA' : ' '}
                      sx={{ width: 160 }}
                    />
                    {form.items.length > 1 && (
                      <IconButton
                        aria-label={`Quitar producto ${String(index + 1)}`}
                        onClick={() => {
                          setForm({ ...form, items: form.items.filter((_, i) => i !== index) });
                        }}
                      >
                        ×
                      </IconButton>
                    )}
                  </Stack>
                );
              })}
              <Button
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setForm({ ...form, items: [...form.items, newItem()] });
                }}
              >
                Agregar producto
              </Button>
              <Alert severity="info">
                El costo de cada producto pasa a ser el de esta compra y sus precios se recalculan.
              </Alert>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setForm(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={() => void save()}
            disabled={
              !form?.proveedorId ||
              !form.sucursalId ||
              form.items.some((i) => !i.productoId || !i.cantidad || !i.costoUnitario)
            }
          >
            Registrar compra
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
