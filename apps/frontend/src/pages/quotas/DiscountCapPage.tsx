// Tope de cuota de descuento del comercio (T-128; RF-063, RF-142). El recorte de las cuotas que
// lo superan lo hace el backend.
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { formatPercent, quotasApi } from '../../api/quotas';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

export function DiscountCapPage() {
  const { request } = useAuth();
  const api = useMemo(() => quotasApi(request), [request]);
  const fetchCap = useCallback(() => api.getCap(), [api]);
  const loaded = useLoader(fetchCap, 'No se pudo cargar el tope de cuota.');
  // Lo que el AC escribió; mientras no edita, los campos muestran el tope guardado.
  const [editedPercent, setPercent] = useState<string | null>(null);
  const [editedAmount, setAmount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cap = loaded.data;
  const percent = editedPercent ?? (cap ? String(Number(cap.porcentajeMaximo)) : '');
  const amount = editedAmount ?? cap?.montoMaximo ?? '';

  async function save() {
    setError(null);
    setNotice(null);
    try {
      const result = await api.setCap({ porcentajeMaximo: percent, montoMaximo: amount });
      setPercent(null);
      setAmount(null);
      setNotice(
        result.cuotasRecortadas === 0
          ? 'Tope de cuota guardado.'
          : result.cuotasRecortadas === 1
            ? 'Tope de cuota guardado. Se recortó la cuota de un vendedor que lo superaba.'
            : `Tope de cuota guardado. Se recortaron ${String(result.cuotasRecortadas)} cuotas de vendedores que lo superaban.`,
      );
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo guardar el tope.'));
    }
  }

  return (
    <AppShell>
      <PageSection title="Cuota de descuento">
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        <Typography variant="body2" color="text.secondary">
          Es el máximo que un AS puede asignar a cada vendedor: un porcentaje de descuento por venta
          y un monto acumulado por día. Los descuentos que lo superan necesitan el PIN de un AS o
          AC.
        </Typography>
        {cap && (
          <Typography variant="body2">
            Tope actual: {formatPercent(cap.porcentajeMaximo)} por venta y{' '}
            {formatMoney(cap.montoMaximo)} por día.
          </Typography>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ maxWidth: 560 }}>
          <TextField
            label="Porcentaje máximo por venta"
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value);
            }}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            helperText="Entre 0 y 100"
            fullWidth
          />
          <TextField
            label="Monto acumulado máximo"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            helperText="Por vendedor y por día"
            fullWidth
          />
        </Stack>
        <div>
          <Button variant="contained" disabled={!cap} onClick={() => void save()}>
            Guardar tope
          </Button>
        </div>
      </PageSection>
    </AppShell>
  );
}
