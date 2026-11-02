// Marco de las pantallas de acceso: una tarjeta de vidrio centrada.
import { Box, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { glassSurface, pageBackground } from '../theme';
import { ColorModeToggle } from './ColorModeToggle';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={(t) => ({ ...pageBackground(t), display: 'grid', placeItems: 'center', p: 2 })}>
      <Box sx={{ position: 'fixed', top: 12, right: 12 }}>
        <ColorModeToggle />
      </Box>
      <Paper
        elevation={0}
        sx={(t) => ({ ...glassSurface(t), width: '100%', maxWidth: 440, p: { xs: 3, sm: 4 } })}
      >
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="primary">
              Sistema POS
            </Typography>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
          </Box>
          {children}
        </Stack>
      </Paper>
    </Box>
  );
}
