// Combos del AC: precio único y componentes con sus cantidades (T-086; RF-049, RF-149).
// Que un combo no sea componente de otro y su disponibilidad los decide el backend.
import type { Combo } from '@pos/contracts';
import {
  Alert,
  Button,
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
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { Status } from '../../components/Status';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

interface ComboForm {
  id: string | null;
  nombre: string;
  codigoBarras: string;
  precio: string;
  componentes: { productoId: string; cantidad: string }[];
}

export function CombosPage() {
  const { request } = useAuth();
  const api = useMemo(() => catalogApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<ComboForm | null>(null);

  const fetchData = useCallback(
    async () => ({ combos: await api.listCombos(), products: await api.listProducts() }),
    [api],
  );
  const loaded = useLoader(fetchData, 'No se pudieron cargar los combos.');
  const combos = loaded.data?.combos ?? [];
  // Se ofrecen solo productos simples: el backend igual rechaza un combo como componente.
  const simples = (loaded.data?.products ?? []).filter((p) => p.tipo === 'simple');

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

  async function save() {
    if (!form) return;
    const body = {
      nombre: form.nombre,
      codigoBarras: form.codigoBarras.trim() ? form.codigoBarras : null,
      precio: form.precio,
      componentes: form.componentes,
    };
    const ok = await run(
      () => (form.id ? api.updateCombo(form.id, body) : api.createCombo(body)),
      form.id ? `Combo «${form.nombre}» modificado.` : `Combo «${form.nombre}» creado.`,
    );
    if (ok) setForm(null);
  }

  const edit = (combo: Combo) => {
    setForm({
      id: combo.id,
      nombre: combo.nombre,
      codigoBarras: combo.codigoBarras ?? '',
      precio: combo.precioCombo ?? '',
      componentes: combo.componentes
        .filter((c) => c.activo)
        .map((c) => ({ productoId: c.productoId, cantidad: String(Number(c.cantidad)) })),
    });
  };

  return (
    <AppShell>
      <PageSection
        title="Combos"
        actions={
          <Button
            variant="contained"
            disabled={simples.length === 0}
            onClick={() => {
              setForm({
                id: null,
                nombre: '',
                codigoBarras: '',
                precio: '',
                componentes: [{ productoId: simples[0]?.id ?? '', cantidad: '1' }],
              });
            }}
          >
            Nuevo combo
          </Button>
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Combos">
            <TableHead>
              <TableRow>
                <TableCell>Combo</TableCell>
                <TableCell>Componentes</TableCell>
                <TableCell>Precio único</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {combos.map((combo) => (
                <TableRow key={combo.id}>
                  <TableCell>{combo.nombre}</TableCell>
                  <TableCell>
                    {combo.componentes
                      .map(
                        (c) =>
                          `${String(Number(c.cantidad))} × ${c.nombre}${c.activo ? '' : ' (baja)'}`,
                      )
                      .join(', ')}
                  </TableCell>
                  <TableCell>{formatMoney(combo.precioCombo)}</TableCell>
                  <TableCell>
                    {combo.disponible ? (
                      <Status severity="correcta" label="Disponible" />
                    ) : (
                      <Status severity="advertencia" label="No disponible" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        onClick={() => {
                          edit(combo);
                        }}
                      >
                        Modificar
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          if (window.confirm(`¿Dar de baja el combo ${combo.nombre}?`)) {
                            void run(
                              () => api.deactivateProduct(combo.id),
                              `Combo ${combo.nombre} dado de baja.`,
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

      <Dialog
        open={form !== null}
        onClose={() => {
          setForm(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{form?.id ? 'Modificar combo' : 'Nuevo combo'}</DialogTitle>
        <DialogContent>
          {form !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Nombre"
                value={form.nombre}
                onChange={(e) => {
                  setForm({ ...form, nombre: e.target.value });
                }}
                required
                autoFocus
              />
              <TextField
                label="Código de barras (opcional)"
                value={form.codigoBarras}
                onChange={(e) => {
                  setForm({ ...form, codigoBarras: e.target.value });
                }}
              />
              <TextField
                label="Precio único (con IVA)"
                value={form.precio}
                onChange={(e) => {
                  setForm({ ...form, precio: e.target.value });
                }}
                helperText="Es el mismo en todas las listas de precios."
                required
              />
              {form.componentes.map((component, index) => (
                <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField
                    select
                    label={`Componente ${String(index + 1)}`}
                    value={component.productoId}
                    onChange={(e) => {
                      const componentes = [...form.componentes];
                      componentes[index] = { ...component, productoId: e.target.value };
                      setForm({ ...form, componentes });
                    }}
                    sx={{ flexGrow: 1 }}
                  >
                    {simples.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.nombre}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={`Cantidad ${String(index + 1)}`}
                    value={component.cantidad}
                    onChange={(e) => {
                      const componentes = [...form.componentes];
                      componentes[index] = { ...component, cantidad: e.target.value };
                      setForm({ ...form, componentes });
                    }}
                    sx={{ width: 120 }}
                  />
                  {form.componentes.length > 1 && (
                    <IconButton
                      aria-label={`Quitar componente ${String(index + 1)}`}
                      onClick={() => {
                        setForm({
                          ...form,
                          componentes: form.componentes.filter((_, i) => i !== index),
                        });
                      }}
                    >
                      ×
                    </IconButton>
                  )}
                </Stack>
              ))}
              <Button
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setForm({
                    ...form,
                    componentes: [
                      ...form.componentes,
                      { productoId: simples[0]?.id ?? '', cantidad: '1' },
                    ],
                  });
                }}
              >
                Agregar componente
              </Button>
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
            disabled={!form?.nombre || !form.precio}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
