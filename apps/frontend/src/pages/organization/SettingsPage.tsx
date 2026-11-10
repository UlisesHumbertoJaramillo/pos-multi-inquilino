// Parámetros del comercio y métodos de pago para el AC (T-070; RF-135).
// Los márgenes de la plataforma y la política de facturación los valida el backend.
import type {
  BillingPolicy,
  PaymentMethod,
  PaymentMethodCreateRequest,
  PaymentType,
  TenantParameters,
} from '@pos/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
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
import { organizationApi } from '../../api/organization';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

type NumericParameter = Exclude<keyof TenantParameters, 'toleranciaArqueo' | 'politicaFacturacion'>;

const NUMERIC_FIELDS: { key: NumericParameter; label: string; fiscal?: boolean }[] = [
  { key: 'inactividadCarritoMin', label: 'Inactividad del carrito (min)' },
  { key: 'inactividadSesionMin', label: 'Inactividad de la sesión (min)' },
  { key: 'plazoRegularizacionHoras', label: 'Plazo de regularización fiscal (h)', fiscal: true },
  { key: 'plazoDevolucionDias', label: 'Plazo de devolución (días)' },
  { key: 'plazoFacturacionPosteriorDias', label: 'Facturación posterior (días)', fiscal: true },
];

const BILLING_POLICY_NAMES: Record<BillingPolicy, string> = {
  siempre: 'Siempre se factura',
  opcional_con_factura: 'Opcional, por defecto con factura',
  opcional_sin_factura: 'Opcional, por defecto sin factura',
};

const PAYMENT_TYPE_NAMES: Record<PaymentType, string> = {
  efectivo: 'Efectivo',
  electronico: 'Electrónico',
  cuenta_corriente: 'Cuenta corriente',
};

// "10.0000" → "+10 %", "-5.0000" → "−5 %".
function formatSurcharge(pct: string): string {
  const value = Number(pct);
  if (value === 0) return 'Sin recargo';
  const text = `${String(Math.abs(value))} %`;
  return value > 0 ? `+${text}` : `−${text}`;
}

