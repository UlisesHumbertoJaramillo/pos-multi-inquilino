// Promociones del AC: tipos cerrados (NxM, porcentaje, precio por cantidad), alcance, vigencia y
// sucursales (T-122; RF-048). Qué promoción se aplica a cada ítem lo decide el backend.
import type { Promotion, PromotionCreateRequest } from '@pos/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { catalogApi } from '../../api/catalog';
import { describeRule, promotionsApi } from '../../api/promotions';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { DetailList, DetailPanel } from '../../components/DetailPanel';
import { Status } from '../../components/Status';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

type RuleType = PromotionCreateRequest['regla']['tipo'];

interface PromotionForm {
  id: string | null;
  nombre: string;
  tipo: RuleType;
  lleva: string;
  paga: string;
  porcentaje: string;
  cantidad: string;
  precio: string;
  alcance: PromotionCreateRequest['alcance'];
  objetivoId: string;
  desde: string;
  hasta: string;
  sucursales: string[];
}

const TYPE_NAMES: Record<RuleType, string> = {
  nxm: 'Lleve N, pague M (por ejemplo, 2x1)',
  porcentaje: 'Porcentaje de descuento',
  precio_cantidad: 'Precio especial por cantidad',
};

// Fecha y hora local para un campo datetime-local, y de vuelta a ISO.
const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => new Date(value).toISOString();

