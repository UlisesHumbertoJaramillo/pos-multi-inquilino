// Pedido de recuperación de contraseña (T-047, RF-007).
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { useState, type SubmitEvent } from 'react';
import { Link as RouterLink } from 'react-router';
import { requestPasswordReset } from '../api/auth';
import { ApiError } from '../api/httpClient';
import { AuthLayout } from '../components/AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      setDone((await requestPasswordReset(email.trim())).mensaje);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'No se pudo enviar el pedido.');
    }
  }

  return (
    <AuthLayout title="Recuperar la contraseña">
      {done !== null ? (
        <Alert severity="success">{done}</Alert>
      ) : (
        <Stack component="form" spacing={2} onSubmit={(e) => void submit(e)}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Correo"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            required
            autoFocus
          />
          <Button type="submit" variant="contained" disabled={!email}>
            Enviar enlace
          </Button>
        </Stack>
      )}
      <Link component={RouterLink} to="/login" sx={{ textAlign: 'center' }}>
        Volver al inicio de sesión
      </Link>
    </AuthLayout>
  );
}
