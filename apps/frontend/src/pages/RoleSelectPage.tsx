// Elección del rol activo en el primer ingreso (T-046, RF-005).
import type { Role } from '@pos/contracts';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError } from '../api/httpClient';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { homeFor, ROLE_NAMES } from '../navigation';

export function RoleSelectPage() {
  const { status, user, selectRole } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  if (status === 'anonymous' || !user) return <Navigate to="/login" replace />;

  async function choose(role: Role) {
    setError(null);
    try {
      await selectRole(role);
      void navigate(homeFor(role));
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'No se pudo elegir el rol.');
    }
  }

  return (
    <AuthLayout title="Elegí con qué rol vas a trabajar">
      <Typography color="text.secondary">
        Hola, {user.nombre}. Podés cambiar de rol en cualquier momento sin cerrar la sesión.
      </Typography>
      {error !== null && <Alert severity="error">{error}</Alert>}
      <Stack spacing={1.5}>
        {user.roles.map((role) => (
          <Button key={role} variant="outlined" onClick={() => void choose(role)}>
            {ROLE_NAMES[role]}
          </Button>
        ))}
      </Stack>
    </AuthLayout>
  );
}
