// Usuarios del comercio para el AC: alta con roles y sucursales, cambio de roles y baja
// (T-070; RF-026). La cuenta nueva se activa por correo.
import type { RoleAssignment, TenantUser } from '@pos/contracts';
import {
  Alert,
  Button,
  Chip,
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
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { organizationApi } from '../../api/organization';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { RoleAssignmentsEditor } from './RoleAssignmentsEditor';

interface NewUser {
  email: string;
  nombre: string;
  roles: RoleAssignment[];
}

export function UsersPage() {
  const { request, user: me } = useAuth();
  const api = useMemo(() => organizationApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState<NewUser | null>(null);
  const [editing, setEditing] = useState<{ user: TenantUser; roles: RoleAssignment[] } | null>(
    null,
  );

  const fetchData = useCallback(
    async () => ({ users: await api.listUsers(), structure: await api.getStructure() }),
    [api],
  );
  const loaded = useLoader(fetchData, 'No se pudieron cargar los usuarios.');
  const users = loaded.data?.users ?? [];
  const branches = loaded.data?.structure.sucursales ?? [];
  const branchName = (id: string | null) =>
    branches.find((branch) => branch.id === id)?.nombre ?? 'sucursal dada de baja';

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
      () => api.createUser(creating),
      `Cuenta creada. ${creating.email} va a recibir el correo para activarla.`,
    );
    if (ok) setCreating(null);
  }

  async function saveRoles() {
    if (!editing) return;
    const ok = await run(
      () => api.changeRoles(editing.user.id, editing.roles),
      `Roles de ${editing.user.nombre} actualizados. Sus sesiones se cerraron.`,
    );
    if (ok) setEditing(null);
  }

  return (
    <AppShell>
      <PageSection
        title="Usuarios"
        actions={
          <Button
            variant="contained"
            onClick={() => {
              setCreating({
                email: '',
                nombre: '',
                roles: [{ rol: 'VO', sucursalId: branches[0]?.id ?? null }],
              });
            }}
          >
            Nuevo usuario
          </Button>
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Usuarios">
            <TableHead>
              <TableRow>
                <TableCell>Usuario</TableCell>
                <TableCell>Roles</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {user.nombre} · {user.email}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                      {user.roles.map((role) => (
                        <Chip
                          key={`${role.rol}-${role.sucursalId ?? ''}`}
                          size="small"
                          label={
                            role.sucursalId === null
                              ? role.rol
                              : `${role.rol} · ${branchName(role.sucursalId)}`
                          }
                        />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {!user.activo ? (
                      <Chip size="small" label="Baja" />
                    ) : user.correoValidado ? (
                      <Chip size="small" color="success" label="Activo" />
                    ) : (
                      <Chip size="small" color="warning" label="Pendiente de activación" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {user.activo && (
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          onClick={() => {
                            setEditing({ user, roles: user.roles });
                          }}
                        >
                          Roles
                        </Button>
                        {user.id !== me?.id && (
                          <Button
                            size="small"
                            color="error"
                            onClick={() => {
                              if (window.confirm(`¿Dar de baja a ${user.nombre}?`)) {
                                void run(
                                  () => api.deactivateUser(user.id),
                                  `${user.nombre} dado de baja.`,
                                );
                              }
                            }}
                          >
                            Dar de baja
                          </Button>
                        )}
                      </Stack>
                    )}
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
        <DialogTitle>Nuevo usuario</DialogTitle>
        <DialogContent>
          {creating !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="info">
                Va a recibir un correo para activar su cuenta y elegir su contraseña.
              </Alert>
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
                label="Correo"
                type="email"
                value={creating.email}
                onChange={(e) => {
                  setCreating({ ...creating, email: e.target.value });
                }}
                required
              />
              <RoleAssignmentsEditor
                value={creating.roles}
                branches={branches}
                onChange={(roles) => {
                  setCreating({ ...creating, roles });
                }}
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
            onClick={() => void create()}
            disabled={!creating?.email || !creating.nombre}
          >
            Crear cuenta
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => {
          setEditing(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Roles de {editing?.user.nombre}</DialogTitle>
        <DialogContent>
          {editing !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="info">
                Al guardar se cierran sus sesiones abiertas y el cambio queda en la auditoría.
              </Alert>
              <RoleAssignmentsEditor
                value={editing.roles}
                branches={branches}
                onChange={(roles) => {
                  setEditing({ ...editing, roles });
                }}
              />
            </Stack>
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
          <Button variant="contained" onClick={() => void saveRoles()}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
