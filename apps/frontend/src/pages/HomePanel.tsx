// Panel de bienvenida de las pantallas de inicio del POS y de la administración.
import { Paper, Stack, Typography } from '@mui/material';
import { useAuth } from '../auth/AuthContext';
import { ROLE_NAMES } from '../navigation';
import { glassSurface } from '../theme';

export function HomePanel({ title, description }: { title: string; description: string }) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Paper elevation={0} sx={(t) => ({ ...glassSurface(t), p: { xs: 2, sm: 4 } })}>
      <Stack spacing={1.5}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography variant="h6" color="text.secondary">
          Hola, {user.nombre}
          {user.rolActivo !== null && ` · ${ROLE_NAMES[user.rolActivo]}`}
        </Typography>
        <Typography color="text.secondary">{description}</Typography>
      </Stack>
    </Paper>
  );
}
