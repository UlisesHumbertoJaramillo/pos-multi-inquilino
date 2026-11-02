// Sección de una pantalla de administración: panel de vidrio con título y acciones.
import { Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { glassSurface } from '../theme';

export function PageSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper elevation={0} sx={(t) => ({ ...glassSurface(t), p: { xs: 2, sm: 3 } })}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, flexGrow: 1 }}>
            {title}
          </Typography>
          {actions}
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
}

// Mensaje de error legible de cualquier falla de la API.
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
