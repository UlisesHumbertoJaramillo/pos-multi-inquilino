// Configuración fiscal del AC (T-210; RF-162). El certificado y su clave se cargan pero nunca se
// vuelven a mostrar: la pantalla solo ve su fecha de vencimiento. La política está en Parámetros y
// los puntos de venta, en cada caja de Estructura.
import type { FiscalCredentialRequest } from '@pos/contracts';
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { type ChangeEvent, useCallback, useMemo, useState } from 'react';
import { fiscalApi, ISSUER_CONDITIONS } from '../../api/fiscal';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

type Form = FiscalCredentialRequest;

export function FiscalConfigPage() {
  const { request } = useAuth();
  const api = useMemo(() => fiscalApi(request), [request]);
  const fetchConfig = useCallback(() => api.configuration(), [api]);
  const loaded = useLoader(fetchConfig, 'No se pudo cargar la configuración fiscal.');
  const [form, setForm] = useState<Form>({
    cuit: '',
    condicionFiscal: 'responsable_inscripto',
    certificado: '',
    clave: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = loaded.data;

  const readFile = (field: 'certificado' | 'clave') => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const content = await file.text();
      setForm((f) => ({ ...f, [field]: content }));
    }
  };

  async function save() {
    setError(null);
    setNotice(null);
    try {
      await api.saveCredential(form);
      setNotice('Certificado guardado.');
      setForm((f) => ({ ...f, certificado: '', clave: '' }));
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo guardar el certificado.'));
    }
  }

  return (
    <AppShell>
      <PageSection title="Configuración fiscal">
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        {current && (
          <Stack spacing={2} sx={{ maxWidth: 480 }}>
            {current.certificadoVenceEn === null ? (
              <Typography>Todavía no hay un certificado cargado.</Typography>
            ) : (
              <Typography>
                Certificado de {current.cuit}: vence el{' '}
                {new Date(current.certificadoVenceEn).toLocaleDateString('es-AR')}.
              </Typography>
            )}
            <TextField
              label="CUIT"
              value={form.cuit}
              onChange={(e) => {
                setForm({ ...form, cuit: e.target.value });
              }}
            />
            <TextField
              select
              label="Condición fiscal del comercio"
              value={form.condicionFiscal}
              onChange={(e) => {
                setForm({
                  ...form,
                  condicionFiscal: e.target.value as Form['condicionFiscal'],
                });
              }}
            >
              {Object.entries(ISSUER_CONDITIONS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" component="label">
              {form.certificado === '' ? 'Elegir certificado' : 'Certificado elegido'}
              <input
                type="file"
                hidden
                aria-label="Certificado"
                onChange={(e) => void readFile('certificado')(e)}
              />
            </Button>
            <Button variant="outlined" component="label">
              {form.clave === '' ? 'Elegir clave privada' : 'Clave elegida'}
              <input
                type="file"
                hidden
                aria-label="Clave privada"
                onChange={(e) => void readFile('clave')(e)}
              />
            </Button>
            <Button
              variant="contained"
              disabled={form.cuit === '' || form.certificado === '' || form.clave === ''}
              onClick={() => void save()}
            >
              Guardar
            </Button>
          </Stack>
        )}
      </PageSection>
    </AppShell>
  );
}
