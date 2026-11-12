// Diálogos de caja: un monto (con motivo opcional) y el resultado de un arqueo.
import type { CashCount } from '@pos/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { RESULT_NAMES } from '../../api/cash';

export interface AmountRequest {
  title: string;
  label: string;
  helper?: string;
  withReason: boolean;
  confirm: string;
}

export function AmountDialog({
  request,
  error,
  onConfirm,
  onCancel,
}: {
  request: AmountRequest;
  error: string | null;
  onConfirm: (amount: string, reason: string) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>{request.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          {request.helper && <Typography variant="body2">{request.helper}</Typography>}
          <TextField
            label={request.label}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            autoFocus
            data-atajos="datos"
          />
          {request.withReason && (
            <TextField
              label="Motivo"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={amount.trim() === '' || (request.withReason && reason.trim() === '')}
          onClick={() => {
            onConfirm(amount.trim().replace(',', '.'), reason);
          }}
        >
          {request.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Resultado de un cierre. El resultado, la diferencia y el teórico solo llegan en las respuestas
// para un AS o un AC; un VO ve solo lo que declaró (D-80).
export function CountResultDialog({
  title,
  count,
  onClose,
}: {
  title: string;
  count: CashCount;
  onClose: () => void;
}) {
  const { resultado, diferencia, teorico } = count;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ pt: 1 }}>
          {resultado === undefined ? (
            <Alert severity="success">
              Cierre registrado. El resultado del arqueo lo ven el AS y el AC.
            </Alert>
          ) : (
            <Alert severity={resultado === 'cuadrado' ? 'success' : 'warning'}>
              Arqueo: {RESULT_NAMES[resultado]}
            </Alert>
          )}
          <Typography>Declarado: {formatMoney(count.declarado)}</Typography>
          {teorico !== undefined && <Typography>Teórico: {formatMoney(teorico)}</Typography>}
          {diferencia !== undefined && (
            <Typography>Diferencia: {formatMoney(diferencia)}</Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Listo
        </Button>
      </DialogActions>
    </Dialog>
  );
}
