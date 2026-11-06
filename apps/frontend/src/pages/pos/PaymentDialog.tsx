// Cobro de la venta (T-185; RF-068 a RF-075): los medios electrónicos se cobran de a uno con la
// terminal y el resto se confirma al final. Importes, recargos, vuelto y control de que las
// fracciones cuadren los calcula el backend: esta pantalla solo los captura y los muestra.
import type { Cart, SalePaymentMethod } from '@pos/contracts';
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

export interface PaymentLine {
  metodoPagoId: string;
  fraccion: string;
  entregado: string | null;
}

export function PaymentDialog({
  cart,
  methods,
  error,
  onCharge,
  onConfirm,
  onCancel,
}: {
  cart: Cart;
  methods: SalePaymentMethod[];
  error: string | null;
  onCharge: (methodId: string, fraction: string) => Promise<void>;
  onConfirm: (lines: PaymentLine[]) => void;
  onCancel: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = Number(cart.porCobrar) > 0;
  const electronic = methods.filter((m) => m.tipo === 'electronico');
  const cash = methods.find((m) => m.tipo === 'efectivo');
  const credit = cart.cliente?.cuentaCorriente
    ? methods.find((m) => m.tipo === 'cuenta_corriente')
    : undefined;
  // Sin un importe elegido, lo que falta se propone en efectivo.
  const amountOf = (m: SalePaymentMethod) =>
    amounts[m.id] ?? (m.id === cash?.id && pending ? cart.porCobrar : '');
  const edit = (id: string, value: string) => {
    setAmounts({ ...amounts, [id]: value.replace(',', '.') });
  };

  const amountField = (m: SalePaymentMethod) => (
    <TextField
      label={`${m.nombre}${Number(m.recargoPct) === 0 ? '' : ` (${String(Number(m.recargoPct))} %)`}`}
      value={amountOf(m)}
      onChange={(e) => {
        edit(m.id, e.target.value);
      }}
      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
      fullWidth
    />
  );

  async function charge(m: SalePaymentMethod) {
    setBusy(true);
    await onCharge(m.id, amountOf(m).trim());
    setAmounts({});
    setBusy(false);
  }

  function confirm() {
    const lines: PaymentLine[] = [];
    for (const m of [cash, credit]) {
      if (m === undefined) continue;
      const amount = amountOf(m).trim();
      if (amount === '') continue;
      lines.push({
        metodoPagoId: m.id,
        fraccion: amount,
        entregado: m.id === cash?.id && tendered.trim() !== '' ? tendered.trim() : null,
      });
    }
    onConfirm(lines);
  }

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Cobrar la venta</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          <Typography variant="h5">Total: {formatMoney(cart.total)}</Typography>
          <Typography>Falta cobrar: {formatMoney(cart.porCobrar)}</Typography>
          {pending &&
            electronic.map((m) => (
              <Stack key={m.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {amountField(m)}
                <Button
                  variant="outlined"
                  size="large"
                  disabled={busy || amountOf(m).trim() === ''}
                  onClick={() => void charge(m)}
                >
                  Cobrar
                </Button>
              </Stack>
            ))}
          {pending && cash && (
            <Stack direction="row" spacing={1}>
              {amountField(cash)}
              <TextField
                label="Entregado"
                value={tendered}
                onChange={(e) => {
                  setTendered(e.target.value.replace(',', '.'));
                }}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                fullWidth
              />
            </Stack>
          )}
          {pending && credit && cart.cliente && (
            <Stack spacing={0.5}>
              {amountField(credit)}
              <Typography variant="caption" color="text.secondary">
                {cart.cliente.razonSocial}: disponible {formatMoney(cart.cliente.disponible)}
              </Typography>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant="contained" disabled={busy} onClick={confirm}>
          Confirmar venta
        </Button>
      </DialogActions>
    </Dialog>
  );
}
