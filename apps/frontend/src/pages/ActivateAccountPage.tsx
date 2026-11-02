// Activación de una cuenta creada por otro: la persona elige su contraseña (RF-015).
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useState, type SubmitEvent } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { activateAccount } from '../api/auth';
import { ApiError } from '../api/httpClient';
import { AuthLayout } from '../components/AuthLayout';

const MIN_LENGTH = 10;

export function ActivateAccountPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mismatch = repeat.length > 0 && repeat !== password;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === null) return;
    setError(null);
    try {
      setDone((await activateAccount(token, password)).mensaje);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'No se pudo activar la cuenta.');
    }
  }

  if (token === null) {
    return (
      <AuthLayout title="Activar la cuenta">
        <Alert severity="error">El enlace no tiene un código de activación.</Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Activá tu cuenta">
      {done !== null ? (
        <>
          <Alert severity="success">{done}</Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Iniciar sesión
          </Button>
        </>
      ) : (
        <Stack component="form" spacing={2} onSubmit={(e) => void submit(e)}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Elegí tu contraseña"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            helperText={`Al menos ${String(MIN_LENGTH)} caracteres.`}
            required
          />
          <TextField
            label="Repetí la contraseña"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => {
              setRepeat(e.target.value);
            }}
            error={mismatch}
            helperText={mismatch ? 'Las contraseñas no coinciden.' : ' '}
            required
          />
          <Button
            type="submit"
            variant="contained"
            disabled={password.length < MIN_LENGTH || repeat !== password}
          >
            Activar cuenta
          </Button>
        </Stack>
      )}
    </AuthLayout>
  );
}
