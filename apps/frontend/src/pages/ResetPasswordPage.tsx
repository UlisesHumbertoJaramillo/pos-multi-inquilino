// Restablecimiento de la contraseña desde el enlace del correo (T-047, RF-007, RF-008).
// Solo valida el formato; la vigencia del enlace la decide el backend.
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useState, type SubmitEvent } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { resetPassword } from '../api/auth';
import { ApiError } from '../api/httpClient';
import { AuthLayout } from '../components/AuthLayout';

const MIN_LENGTH = 10;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== password;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === null) return;
    setError(null);
    try {
      setDone((await resetPassword(token, password)).mensaje);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cambiar la contraseña.');
    }
  }

  if (token === null) {
    return (
      <AuthLayout title="Restablecer la contraseña">
        <Alert severity="error">El enlace no tiene un código de recuperación.</Alert>
        <Button component={RouterLink} to="/recuperar-contrasena" variant="contained">
          Pedir un enlace nuevo
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Elegí una contraseña nueva">
      {done !== null ? (
        <>
          <Alert severity="success">{done}</Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Iniciar sesión
          </Button>
        </>
      ) : (
        <Stack component="form" spacing={2} onSubmit={(e) => void submit(e)}>
          {error !== null && (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  component={RouterLink}
                  to="/recuperar-contrasena"
                >
                  Pedir otro
                </Button>
              }
            >
              {error}
            </Alert>
          )}
          <TextField
            label="Contraseña nueva"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            error={tooShort}
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
            Cambiar contraseña
          </Button>
        </Stack>
      )}
    </AuthLayout>
  );
}
