// Cobro de cuenta corriente desde el POS (T-186; RF-128, RF-129). El saldo, el recargo y el recibo
// los calcula el backend.
import type { AccountCollection, SaleCustomer, SalePaymentMethod } from '@pos/contracts';
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
import { useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { errorMessage } from '../../components/PageSection';
import { CustomerPicker } from './CustomerPicker';

export function AccountCollectionDialog({
  methods,
  search,
  collect,
  onDone,
  onClose,
}: {
  methods: SalePaymentMethod[];
  search: (q: string) => Promise<SaleCustomer[]>;
  collect: (
    customerId: string,
    body: { metodoPagoId: string; monto: string; entregado: string | null },
  ) => Promise<AccountCollection>;
  onDone: () => void;
  onClose: () => void;
}) {
  const usable = methods.filter((m) => m.tipo !== 'cuenta_corriente');
  const [customer, setCustomer] = useState<SaleCustomer | null>(null);
  const [methodId, setMethodId] = useState(usable[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountCollection | null>(null);
  const cash = usable.find((m) => m.id === methodId)?.tipo === 'efectivo';

  async function submit() {
    if (!customer) return;
    setError(null);
    try {
      const done = await collect(customer.id, {
        metodoPagoId: methodId,
        monto: amount.trim(),
        entregado: cash && tendered.trim() !== '' ? tendered.trim() : null,
      });
      setResult(done);
      onDone();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo registrar el cobro.'));
    }
  }

  if (result) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>
          {result.recibo ? `Recibo ${String(result.recibo.numero)}` : 'Cobro sin confirmar'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography>Cliente: {result.cliente}</Typography>
            {result.recibo ? (
              <>
                <Typography>Imputado: {formatMoney(result.monto)}</Typography>
                {Number(result.recargo) !== 0 && (
                  <Typography>Recargo: {formatMoney(result.recargo)}</Typography>
                )}
                {Number(result.vuelto) > 0 && (
                  <Typography>Vuelto: {formatMoney(result.vuelto)}</Typography>
                )}
                <Typography variant="h6">Saldo: {formatMoney(result.saldoCliente)}</Typography>
              </>
            ) : (
              <Alert severity={result.estado === 'rechazado' ? 'error' : 'warning'}>
                {result.estado === 'rechazado'
                  ? 'La pasarela rechazó el pago. La deuda no cambió.'
                  : 'La pasarela no respondió. El saldo y el recibo esperan el resultado.'}
              </Alert>
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

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Cobro de cuenta corriente</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          {customer ? (
            <Typography>
              {customer.razonSocial}: debe {formatMoney(customer.saldo)}
            </Typography>
          ) : (
            <CustomerPicker search={search} onPick={setCustomer} />
          )}
          <TextField
            select
            label="Medio de pago"
            value={methodId}
            onChange={(e) => {
              setMethodId(e.target.value);
            }}
          >
            {usable.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.nombre}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Monto a imputar"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(',', '.'));
            }}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          {cash && (
            <TextField
              label="Entregado"
              value={tendered}
              onChange={(e) => {
                setTendered(e.target.value.replace(',', '.'));
              }}
              helperText="Vacío: el importe justo."
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={!customer || amount.trim() === ''}
          onClick={() => void submit()}
        >
          Registrar cobro
        </Button>
      </DialogActions>
    </Dialog>
  );
}