export function SettingsPage() {
  const { request, user } = useAuth();
  const billingModule = user?.moduloFacturacion === true;
  const api = useMemo(() => organizationApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState<PaymentMethodCreateRequest | null>(null);
  const [editing, setEditing] = useState<{ method: PaymentMethod; recargoPct: string } | null>(
    null,
  );

  const fetchParameters = useCallback(() => api.getParameters(), [api]);
  const parameters = useLoader(fetchParameters, 'No se pudieron cargar los parámetros.');
  const fetchMethods = useCallback(() => api.listPaymentMethods(), [api]);
  const methods = useLoader(fetchMethods, 'No se pudieron cargar los métodos de pago.');

  // Valor que se muestra en el formulario: lo editado o lo guardado.
  const fieldValue = (key: keyof TenantParameters) =>
    draft[key] ?? String(parameters.data?.[key] ?? '');

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      return true;
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo completar la acción.'));
      return false;
    }
  }

  async function saveParameters() {
    const changes: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(draft)) {
      changes[key] =
        key === 'toleranciaArqueo' || key === 'politicaFacturacion' ? value : Number(value);
    }
    const ok = await run(() => api.updateParameters(changes), 'Parámetros guardados.');
    if (ok) {
      setDraft({});
      parameters.reload();
    }
  }

  async function createMethod() {
    if (!creating) return;
    const ok = await run(
      () => api.createPaymentMethod(creating),
      `Método «${creating.nombre}» creado.`,
    );
    if (ok) {
      setCreating(null);
      methods.reload();
    }
  }

  async function saveSurcharge() {
    if (!editing) return;
    const ok = await run(
      () => api.updatePaymentMethod(editing.method.id, { recargoPct: editing.recargoPct }),
      `Recargo de ${editing.method.nombre} actualizado.`,
    );
    if (ok) {
      setEditing(null);
      methods.reload();
    }
  }

  const loadError = error ?? parameters.error ?? methods.error;

  return (
    <AppShell>
      <Stack spacing={3}>
        {loadError !== null && <Alert severity="error">{loadError}</Alert>}
        {notice !== null && <Alert severity="success">{notice}</Alert>}

        <PageSection
          title="Parámetros del comercio"
          actions={
            <Button
              variant="contained"
              disabled={Object.keys(draft).length === 0}
              onClick={() => void saveParameters()}
            >
              Guardar parámetros
            </Button>
          }
        >
          <Grid container spacing={2}>
            {NUMERIC_FIELDS.filter(({ fiscal }) => billingModule || fiscal !== true).map(
              ({ key, label }) => (
                <Grid key={key} size={{ xs: 12, sm: 6, md: 4 }}>
                  <TextField
                    fullWidth
                    type="number"
                    label={label}
                    value={fieldValue(key)}
                    onChange={(e) => {
                      setDraft({ ...draft, [key]: e.target.value });
                    }}
                  />
                </Grid>
              ),
            )}
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <TextField
                fullWidth
                label="Tolerancia del arqueo"
                value={fieldValue('toleranciaArqueo')}
                onChange={(e) => {
                  setDraft({ ...draft, toleranciaArqueo: e.target.value });
                }}
                helperText="Diferencia aceptada en el cierre de caja."
              />
            </Grid>
            {billingModule && (
              <Grid size={{ xs: 12, md: 8 }}>
                <TextField
                  fullWidth
                  select
                  label="Política de facturación"
                  value={fieldValue('politicaFacturacion')}
                  onChange={(e) => {
                    setDraft({ ...draft, politicaFacturacion: e.target.value });
                  }}
                >
                  {Object.entries(BILLING_POLICY_NAMES).map(([value, name]) => (
                    <MenuItem key={value} value={value}>
                      {name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            )}
          </Grid>
        </PageSection>

        <PageSection
          title="Métodos de pago"
          actions={
            <Button
              variant="contained"
              onClick={() => {
                setCreating({ nombre: '', tipo: 'electronico', recargoPct: '0' });
              }}
            >
              Nuevo método
            </Button>
          }
        >
          <TableContainer>
            <Table size="small" aria-label="Métodos de pago">
              <TableHead>
                <TableRow>
                  <TableCell>Método</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Recargo o descuento</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(methods.data ?? []).map((method) => (
                  <TableRow key={method.id}>
                    <TableCell>{method.nombre}</TableCell>
                    <TableCell>{PAYMENT_TYPE_NAMES[method.tipo]}</TableCell>
                    <TableCell>{formatSurcharge(method.recargoPct)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          onClick={() => {
                            setEditing({ method, recargoPct: String(Number(method.recargoPct)) });
                          }}
                        >
                          Recargo
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            if (window.confirm(`¿Dar de baja ${method.nombre}?`)) {
                              void run(
                                () => api.deactivatePaymentMethod(method.id),
                                `${method.nombre} dado de baja.`,
                              ).then((ok) => {
                                if (ok) methods.reload();
                              });
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
        open={creating !== null}
        onClose={() => {
          setCreating(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Nuevo método de pago</DialogTitle>
        <DialogContent>
          {creating !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Nombre"
                value={creating.nombre}
                onChange={(e) => {
                  setCreating({ ...creating, nombre: e.target.value });
                }}
                required
                autoFocus
              />
              <TextField
                select
                label="Tipo"
                value={creating.tipo}
                onChange={(e) => {
                  setCreating({ ...creating, tipo: e.target.value as PaymentType });
                }}
              >
                {Object.entries(PAYMENT_TYPE_NAMES).map(([value, name]) => (
                  <MenuItem key={value} value={value}>
                    {name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Recargo (%)"
                value={creating.recargoPct}
                onChange={(e) => {
                  setCreating({ ...creating, recargoPct: e.target.value });
                }}
                helperText="Positivo es recargo; negativo, descuento. Por ejemplo 10 o -5."
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCreating(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={() => void createMethod()}
            disabled={!creating?.nombre}
          >
            Crear
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => {
          setEditing(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Recargo de {editing?.method.nombre}</DialogTitle>
        <DialogContent>
          {editing !== null && (
            <TextField
              sx={{ mt: 1 }}
              fullWidth
              label="Recargo (%)"
              value={editing.recargoPct}
              onChange={(e) => {
                setEditing({ ...editing, recargoPct: e.target.value });
              }}
              helperText="Positivo es recargo; negativo, descuento."
              autoFocus
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setEditing(null);
            }}
          >
            Cancelar
          </Button>
          <Button variant="contained" onClick={() => void saveSurcharge()}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
