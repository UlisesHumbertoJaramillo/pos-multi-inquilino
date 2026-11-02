// Comercios del SA: alta, suspensión, baja, módulo de facturación y primer AC (T-058).
// Las reglas (moneda, CUIT, pendientes fiscales) las valida el backend; acá solo se muestran.
import type { Tenant, TenantCreateRequest } from '@pos/contracts';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
import { platformApi } from '../../api/platform';
import { useAuth } from '../../auth/AuthContext';
import { useLoader } from '../../hooks/useLoader';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';

const STATUS_COLOR = { activo: 'success', suspendido: 'warning', baja: 'default' } as const;
const EMPTY_TENANT: TenantCreateRequest = {
  nombre: '',
  cuit: '',
  moneda: 'ARS',
  zonaHoraria: 'America/Argentina/Buenos_Aires',
};

export function TenantsPage() {
  const { request } = useAuth();
  const api = useMemo(() => platformApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState<TenantCreateRequest | null>(null);
  const [adminFor, setAdminFor] = useState<Tenant | null>(null);
  const [admin, setAdmin] = useState({ email: '', nombre: '' });

  const fetchTenants = useCallback(() => api.listTenants(), [api]);
  const loaded = useLoader(fetchTenants, 'No se pudieron cargar los comercios.');
  const tenants = loaded.data ?? [];

  // Ejecuta una acción, muestra su resultado y vuelve a cargar la lista.
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

  async function create() {
    if (!creating) return;
    const ok = await run(
      () => api.createTenant({ ...creating, cuit: creating.cuit?.trim() ? creating.cuit : null }),
      `Comercio «${creating.nombre}» creado.`,
    );
    if (ok) setCreating(null);
  }

  async function createAdmin() {
    if (!adminFor) return;
    const ok = await run(
      () => api.createTenantAdmin(adminFor.id, admin),
      `Cuenta creada. ${admin.email} va a recibir el correo para activarla.`,
    );
    if (ok) {
      setAdminFor(null);
      setAdmin({ email: '', nombre: '' });
    }
  }

  return (
    <AppShell>
      <PageSection
        title="Comercios"
        actions={
          <Button
            variant="contained"
            onClick={() => {
              setCreating(EMPTY_TENANT);
            }}
          >
            Nuevo comercio
          </Button>
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Comercios">
            <TableHead>
              <TableRow>
                <TableCell>Comercio</TableCell>
                <TableCell>Moneda</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Facturación</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    {tenant.nombre}
                    {tenant.cuit !== null && ` · ${tenant.cuit}`}
                  </TableCell>
                  <TableCell>{tenant.moneda}</TableCell>
                  <TableCell>
                    <Chip size="small" label={tenant.estado} color={STATUS_COLOR[tenant.estado]} />
                  </TableCell>
                  <TableCell>
                    <FormControlLabel
                      label={tenant.moduloFacturacion ? 'Activo' : 'Inactivo'}
                      control={
                        <Switch
                          checked={tenant.moduloFacturacion}
                          disabled={tenant.estado === 'baja'}
                          slotProps={{ input: { 'aria-label': `Facturación de ${tenant.nombre}` } }}
                          onChange={(event) =>
                            void run(
                              () => api.setBillingModule(tenant.id, event.target.checked),
                              event.target.checked
                                ? `Facturación activada para ${tenant.nombre}.`
                                : `Facturación desactivada para ${tenant.nombre}.`,
                            )
                          }
                        />
                      }
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      {tenant.estado !== 'baja' && (
                        <Button
                          size="small"
                          onClick={() => {
                            setAdminFor(tenant);
                          }}
                        >
                          Crear AC
                        </Button>
                      )}
                      {tenant.estado === 'activo' && (
                        <Button
                          size="small"
                          color="warning"
                          onClick={() =>
                            void run(
                              () => api.suspendTenant(tenant.id),
                              `${tenant.nombre} suspendido.`,
                            )
                          }
                        >
                          Suspender
                        </Button>
                      )}
                      {tenant.estado === 'suspendido' && (
                        <Button
                          size="small"
                          onClick={() =>
                            void run(
                              () => api.reactivateTenant(tenant.id),
                              `${tenant.nombre} reactivado.`,
                            )
                          }
                        >
                          Reactivar
                        </Button>
                      )}
                      {tenant.estado !== 'baja' && (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            if (
                              window.confirm(
                                `¿Dar de baja ${tenant.nombre}? Sus datos se conservan.`,
                              )
                            ) {
                              void run(
                                () => api.closeTenant(tenant.id),
                                `${tenant.nombre} dado de baja.`,
                              );
                            }
                          }}
                        >
                          Dar de baja
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </PageSection>

      <Dialog
        open={creating !== null}
        onClose={() => {
          setCreating(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Nuevo comercio</DialogTitle>
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
                label="CUIT (opcional)"
                value={creating.cuit ?? ''}
                onChange={(e) => {
                  setCreating({ ...creating, cuit: e.target.value });
                }}
              />
              <TextField
                label="Moneda (ISO 4217)"
                value={creating.moneda}
                onChange={(e) => {
                  setCreating({ ...creating, moneda: e.target.value.toUpperCase() });
                }}
                helperText="No se puede cambiar una vez que el comercio tenga operaciones."
                required
              />
              <TextField
                label="Zona horaria"
                value={creating.zonaHoraria}
                onChange={(e) => {
                  setCreating({ ...creating, zonaHoraria: e.target.value });
                }}
                helperText="Nombre IANA, por ejemplo America/Argentina/Cordoba."
                required
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
          <Button variant="contained" onClick={() => void create()} disabled={!creating?.nombre}>
            Crear
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={adminFor !== null}
        onClose={() => {
          setAdminFor(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Administrador de {adminFor?.nombre}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              Va a recibir un correo para activar su cuenta y elegir su contraseña.
            </Alert>
            <TextField
              label="Nombre"
              value={admin.nombre}
              onChange={(e) => {
                setAdmin({ ...admin, nombre: e.target.value });
              }}
              required
            />
            <TextField
              label="Correo"
              type="email"
              value={admin.email}
              onChange={(e) => {
                setAdmin({ ...admin, email: e.target.value });
              }}
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setAdminFor(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={() => void createAdmin()}
            disabled={!admin.email || !admin.nombre}
          >
            Crear cuenta
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
