// Cuentas de plataforma: el SA crea otros SA (T-058, RF-015). El primer AC de cada comercio se
// crea desde la pantalla de comercios.
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useMemo, useState, type SubmitEvent } from 'react';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';

export function AccountsPage() {
  const { request } = useAuth();
  const api = useMemo(() => platformApi(request), [request]);
  const [form, setForm] = useState({ email: '', nombre: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await api.createPlatformAdmin(form);
      setNotice(`Cuenta creada. ${created.email} va a recibir el correo para activarla.`);
      setForm({ email: '', nombre: '' });
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo crear la cuenta.'));
    }
  }

  return (
    <AppShell>
      <PageSection title="Cuentas de Super Administrador">
        <Typography color="text.secondary">
          La persona recibe un correo para activar su cuenta y elegir su contraseña. El primer
          administrador de cada comercio se crea desde Comercios.
        </Typography>
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        {error !== null && <Alert severity="error">{error}</Alert>}
        <Stack component="form" spacing={2} onSubmit={(e) => void submit(e)} sx={{ maxWidth: 480 }}>
          <TextField
            label="Nombre"
            value={form.nombre}
            onChange={(e) => {
              setForm({ ...form, nombre: e.target.value });
            }}
            required
          />
          <TextField
            label="Correo"
            type="email"
            value={form.email}
            onChange={(e) => {
              setForm({ ...form, email: e.target.value });
            }}
            required
          />
          <Button type="submit" variant="contained" disabled={!form.email || !form.nombre}>
            Crear cuenta SA
          </Button>
        </Stack>
      </PageSection>
    </AppShell>
  );
}
