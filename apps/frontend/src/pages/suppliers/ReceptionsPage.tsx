// Recepción de compras del AS: lo recibido entra al stock de su sucursal y la diferencia queda
// registrada (T-110; RF-133). Las validaciones las hace el backend.
import type { Purchase } from '@pos/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { formatQuantity } from '../../api/inventory';
import { suppliersApi } from '../../api/suppliers';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { describeItems } from './PurchasesPage';

export function ReceptionsPage() {
  const { request } = useAuth();
  const api = useMemo(() => suppliersApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<{
    purchase: Purchase;
    lines: Record<string, string>;
  } | null>(null);

  const fetchPending = useCallback(() => api.listPendingReceptions(), [api]);
  const loaded = useLoader(fetchPending, 'No se pudieron cargar las compras a recibir.');

  async function receive() {
    if (!receiving) return;
    setError(null);
    setNotice(null);
    try {
      const done = await api.receivePurchase(receiving.purchase.id, {
        items: receiving.purchase.items.map((item) => ({
          productoId: item.productoId,
          recibida: receiving.lines[item.productoId] ?? '0',
        })),
      });
      setReceiving(null);
      const missing = done.items.filter((i) => Number(i.diferencia ?? 0) > 0);
      setNotice(
        missing.length > 0
          ? `Compra recibida con diferencias: ${describeItems(done)}.`
          : 'Compra recibida completa: el stock ya está disponible.',
      );
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo recibir la compra.'));
    }
  }

  return (
    <AppShell>
      <PageSection title="Compras a recibir">
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        {loaded.data?.length === 0 && (
          <Typography color="text.secondary">No hay compras pendientes de recepción.</Typography>
        )}
        <TableContainer>
          <Table size="small" aria-label="Compras a recibir">
            <TableHead>
              <TableRow>
                <TableCell>Fecha</TableCell>
                <TableCell>Proveedor</TableCell>
                <TableCell>Sucursal</TableCell>
                <TableCell>Productos</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loaded.data?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.registradaEn).toLocaleDateString('es-AR')}</TableCell>
                  <TableCell>
                    {p.proveedor.razonSocial}
                    {p.comprobante ? ` · ${p.comprobante}` : ''}
                  </TableCell>
                  <TableCell>{p.sucursal.nombre}</TableCell>
                  <TableCell>{describeItems(p)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => {
                        setReceiving({
                          purchase: p,
                          lines: Object.fromEntries(
                            p.items.map((item) => [item.productoId, String(Number(item.cantidad))]),
                          ),
                        });
                      }}
                    >
                      Recibir
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </PageSection>

      <Dialog
        open={receiving !== null}
        onClose={() => {
          setReceiving(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Recibir compra de {receiving?.purchase.proveedor.razonSocial}</DialogTitle>
        <DialogContent>
          {receiving !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                Cargá lo que llegó. La diferencia con lo comprado queda registrada para reclamarla
                al proveedor; la deuda no cambia.
              </Typography>
              {receiving.purchase.items.map((item) => (
                <Stack
                  key={item.productoId}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography sx={{ flexGrow: 1 }}>
                    {item.nombre}: compradas {formatQuantity(item.cantidad)}
                  </Typography>
                  <TextField
                    label={`Recibidas de ${item.nombre}`}
                    value={receiving.lines[item.productoId] ?? ''}
                    onChange={(e) => {
                      setReceiving({
                        ...receiving,
                        lines: { ...receiving.lines, [item.productoId]: e.target.value },
                      });
                    }}
                    sx={{ width: 170 }}
                  />
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setReceiving(null);
            }}
          >
            Cancelar
          </Button>
          <Button variant="contained" onClick={() => void receive()}>
            Confirmar recepción
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
