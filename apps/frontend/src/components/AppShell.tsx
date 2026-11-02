// Marco de la aplicación autenticada: barra superior de vidrio con el rol activo, el cambio de
// rol y la salida, y el menú del rol activo.
import type { Role } from '@pos/contracts';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/httpClient';
import { useAuth } from '../auth/AuthContext';
import { homeFor, NAVIGATION, ROLE_NAMES } from '../navigation';
import { glassSurface, pageBackground } from '../theme';
import { ColorModeToggle } from './ColorModeToggle';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, selectRole, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const role = user.rolActivo;
  const otherRoles = user.roles.filter((r) => r !== role);

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
        <Toolbar sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }}>
            Sistema POS
          </Typography>
          {role !== null && (
            <Chip color="primary" label={ROLE_NAMES[role]} data-testid="rol-activo" />
          )}
          {otherRoles.length > 0 && (
            <>
              <Button
                startIcon={<SwapHorizOutlined />}
                onClick={(event) => {
                  setMenuAnchor(event.currentTarget);
                }}
              >
                Cambiar rol
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
                    {ROLE_NAMES[r]}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
          <ColorModeToggle />
          <Button
            color="inherit"
            startIcon={<LogoutOutlined />}
            onClick={() => {
              void logout().then(() => navigate('/login'));
            }}
          >
            Salir
          </Button>
        </Toolbar>
      </AppBar>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ p: 2 }}>
        {role !== null && (
          <Paper
            elevation={0}
            component="nav"
            aria-label="Menú principal"
            sx={(t) => ({ ...glassSurface(t), minWidth: 240, alignSelf: 'flex-start' })}
          >
            <List>
              {NAVIGATION[role].map((item) => (
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
        <Box component="main" sx={{ flexGrow: 1 }}>
          {error !== null && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {children}
        </Box>
      </Stack>
    </Box>
  );
}
