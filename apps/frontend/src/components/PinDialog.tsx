// Modal de autorización por PIN (RF-141): un AS de la sucursal o un AC presente elige su nombre e
// ingresa su PIN en la pantalla de quien pide la operación. Quién puede autorizar y la regla de
// que nadie se autoriza a sí mismo los decide el backend.
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { type AuthorizationType, cashApi } from '../api/cash';
import { useAuth } from '../auth/AuthContext';
import { useLoader } from '../hooks/useLoader';
import { errorMessage } from './PageSection';

export interface PinRequest {
  type: AuthorizationType;
  operationRef: string;
  branchId: string;
  // Qué se autoriza, para quien ingresa el PIN.
  summary: string;
}

export function PinDialog({
  pending,
  onAuthorized,
  onCancel,
}: {
  pending: PinRequest;
  onAuthorized: (authorizationId: string) => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const api = useMemo(() => cashApi(request), [request]);
  const fetchAuthorizers = useCallback(
    () => api.listAuthorizers(pending.branchId),
    [api, pending.branchId],
  );
  const loaded = useLoader(fetchAuthorizers, 'No se pudo cargar quién puede autorizar.');
  const [selected, setSelected] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const authorizers = loaded.data ?? [];
  const authorizerId = selected ?? authorizers[0]?.id ?? '';

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      const authorization = await api.authorize({
        tipo: pending.type,
        operacionRef: pending.operationRef,
        sucursalId: pending.branchId,
        autorizanteId: authorizerId,
        pin,
      });
      onAuthorized(authorization.id);
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo autorizar.'));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs" data-atajos="no">
      <DialogTitle>Autorización con PIN</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">{pending.summary}</Typography>
          {(error ?? loaded.error) !== null && (
            <Alert severity="error">{error ?? loaded.error}</Alert>
          )}
          {loaded.data && authorizers.length === 0 && (
            <Alert severity="warning">
              No hay nadie con PIN que pueda autorizar en la sucursal.
            </Alert>
          )}
          <TextField
            select
            label="Autoriza"
            value={authorizerId}
            onChange={(e) => {
              setSelected(e.target.value);
            }}
          >
            {authorizers.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.nombre} ({a.rol})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="PIN"
            type="password"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
            }}
            slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off' } }}
            autoFocus
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={busy || authorizerId === '' || pin.length === 0}
          onClick={() => void confirm()}
        >
          Autorizar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
