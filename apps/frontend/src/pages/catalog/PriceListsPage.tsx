// Listas de precios del AC: regla, precios calculados, precios a mano, asignación a sucursales e
// impresión (T-086; RF-028, RF-032, RF-033, RF-119). Los precios los calcula el backend.
import type { Category, PriceList, PriceRule, PriceRuleType, PriceSheet } from '@pos/contracts';
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
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { catalogApi, formatMoney } from '../../api/catalog';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

const RULE_NAMES: Record<PriceRuleType, string> = {
  fijo: 'Precio fijo (cargado a mano)',
  porcentaje_costo: 'Porcentaje sobre el costo',
  por_grupo: 'Porcentaje por categoría',
};

const pct = (value: string | undefined) => `${String(Number(value ?? 0))} %`;

export function describeRule(rule: PriceRule): string {
  switch (rule.tipo) {
    case 'fijo':
      return 'Precio fijo';
    case 'porcentaje_costo':
      return `Costo + ${pct(rule.porcentaje)} + IVA`;
    case 'por_grupo':
      return `Por categoría (por defecto costo + ${pct(rule.porcentaje)} + IVA)`;
  }
}

interface ListForm {
  id: string | null;
  nombre: string;
  tipo: PriceRuleType;
  porcentaje: string;
  porCategoria: Record<string, string>;
}

const toForm = (list: PriceList): ListForm => ({
  id: list.id,
  nombre: list.nombre,
  tipo: list.regla.tipo,
  porcentaje: list.regla.porcentaje === undefined ? '' : String(Number(list.regla.porcentaje)),
  porCategoria: Object.fromEntries(
    Object.entries(list.regla.porCategoria ?? {}).map(([id, value]) => [id, String(Number(value))]),
  ),
});

const toRule = (form: ListForm): PriceRule => {
  if (form.tipo === 'fijo') return { tipo: 'fijo' };
  if (form.tipo === 'porcentaje_costo') return { tipo: form.tipo, porcentaje: form.porcentaje };
  return {
    tipo: form.tipo,
    porcentaje: form.porcentaje,
    // Una categoría sin margen propio usa el de por defecto.
    porCategoria: Object.fromEntries(
      Object.entries(form.porCategoria).filter(([, value]) => value.trim() !== ''),
    ),
  };
};

