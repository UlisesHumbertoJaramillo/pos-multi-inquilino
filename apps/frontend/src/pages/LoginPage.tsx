// Inicio de sesión (T-046, RF-005, RF-006).
import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { useState, type SubmitEvent } from 'react';
import { Navigate, Link as RouterLink, useNavigate } from 'react-router';
import { resendEmailValidation } from '../api/auth';
import { ApiError } from '../api/httpClient';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { homeFor } from '../navigation';

export function LoginPage() {
  const { status, user, requiresRoleSelection, notice, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (status === 'authenticated' && user) {
    return (
      <Navigate to={requiresRoleSelection ? '/elegir-rol' : homeFor(user.rolActivo)} replace />
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSending(true);
    try {
      const session = await login(email.trim(), password);
      void navigate(session.requiereElegirRol ? '/elegir-rol' : homeFor(session.usuario.rolActivo));
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e : new ApiError(0, null, 'No se pudo iniciar sesión.'));
    } finally {
      setSending(false);
    }
  }

  async function resend() {
    const response = await resendEmailValidation(email.trim());
    setError(null);
    setInfo(response.mensaje);
  }

  return (
    <AuthLayout title="Iniciar sesión">
      <Stack component="form" spacing={2} onSubmit={(e) => void submit(e)} noValidate>
        {notice !== null && <Alert severity="info">{notice}</Alert>}
        {info !== null && <Alert severity="success">{info}</Alert>}
        {error !== null && (
          <Alert
            severity={error.code === 'CREDENCIAL_BLOQUEADA' ? 'warning' : 'error'}
            action={
              error.code === 'CORREO_SIN_VALIDAR' ? (
                <Button color="inherit" size="small" onClick={() => void resend()}>
                  Reenviar
                </Button>
              ) : undefined
            }
          >
            {error.message}
          </Alert>
        )}
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
        <TextField
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          required
        />
        <Button type="submit" variant="contained" disabled={sending || !email || !password}>
          {sending ? 'Ingresando…' : 'Ingresar'}
        </Button>
        <Link component={RouterLink} to="/recuperar-contrasena" sx={{ textAlign: 'center' }}>
          ¿Olvidaste tu contraseña?
        </Link>
      </Stack>
    </AuthLayout>
  );
}
