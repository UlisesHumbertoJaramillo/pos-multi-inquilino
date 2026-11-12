// Marco de la aplicación autenticada, igual para los cuatro roles (T-256; RF-178, RF-193):
// encabezado de vidrio con dónde se está operando (comercio, sucursal y caja), quién opera, las
// alertas y la salida, y el menú del rol activo. Los roles del comercio tienen la conexión en vivo
// (AD-06): el VO recibe el stock de su sucursal.
import type { Role, SessionUser } from '@pos/contracts';
import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import PointOfSaleOutlined from '@mui/icons-material/PointOfSaleOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/httpClient';
import { useAuth } from '../auth/AuthContext';
import { homeFor, navigationFor, ROLE_NAMES } from '../navigation';
import { RealtimeProvider, useRealtime } from '../realtime/RealtimeContext';
import { glassSurface, pageBackground } from '../theme';
import { AlertIndicator, AlertsProvider, CriticalAlertNotice } from './AlertCenter';
import { ShortcutsProvider, useDialogConfirm } from '../shortcuts/ShortcutsContext';
import { ColorModeToggle } from './ColorModeToggle';
import { QuickNav } from './QuickNav';
import { Status } from './Status';

export function AppShell({
  register = null,
  children,
}: {
  // Caja del turno abierto, para mostrarla en el encabezado del POS.
  register?: string | null;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const role = user?.rolActivo ?? null;
  if (!user || role === null || role === 'SA') {
    return (
      <ShortcutsProvider pos={false}>
        <Shell register={register}>{children}</Shell>
      </ShortcutsProvider>
    );
  }
  return (
    <RealtimeProvider branchId={role === 'VO' ? (user.sucursales[0] ?? null) : null}>
      <ShortcutsProvider pos={role === 'VO'}>
        <AlertsProvider>
          <Shell register={register}>{children}</Shell>
        </AlertsProvider>
      </ShortcutsProvider>
    </RealtimeProvider>
  );
}

function ConnectionStatus() {
  const { status } = useRealtime();
  if (status !== 'sin_conexion') return null;
  return (
    <Box data-testid="sin-conexion">
      <Status severity="critica" label="Sin conexión" />
    </Box>
  );
}

// Sucursal en la que se opera: la del VO, las del AS o todo el comercio para el AC.
function branchLabel(user: SessionUser): { text: string; detail: string | null } {
  const branches = user.detalleSucursales;
  if (user.rolActivo === 'SA') return { text: 'Plataforma', detail: null };
  if (user.rolActivo === 'AC') return { text: 'Todas las sucursales', detail: null };
  if (branches.length === 1) return { text: branches[0]?.nombre ?? '', detail: null };
  return {
    text: `${String(branches.length)} sucursales`,
    detail: branches.map((b) => b.nombre).join(', '),
  };
}

function Place({ icon, text, detail }: { icon: ReactNode; text: string; detail?: string | null }) {
  const content = (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
      <Typography noWrap sx={{ fontWeight: 500 }}>
        {text}
      </Typography>
    </Stack>
  );
  return detail ? <Tooltip title={detail}>{content}</Tooltip> : content;
}

function Shell({ register, children }: { register: string | null; children: ReactNode }) {
  const { user, selectRole, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Enter confirma la acción principal de cualquier diálogo (RF-194).
  useDialogConfirm();

  if (!user) return null;
  const role = user.rolActivo;
  const otherRoles = user.roles.filter((r) => r !== role);
  const branch = branchLabel(user);

  async function changeRole(next: Role) {
    setMenuAnchor(null);
    setError(null);
    try {
      await selectRole(next);
      void navigate(homeFor(next));
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cambiar de rol.');
    }
  }

  return (
    <Box sx={pageBackground}>
      <AppBar
        position="sticky"
        elevation={0}
        color="transparent"
        sx={(t) => ({ ...glassSurface(t), borderRadius: 0, borderWidth: '0 0 1px 0' })}
      >
        <Toolbar sx={{ gap: { xs: 1.5, md: 3 }, flexWrap: 'wrap', py: 1 }}>
          <Typography
            variant="h6"
            component="p"
            sx={{ fontWeight: 700, color: 'primary.main', letterSpacing: '-0.01em' }}
          >
            {user.nombreComercio ?? 'Sistema POS'}
          </Typography>
          <Stack
            direction="row"
            spacing={{ xs: 1.5, md: 3 }}
            aria-label="Dónde estás operando"
            sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}
          >
            <Place icon={<StorefrontOutlined fontSize="small" />} {...branch} />
            {register !== null && (
              <Place icon={<PointOfSaleOutlined fontSize="small" />} text={register} />
            )}
          </Stack>
          {role !== null && role !== 'VO' && (
            <QuickNav role={role} billingModule={user.moduloFacturacion} />
          )}
          <ConnectionStatus />
          {role !== null && role !== 'SA' && <AlertIndicator />}
          <Button
            color="inherit"
            startIcon={<AccountCircleOutlined />}
            aria-label={`${user.nombre}, ${role === null ? 'sin rol' : ROLE_NAMES[role]}`}
            onClick={(event) => {
              setMenuAnchor(event.currentTarget);
            }}
            sx={{ textAlign: 'left' }}
          >
            <Box
              component="span"
              sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}
            >
              <span>{user.nombre}</span>
              {role !== null && (
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  data-testid="rol-activo"
                >
                  {ROLE_NAMES[role]}
                </Typography>
              )}
            </Box>
          </Button>
          <Menu
            anchorEl={menuAnchor}
            open={menuAnchor !== null}
            onClose={() => {
              setMenuAnchor(null);
            }}
          >
            {otherRoles.map((r) => (
              <MenuItem key={r} onClick={() => void changeRole(r)}>
                <ListItemIcon>
                  <SwapHorizOutlined fontSize="small" />
                </ListItemIcon>
                Cambiar a {ROLE_NAMES[r]}
              </MenuItem>
            ))}
            {otherRoles.length > 0 && <Divider />}
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                void logout().then(() => navigate('/login'));
              }}
            >
              <ListItemIcon>
                <LogoutOutlined fontSize="small" />
              </ListItemIcon>
              Salir
            </MenuItem>
          </Menu>
          <ColorModeToggle />
        </Toolbar>
      </AppBar>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2 }}>
        {role !== null && (
          <Paper
            elevation={0}
            component="nav"
            aria-label="Menú principal"
            sx={(t) => ({ ...glassSurface(t), minWidth: 240, alignSelf: 'flex-start', p: 1 })}
          >
            <List disablePadding>
              {navigationFor(role, user.moduloFacturacion).map((item) => (
                <ListItemButton
                  key={item.path}
                  disabled={!item.available}
                  selected={location.pathname === item.path}
                  onClick={() => void navigate(item.path)}
                >
                  <ListItemText
                    primary={item.label}
                    secondary={item.available ? undefined : 'Próximamente'}
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        )}
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          {error !== null && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <CriticalAlertNotice />
          {children}
        </Box>
      </Stack>
    </Box>
  );
}