export function PriceListsPage() {
  const { request } = useAuth();
  const api = useMemo(() => catalogApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<ListForm | null>(null);
  const [sheet, setSheet] = useState<PriceSheet | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});

  const fetchData = useCallback(
    async () => ({
      lists: await api.listPriceLists(),
      branches: await api.listBranches(),
      categories: await api.listCategories(),
    }),
    [api],
  );
  const loaded = useLoader(fetchData, 'No se pudieron cargar las listas de precios.');
  const lists = loaded.data?.lists ?? [];
  const branches = loaded.data?.branches ?? [];
  const categories: Category[] = loaded.data?.categories ?? [];

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
    const body = { nombre: form.nombre, regla: toRule(form) };
    const ok = await run(
      () => (form.id ? api.updatePriceList(form.id, body) : api.createPriceList(body)),
      form.id
        ? `Lista «${form.nombre}» modificada. Sus precios se recalcularon.`
        : `Lista «${form.nombre}» creada con sus precios calculados.`,
    );
    if (ok) setForm(null);
  }

  async function openSheet(listId: string) {
    setError(null);
    try {
      setSheet(await api.getPriceSheet(listId));
      setManual({});
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudieron cargar los precios.'));
    }
  }

  async function saveManualPrice(productId: string) {
    if (!sheet) return;
    const value = manual[productId]?.trim() ?? '';
    try {
      await api.setManualPrice(sheet.lista.id, productId, value === '' ? null : value);
      setSheet(await api.getPriceSheet(sheet.lista.id));
      setManual((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== productId)),
      );
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo guardar el precio.'));
    }
  }

  return (
    <AppShell>
      <Stack spacing={3}>
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}

        <PageSection
          title="Listas de precios"
          actions={
            <Button
              variant="contained"
              onClick={() => {
                setForm({
                  id: null,
                  nombre: '',
                  tipo: 'porcentaje_costo',
                  porcentaje: '40',
                  porCategoria: {},
                });
              }}
            >
              Nueva lista
            </Button>
          }
        >
          <TableContainer>
            <Table size="small" aria-label="Listas de precios">
              <TableHead>
                <TableRow>
                  <TableCell>Lista</TableCell>
                  <TableCell>Regla</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {lists.map((list) => (
                  <TableRow key={list.id}>
                    <TableCell>{list.nombre}</TableCell>
                    <TableCell>{describeRule(list.regla)}</TableCell>
                    <TableCell align="right">
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}
                      >
                        <Button size="small" onClick={() => void openSheet(list.id)}>
                          Precios
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            setForm(toForm(list));
                          }}
                        >
                          Regla
                        </Button>
                        <Button
                          size="small"
                          href={`/admin/listas/${list.id}/imprimir`}
                          target="_blank"
                          rel="noopener"
                        >
                          Imprimir
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            if (window.confirm(`¿Dar de baja la lista ${list.nombre}?`)) {
                              void run(
                                () => api.deactivatePriceList(list.id),
                                `Lista ${list.nombre} dada de baja.`,
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

        <PageSection title="Lista activa de cada sucursal">
          <Typography variant="body2" color="text.secondary">
            Todos los puntos de venta de la sucursal usan su lista activa.
          </Typography>
          <Stack spacing={2}>
            {branches.map((branch) => (
              <TextField
                key={branch.sucursalId}
                select
                label={`Lista de ${branch.nombre}`}
                value={branch.listaId ?? ''}
                onChange={(e) =>
                  void run(
                    () => api.assignList(branch.sucursalId, e.target.value),
                    `${branch.nombre} usa ahora la lista ${lists.find((l) => l.id === e.target.value)?.nombre ?? ''}.`,
                  )
                }
                sx={{ maxWidth: 420 }}
              >
                {lists.map((list) => (
                  <MenuItem key={list.id} value={list.id}>
                    {list.nombre}
                  </MenuItem>
                ))}
              </TextField>
            ))}
          </Stack>
        </PageSection>
      </Stack>

      <Dialog
        open={form !== null}
        onClose={() => {
          setForm(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{form?.id ? `Regla de ${form.nombre}` : 'Nueva lista de precios'}</DialogTitle>
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
                select
                label="Regla"
                value={form.tipo}
                onChange={(e) => {
                  setForm({ ...form, tipo: e.target.value as PriceRuleType });
                }}
              >
                {Object.entries(RULE_NAMES).map(([value, name]) => (
                  <MenuItem key={value} value={value}>
                    {name}
                  </MenuItem>
                ))}
              </TextField>
              {form.tipo !== 'fijo' && (
                <TextField
                  label={
                    form.tipo === 'por_grupo'
                      ? 'Margen por defecto (%)'
                      : 'Margen sobre el costo (%)'
                  }
                  value={form.porcentaje}
                  onChange={(e) => {
                    setForm({ ...form, porcentaje: e.target.value });
                  }}
                  helperText="Precio final = costo × (1 + margen) × (1 + IVA de la categoría)."
                  required
                />
              )}
              {form.tipo === 'por_grupo' &&
                categories.map((category) => (
                  <TextField
                    key={category.id}
                    label={`Margen de ${category.nombre} (%)`}
                    value={form.porCategoria[category.id] ?? ''}
                    placeholder="Usa el margen por defecto"
                    onChange={(e) => {
                      setForm({
                        ...form,
                        porCategoria: { ...form.porCategoria, [category.id]: e.target.value },
                      });
                    }}
                  />
                ))}
              {form.tipo === 'fijo' && (
                <Alert severity="info">Los precios se cargan a mano desde «Precios».</Alert>
              )}
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
            disabled={!form?.nombre || (form.tipo !== 'fijo' && !form.porcentaje)}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={sheet !== null}
        onClose={() => {
          setSheet(null);
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Precios de {sheet?.lista.nombre}</DialogTitle>
        <DialogContent>
          <TableContainer>
            <Table size="small" aria-label={`Precios de ${sheet?.lista.nombre ?? ''}`}>
              <TableHead>
                <TableRow>
                  <TableCell>Producto</TableCell>
                  <TableCell>Categoría</TableCell>
                  <TableCell align="right">Precio final</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sheet?.precios.map((row) => (
                  <TableRow key={row.productoId}>
                    <TableCell>{row.nombre}</TableCell>
                    <TableCell>{row.categoria ?? 'Combo'}</TableCell>
                    <TableCell align="right">
                      {sheet.lista.regla.tipo === 'fijo' && row.tipo === 'simple' ? (
                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                          <TextField
                            size="small"
                            label={`Precio de ${row.nombre}`}
                            value={manual[row.productoId] ?? row.precioFinal ?? ''}
                            onChange={(e) => {
                              setManual({ ...manual, [row.productoId]: e.target.value });
                            }}
                            sx={{ width: 160 }}
                          />
                          <Button
                            size="small"
                            disabled={manual[row.productoId] === undefined}
                            onClick={() => void saveManualPrice(row.productoId)}
                          >
                            Guardar
                          </Button>
                        </Stack>
                      ) : (
                        formatMoney(row.precioFinal)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setSheet(null);
            }}
          >
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