export function PromotionsPage() {
  const { request } = useAuth();
  const api = useMemo(() => promotionsApi(request), [request]);
  const catalog = useMemo(() => catalogApi(request), [request]);
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<PromotionForm | null>(null);
  const [detail, setDetail] = useState<Promotion | null>(null);

  const fetchData = useCallback(
    async () => ({
      promotions: await api.listPromotions(onlyCurrent),
      products: await catalog.listProducts(),
      categories: await catalog.listCategories(),
      branches: await catalog.listBranches(),
    }),
    [api, catalog, onlyCurrent],
  );
  const loaded = useLoader(fetchData, 'No se pudieron cargar las promociones.');
  const data = loaded.data;
  const branchName = (id: string) => data?.branches.find((b) => b.sucursalId === id)?.nombre ?? id;

  const targets =
    form?.alcance === 'categoria'
      ? (data?.categories ?? []).map((c) => ({ id: c.id, nombre: c.nombre }))
      : (data?.products ?? []).map((p) => ({ id: p.id, nombre: p.nombre }));

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
    const regla: PromotionCreateRequest['regla'] =
      form.tipo === 'nxm'
        ? { tipo: 'nxm', lleva: Number(form.lleva), paga: Number(form.paga) }
        : form.tipo === 'porcentaje'
          ? { tipo: 'porcentaje', porcentaje: form.porcentaje }
          : { tipo: 'precio_cantidad', cantidad: Number(form.cantidad), precio: form.precio };
    const body: PromotionCreateRequest = {
      nombre: form.nombre,
      regla,
      alcance: form.alcance,
      objetivoId: form.objetivoId,
      vigenteDesde: fromLocalInput(form.desde),
      vigenteHasta: fromLocalInput(form.hasta),
      sucursales: form.sucursales.length === 0 ? null : form.sucursales,
    };
    const ok = await run(
      () => (form.id ? api.updatePromotion(form.id, body) : api.createPromotion(body)),
      form.id ? `Promoción «${form.nombre}» modificada.` : `Promoción «${form.nombre}» creada.`,
    );
    if (ok) setForm(null);
  }

  const newForm = (): PromotionForm => {
    const now = new Date();
    const inMonth = new Date(now.getTime() + 30 * 86_400_000);
    return {
      id: null,
      nombre: '',
      tipo: 'nxm',
      lleva: '2',
      paga: '1',
      porcentaje: '',
      cantidad: '3',
      precio: '',
      alcance: 'categoria',
      objetivoId: data?.categories[0]?.id ?? '',
      desde: toLocalInput(now.toISOString()),
      hasta: toLocalInput(inMonth.toISOString()),
      sucursales: [],
    };
  };

  const edit = (p: Promotion) => {
    setForm({
      id: p.id,
      nombre: p.nombre,
      tipo: p.regla.tipo,
      lleva: p.regla.tipo === 'nxm' ? String(p.regla.lleva) : '2',
      paga: p.regla.tipo === 'nxm' ? String(p.regla.paga) : '1',
      porcentaje: p.regla.tipo === 'porcentaje' ? String(Number(p.regla.porcentaje)) : '',
      cantidad: p.regla.tipo === 'precio_cantidad' ? String(p.regla.cantidad) : '3',
      precio: p.regla.tipo === 'precio_cantidad' ? p.regla.precio : '',
      alcance: p.alcance,
      objetivoId: p.objetivo.id,
      desde: toLocalInput(p.vigenteDesde),
      hasta: toLocalInput(p.vigenteHasta),
      sucursales: p.sucursales ?? [],
    });
  };

  return (
    <AppShell>
      <PageSection
        title="Promociones"
        actions={
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={onlyCurrent}
                  onChange={(e) => {
                    setOnlyCurrent(e.target.checked);
                  }}
                />
              }
              label="Solo vigentes"
            />
            <Button
              variant="contained"
              onClick={() => {
                setForm(newForm());
              }}
            >
              Nueva promoción
            </Button>
          </Stack>
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Promociones">
            <TableHead>
              <TableRow>
                <TableCell>Promoción</TableCell>
                <TableCell>Regla</TableCell>
                <TableCell>Vigencia</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.promotions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.nombre}</TableCell>
                  <TableCell>{describeRule(p.regla)}</TableCell>
                  <TableCell>
                    {new Date(p.vigenteDesde).toLocaleDateString('es-AR')} al{' '}
                    {new Date(p.vigenteHasta).toLocaleDateString('es-AR')}
                  </TableCell>
                  <TableCell>
                    {p.vigente ? (
                      <Status severity="correcta" label="Vigente" />
                    ) : (
                      <Status severity="informativa" label="Fuera de vigencia" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        aria-label={`Detalle de ${p.nombre}`}
                        onClick={() => {
                          setDetail(p);
                        }}
                      >
                        Detalle
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          edit(p);
                        }}
                      >
                        Modificar
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          if (window.confirm(`¿Dar de baja la promoción ${p.nombre}?`)) {
                            void run(
                              () => api.deactivatePromotion(p.id),
                              `Promoción ${p.nombre} dada de baja.`,
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

      <DetailPanel
        title={detail?.nombre ?? 'Promoción'}
        open={detail !== null}
        onClose={() => {
          setDetail(null);
        }}
      >
        {detail && (
          <DetailList
            items={[
              { label: 'Regla', value: describeRule(detail.regla) },
              {
                label: 'Se aplica a',
                value: `${detail.alcance === 'categoria' ? 'Categoría ' : ''}${detail.objetivo.nombre}`,
              },
              {
                label: 'Vigencia',
                value: `${new Date(detail.vigenteDesde).toLocaleDateString('es-AR')} al ${new Date(detail.vigenteHasta).toLocaleDateString('es-AR')}`,
              },
              {
                label: 'Sucursales',
                value:
                  detail.sucursales === null
                    ? 'Todas'
                    : detail.sucursales.map(branchName).join(', '),
              },
            ]}
          />
        )}
      </DetailPanel>

      <Dialog
        open={form !== null}
        onClose={() => {
          setForm(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{form?.id ? 'Modificar promoción' : 'Nueva promoción'}</DialogTitle>
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
                label="Tipo"
                value={form.tipo}
                onChange={(e) => {
                  const tipo = e.target.value as RuleType;
                  // El precio por cantidad es por producto.
                  setForm({
                    ...form,
                    tipo,
                    ...(tipo === 'precio_cantidad' && form.alcance === 'categoria'
                      ? { alcance: 'producto', objetivoId: data?.products[0]?.id ?? '' }
                      : {}),
                  });
                }}
              >
                {Object.entries(TYPE_NAMES).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              {form.tipo === 'nxm' && (
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Lleva"
                    value={form.lleva}
                    onChange={(e) => {
                      setForm({ ...form, lleva: e.target.value });
                    }}
                  />
                  <TextField
                    label="Paga"
                    value={form.paga}
                    onChange={(e) => {
                      setForm({ ...form, paga: e.target.value });
                    }}
                  />
                </Stack>
              )}
              {form.tipo === 'porcentaje' && (
                <TextField
                  label="Porcentaje"
                  value={form.porcentaje}
                  onChange={(e) => {
                    setForm({ ...form, porcentaje: e.target.value });
                  }}
                />
              )}
              {form.tipo === 'precio_cantidad' && (
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Cantidad"
                    value={form.cantidad}
                    onChange={(e) => {
                      setForm({ ...form, cantidad: e.target.value });
                    }}
                  />
                  <TextField
                    label="Precio por esa cantidad"
                    value={form.precio}
                    onChange={(e) => {
                      setForm({ ...form, precio: e.target.value });
                    }}
                  />
                </Stack>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Alcance"
                  value={form.alcance}
                  disabled={form.tipo === 'precio_cantidad'}
                  onChange={(e) => {
                    const alcance = e.target.value as PromotionForm['alcance'];
                    setForm({
                      ...form,
                      alcance,
                      objetivoId:
                        (alcance === 'categoria'
                          ? data?.categories[0]?.id
                          : data?.products[0]?.id) ?? '',
                    });
                  }}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value="categoria">Categoría</MenuItem>
                  <MenuItem value="producto">Producto</MenuItem>
                </TextField>
                <TextField
                  select
                  label={form.alcance === 'categoria' ? 'Categoría' : 'Producto'}
                  value={form.objetivoId}
                  onChange={(e) => {
                    setForm({ ...form, objetivoId: e.target.value });
                  }}
                  sx={{ flexGrow: 1 }}
                >
                  {targets.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.nombre}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  type="datetime-local"
                  label="Desde"
                  value={form.desde}
                  onChange={(e) => {
                    setForm({ ...form, desde: e.target.value });
                  }}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ flexGrow: 1 }}
                />
                <TextField
                  type="datetime-local"
                  label="Hasta"
                  value={form.hasta}
                  onChange={(e) => {
                    setForm({ ...form, hasta: e.target.value });
                  }}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ flexGrow: 1 }}
                />
              </Stack>
              <TextField
                select
                label="Sucursales"
                value={form.sucursales}
                onChange={(e) => {
                  const value = e.target.value as unknown as string[] | string;
                  setForm({
                    ...form,
                    sucursales: typeof value === 'string' ? value.split(',') : value,
                  });
                }}
                slotProps={{
                  select: {
                    multiple: true,
                    displayEmpty: true,
                    renderValue: (selected) => {
                      const ids = selected as string[];
                      return ids.length === 0 ? 'Todas' : ids.map(branchName).join(', ');
                    },
                  },
                  inputLabel: { shrink: true },
                }}
                helperText="Sin selección: todas las sucursales."
              >
                {data?.branches.map((b) => (
                  <MenuItem key={b.sucursalId} value={b.sucursalId}>
                    {b.nombre}
                  </MenuItem>
                ))}
              </TextField>
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
            disabled={!form?.nombre || !form.objetivoId || !form.desde || !form.hasta}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
