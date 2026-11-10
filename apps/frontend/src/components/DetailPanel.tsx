// Segundo nivel de información (T-253; RF-192, D-96): un panel lateral en escritorio y de pantalla
// completa en tablet. Se cierra con Esc y devuelve el foco a quien lo abrió.
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  type Theme,
} from '@mui/material';
import type { ReactNode } from 'react';
import { glassSurface } from '../theme';

export function DetailPanel({
  title,
  open,
  onClose,
  actions,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const wide = useMediaQuery((t: Theme) => t.breakpoints.up('md'));
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-label': title,
          sx: (t: Theme) => ({ ...glassSurface(t), width: wide ? 440 : '100vw', borderRadius: 0 }),
        },
      }}
    >
      <Stack sx={{ height: '100%' }}>
        <Stack direction="row" sx={{ alignItems: 'center', p: 2, gap: 1 }}>
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          <IconButton aria-label="Cerrar el detalle" onClick={onClose}>
            <CloseOutlined />
          </IconButton>
        </Stack>
        <Divider />
        <Box sx={{ p: 2, overflowY: 'auto', flexGrow: 1 }}>{children}</Box>
        {actions && (
          <>
            <Divider />
            <Stack direction="row" spacing={1} sx={{ p: 2, justifyContent: 'flex-end' }}>
              {actions}
            </Stack>
          </>
        )}
      </Stack>
    </Drawer>
  );
}

// Lista de datos del segundo nivel: cada dato con su nombre.
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <Stack component="dl" spacing={1.5} sx={{ m: 0 }}>
      {items.map((item) => (
        <Box key={item.label}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {item.label}
          </Typography>
          <Typography component="dd" sx={{ m: 0 }}>
            {item.value}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}
