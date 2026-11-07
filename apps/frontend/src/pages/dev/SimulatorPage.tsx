// Control del simulador de la pasarela (T-174). Solo existe fuera de producción: en producción el
// backend no registra estas rutas.
import type { FiscalSimulator, GatewaySimulator } from '@pos/contracts';
import { Alert, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { collectionsApi } from '../../api/collections';
import { fiscalApi } from '../../api/fiscal';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

const MODES: { value: GatewaySimulator['modo']; label: string; help: string }[] = [
  { value: 'aprobar', label: 'Aprobar', help: 'Todo cobro se aprueba.' },
  { value: 'rechazar', label: 'Rechazar', help: 'Todo cobro se rechaza.' },
  {
    value: 'no_responder',
    label: 'No responder',
    help: 'El cobro queda por verificar. Al volver a "Aprobar" o "Rechazar", el worker lo resuelve.',
  },
  {
    value: 'aprobar_tarde',
    label: 'Aprobar tarde',
    help: 'Sin respuesta al cobrar; la pasarela lo aprueba a los 4 minutos.',
  },
];

const FISCAL_MODES: { value: FiscalSimulator['modo']; label: string }[] = [
  { value: 'acepta', label: 'Acepta' },
  { value: 'rechaza', label: 'Rechaza' },
  { value: 'caido', label: 'Caído' },
];

export function SimulatorPage() {
  const { request } = useAuth();
  const api = useMemo(() => collectionsApi(request), [request]);
  const fiscal = useMemo(() => fiscalApi(request), [request]);
  const fetchFiscal = useCallback(() => fiscal.simulator(), [fiscal]);
  const fiscalMode = useLoader(fetchFiscal, 'No se pudo leer el simulador de ARCA.');
  const fetchMode = useCallback(() => api.simulator(), [api]);
  const loaded = useLoader(fetchMode, 'No se pudo leer el simulador.');
  const [error, setError] = useState<string | null>(null);

  async function change(modo: GatewaySimulator['modo']) {
    setError(null);
    try {
      await api.setSimulator(modo);
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo cambiar el modo.'));
    }
  }

  async function changeFiscal(modo: FiscalSimulator['modo']) {
    setError(null);
    try {
      await fiscal.setSimulator(modo);
      fiscalMode.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo cambiar el modo.'));
    }
  }

  return (
    <AppShell>
      <PageSection title="Simulador de ARCA">
        {fiscalMode.data && (
          <RadioGroup
            aria-label="Modo del simulador de ARCA"
            value={fiscalMode.data.modo}
            onChange={(e) => void changeFiscal(e.target.value as FiscalSimulator['modo'])}
          >
            {FISCAL_MODES.map((m) => (
              <FormControlLabel key={m.value} value={m.value} control={<Radio />} label={m.label} />
            ))}
          </RadioGroup>
        )}
      </PageSection>
      <PageSection title="Simulador de la pasarela">
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {loaded.data && (
          <RadioGroup
            aria-label="Modo del simulador"
            value={loaded.data.modo}
            onChange={(e) => void change(e.target.value as GatewaySimulator['modo'])}
          >
            {MODES.map((m) => (
              <div key={m.value}>
                <FormControlLabel value={m.value} control={<Radio />} label={m.label} />
                <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                  {m.help}
                </Typography>
              </div>
            ))}
          </RadioGroup>
        )}
      </PageSection>
    </AppShell>
  );
}
