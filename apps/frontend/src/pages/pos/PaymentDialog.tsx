// Cobro de la venta (T-185; RF-068 a RF-075): los medios electrónicos se cobran de a uno con la
// terminal y el resto se confirma al final. Importes, recargos, vuelto y control de que las
// fracciones cuadren los calcula el backend: esta pantalla solo los captura y los muestra.
// Con el teclado (T-277; RF-181, RF-182): las flechas pasan de un medio a otro, Enter en un medio
// electrónico lo cobra, y Enter en el efectivo o el atajo de cobrar confirman la venta.
import type { Cart, SaleBillingOption, SalePaymentMethod } from '@pos/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { WithShortcut } from '../../shortcuts/ShortcutHint';
import { useShortcuts } from '../../shortcuts/ShortcutsContext';
import { formatMoney } from '../../api/catalog';

export interface PaymentLine {
  metodoPagoId: string;
  fraccion: string;
  entregado: string | null;
}

// Flechas arriba y abajo: el campo anterior o el siguiente del cobro.
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const inputs = Array.from(
    (event.target as HTMLElement)
      .closest('[role="dialog"]')
      ?.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])') ?? [],
  );
  const index = inputs.indexOf(event.target as HTMLInputElement);
  const next = inputs[index + (event.key === 'ArrowDown' ? 1 : -1)];
  if (index < 0 || !next) return;
  event.preventDefault();
  next.focus();
  next.select();
}

// Importe de un medio de pago. Enter en un medio electrónico lo cobra (sin confirmar la venta).
function AmountField({
  method,
  value,
  onChange,
  onEnter,
  inputRef,
  autoFocus = false,
}: {
  method: SalePaymentMethod;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  inputRef?: (element: HTMLInputElement | null) => void;
  // El efectivo arranca con el foco: una venta en efectivo se confirma con Enter.
  autoFocus?: boolean;
}) {
  return (
    <TextField
      label={`${method.nombre}${Number(method.recargoPct) === 0 ? '' : ` (${String(Number(method.recargoPct))} %)`}`}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        moveFocus(e);
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          e.stopPropagation();
          onEnter();
        }
      }}
      slotProps={{ htmlInput: { inputMode: 'decimal' } }}
      {...(inputRef ? { inputRef } : {})}
      autoFocus={autoFocus}
      data-atajos="datos"
      fullWidth
    />
  );
}

export function PaymentDialog({
  cart,
  methods,
  billing,
  error,
  onCharge,
  onConfirm,
  onCancel,
}: {
  cart: Cart;
  methods: SalePaymentMethod[];
  billing: SaleBillingOption;
  error: string | null;
  onCharge: (methodId: string, fraction: string) => Promise<void>;
  onConfirm: (lines: PaymentLine[], invoice: boolean | null) => void;
  onCancel: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState(billing.propuesta);
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
  const cashInput = useRef<HTMLInputElement | null>(null);
  const setCashInput = useCallback((element: HTMLInputElement | null) => {
    cashInput.current = element;
  }, []);

  async function charge(m: SalePaymentMethod) {
    if (amountOf(m).trim() === '') return;
    setBusy(true);
    await onCharge(m.id, amountOf(m).trim());
    setAmounts({});
    setBusy(false);
    cashInput.current?.focus();
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
    onConfirm(lines, billing.visible ? invoice : null);
  }

  useShortcuts({
    cobrar: () => {
      if (!busy) confirm();
    },
  });

  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
      // Al terminar de abrirse, el foco queda en el efectivo: Enter confirma una venta en efectivo.
      slotProps={{
        transition: {
          // Si ya se está escribiendo en un campo, no se le quita el foco.
          onEntered: () => {
            if (!(document.activeElement instanceof HTMLInputElement)) cashInput.current?.focus();
          },
        },
      }}
    >
      <DialogTitle>Cobrar la venta</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          <Typography variant="h5">Total: {formatMoney(cart.total)}</Typography>
          <Typography>Falta cobrar: {formatMoney(cart.porCobrar)}</Typography>
          {pending &&
            electronic.map((m) => (
              <Stack key={m.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <AmountField
                  method={m}
                  value={amountOf(m)}
                  onChange={(value) => {
                    edit(m.id, value);
                  }}
                  onEnter={() => void charge(m)}
                />
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
              <AmountField
                method={cash}
                value={amountOf(cash)}
                onChange={(value) => {
                  edit(cash.id, value);
                }}
                inputRef={setCashInput}
                autoFocus
              />
              <TextField
                label="Entregado"
                value={tendered}
                onChange={(e) => {
                  setTendered(e.target.value.replace(',', '.'));
                }}
                onKeyDown={moveFocus}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                data-atajos="datos"
                fullWidth
              />
            </Stack>
          )}
          {pending && credit && cart.cliente && (
            <Stack spacing={0.5}>
              <AmountField
                method={credit}
                value={amountOf(credit)}
                onChange={(value) => {
                  edit(credit.id, value);
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {cart.cliente.razonSocial}: disponible {formatMoney(cart.cliente.disponible)}
              </Typography>
            </Stack>
          )}
          {billing.visible && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={billing.obligatoria || invoice}
                  disabled={billing.obligatoria}
                  onChange={(e) => {
                    setInvoice(e.target.checked);
                  }}
                />
              }
              label="Facturar esta venta"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={confirm}
          aria-label="Confirmar venta"
          data-confirmar
        >
          <WithShortcut action="cobrar">Confirmar venta</WithShortcut>
        </Button>
      </DialogActions>
    </Dialog>
  );
}
