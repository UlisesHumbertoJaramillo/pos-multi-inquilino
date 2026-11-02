// Validación de correo desde el enlace del correo (T-047, RF-006).
import { Alert, Button, CircularProgress, Stack, TextField } from '@mui/material';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { confirmEmail, resendEmailValidation } from '../api/auth';
import { ApiError } from '../api/httpClient';
import { AuthLayout } from '../components/AuthLayout';

type Status = 'validating' | 'done' | 'failed';

export function ValidateEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<Status>(token === null ? 'failed' : 'validating');
  const [message, setMessage] = useState<string>(
    token === null ? 'El enlace no tiene un código de validación.' : '',
  );
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState<string | null>(null);
  // El token es de un solo uso: no se envía dos veces aunque React monte el efecto dos veces.
  const sent = useRef(false);

  useEffect(() => {
    if (token === null || sent.current) return;
    sent.current = true;
    confirmEmail(token)
      .then((response) => {
        setStatus('done');
        setMessage(response.mensaje);
      })
      .catch((e: unknown) => {
        setStatus('failed');
        setMessage(e instanceof ApiError ? e.message : 'No se pudo validar el correo.');
      });
  }, [token]);

  async function resend(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await resendEmailValidation(email.trim());
    setResent(response.mensaje);
  }

  return (
    <AuthLayout title="Validación de correo">
      {status === 'validating' && <CircularProgress aria-label="Validando" />}
      {status === 'done' && (
        <>
          <Alert severity="success">{message}</Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Iniciar sesión
          </Button>
        </>
      )}
      {status === 'failed' && (
        <Stack component="form" spacing={2} onSubmit={(e) => void resend(e)}>
          <Alert severity="error">{message}</Alert>
          {resent !== null ? (
            <Alert severity="success">{resent}</Alert>
          ) : (
            <>
              <TextField
                label="Correo"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                required
              />
              <Button type="submit" variant="contained" disabled={!email}>
                Enviar un nuevo enlace
              </Button>
            </>
          )}
        </Stack>
      )}
    </AuthLayout>
  );
}
