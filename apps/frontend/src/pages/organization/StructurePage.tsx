// Estructura del comercio para el AC: Comercio > Sucursales > Cajas (T-069; RF-023, RF-024, RF-027).
// Las reglas (dependencias, punto de venta único) las valida el backend; acá solo se muestran.
import type { Structure } from '@pos/contracts';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { organizationApi } from '../../api/organization';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { Status } from '../../components/Status';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

type BranchNode = Structure['sucursales'][number];

export function StructurePage() {
  const { request, user } = useAuth();
  const billingModule = user?.moduloFacturacion === true;
  const api = useMemo(() => organizationApi(request), [request]);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState<{ nombre: string; direccion: string } | null>(null);
  const [registerFor, setRegisterFor] = useState<BranchNode | null>(null);
  const [register, setRegister] = useState({ nombre: '', puntoVentaFiscal: '' });

  const fetchStructure = useCallback(() => api.getStructure(showInactive), [api, showInactive]);
  const loaded = useLoader(fetchStructure, 'No se pudo cargar la estructura del comercio.');

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

  async function createBranch() {
    if (!newBranch) return;
    const ok = await run(
      () =>
        api.createBranch({
          nombre: newBranch.nombre,
          direccion: newBranch.direccion.trim() ? newBranch.direccion : null,
        }),
      `Sucursal «${newBranch.nombre}» creada.`,
    );
    if (ok) setNewBranch(null);
  }

  async function createRegister() {
    if (!registerFor) return;
    const pointOfSale = register.puntoVentaFiscal.trim();
    const ok = await run(
      () =>
        api.createRegister(registerFor.id, {
          nombre: register.nombre,
          puntoVentaFiscal: pointOfSale ? Number(pointOfSale) : null,
        }),
      `Caja «${register.nombre}» creada en ${registerFor.nombre}.`,
    );
    if (ok) {
      setRegisterFor(null);
      setRegister({ nombre: '', puntoVentaFiscal: '' });
    }
  }

  function confirmThen(question: string, action: () => Promise<unknown>, success: string) {
    if (window.confirm(question)) void run(action, success);
  }

  const structure = loaded.data;

  return (
    <AppShell>
      <PageSection
        title={structure ? `Estructura de ${structure.comercio.nombre}` : 'Estructura'}
        actions={
          <>
            <FormControlLabel
              label="Mostrar bajas"
              control={
                <Switch
                  checked={showInactive}
                  onChange={(event) => {
                    setShowInactive(event.target.checked);
                  }}
                />
              }
            />
            <Button
              variant="contained"
              onClick={() => {
                setNewBranch({ nombre: '', direccion: '' });
              }}
            >
              Nueva sucursal
            </Button>
          </>
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        {structure?.sucursales.length === 0 && (
          <Typography color="text.secondary">Todavía no hay sucursales.</Typography>
        )}
        <Stack spacing={2} component="ul" aria-label="Sucursales" sx={{ p: 0, m: 0 }}>
          {structure?.sucursales.map((branch) => (
            <Paper
              key={branch.id}
              component="li"
              variant="outlined"
              aria-label={`Sucursal ${branch.nombre}`}
              sx={{ listStyle: 'none', p: 2, opacity: branch.activa ? 1 : 0.6 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="h6" component="h2">
                    {branch.nombre}{' '}
                    {!branch.activa && <Status severity="informativa" label="Baja" />}
                  </Typography>
                  {branch.direccion !== null && (
                    <Typography variant="body2" color="text.secondary">
                      {branch.direccion}
                    </Typography>
                  )}
                </Box>
                {branch.activa && (
                  <>
                    <Button
                      size="small"
                      onClick={() => {
                        setRegisterFor(branch);
                      }}
                    >
                      Nueva caja
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => {
                        confirmThen(
                          `¿Dar de baja la sucursal ${branch.nombre} y sus cajas? Sus datos se conservan.`,
                          () => api.deactivateBranch(branch.id),
                          `Sucursal ${branch.nombre} dada de baja.`,
                        );
                      }}
                    >
                      Dar de baja
                    </Button>
                  </>
                )}
              </Stack>
              <List dense aria-label={`Cajas de ${branch.nombre}`} sx={{ pl: 2 }}>
                {branch.cajas.length === 0 && (
                  <ListItem>
                    <ListItemText secondary="Sin cajas." />
                  </ListItem>
                )}
                {branch.cajas.map((caja) => (
                  <ListItem
                    key={caja.id}
                    sx={{ opacity: caja.activa ? 1 : 0.6 }}
                    secondaryAction={
                      caja.activa && (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            confirmThen(
                              `¿Dar de baja ${caja.nombre} de ${branch.nombre}?`,
                              () => api.deactivateRegister(caja.id),
                              `${caja.nombre} de ${branch.nombre} dada de baja.`,
                            );
                          }}
                        >
                          Dar de baja
                        </Button>
                      )
                    }
                  >
                    <ListItemText
                      primary={`${caja.nombre}${caja.activa ? '' : ' (baja)'}`}
                      {...(billingModule
                        ? {
                            secondary:
                              caja.puntoVentaFiscal === null
                                ? 'Sin punto de venta fiscal'
                                : `Punto de venta ${String(caja.puntoVentaFiscal)}`,
                          }
                        : {})}
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>
          ))}
        </Stack>
      </PageSection>

      <Dialog
        open={newBranch !== null}
        onClose={() => {
          setNewBranch(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Nueva sucursal</DialogTitle>
        <DialogContent>
          {newBranch !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Nombre"
                value={newBranch.nombre}
                onChange={(e) => {
                  setNewBranch({ ...newBranch, nombre: e.target.value });
                }}
                required
                autoFocus
              />
              <TextField
                label="Dirección (opcional)"
                value={newBranch.direccion}
                onChange={(e) => {
                  setNewBranch({ ...newBranch, direccion: e.target.value });
                }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setNewBranch(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={() => void createBranch()}
            disabled={!newBranch?.nombre}
          >
            Crear
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={registerFor !== null}
        onClose={() => {
          setRegisterFor(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Nueva caja en {registerFor?.nombre}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Nombre"
              value={register.nombre}
              onChange={(e) => {
                setRegister({ ...register, nombre: e.target.value });
              }}
              required
              autoFocus
            />
            {billingModule && (
              <TextField
                label="Punto de venta fiscal (opcional)"
                type="number"
                value={register.puntoVentaFiscal}
                onChange={(e) => {
                  setRegister({ ...register, puntoVentaFiscal: e.target.value });
                }}
                helperText="Para la facturación electrónica. No se repite entre las cajas del comercio."
                slotProps={{ htmlInput: { min: 1, max: 99999 } }}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setRegisterFor(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={() => void createRegister()}
            disabled={!register.nombre}
          >
            Crear caja
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
