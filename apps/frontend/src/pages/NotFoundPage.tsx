import { Button, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';

export function NotFoundPage() {
  return (
    <AuthLayout title="Página no encontrada">
      <Typography color="text.secondary">La dirección que abriste no existe.</Typography>
      <Button component={RouterLink} to="/" variant="contained">
        Ir al inicio
      </Button>
    </AuthLayout>
  );
}
