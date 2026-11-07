// Devolución o anulación desde el POS (T-225; RF-081, RF-083, RF-085). El reintegro, lo devolvible
// y si hace falta el PIN los decide el backend: esta pantalla captura cantidades y los muestra.
import type { ReturnQuote, ReturnTicket } from '@pos/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { returnsApi } from '../../api/returns';
import { formatQuantity } from '../../api/sales';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../components/PageSection';
import { PinDialog, type PinRequest } from '../../components/PinDialog';

export function ReturnDialog({
  branchId,
  onDone,
  onClose,
}: {
  branchId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { request } = useAuth();
  const api = useMemo(() => returnsApi(request), [request]);
  const [number, setNumber] = useState('');
  const [ticket, setTicket] = useState<ReturnTicket | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<ReturnQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pin, setPin] = useState<(PinRequest & { onAuthorized: (id: string) => void }) | null>(
    null,
  );

  const items = () =>
    Object.entries(quantities)
      .filter(([, cantidad]) => cantidad.trim() !== '' && Number(cantidad) > 0)
      .map(([itemId, cantidad]) => ({ itemId, cantidad: cantidad.trim() }));

  async function run<T>(action: () => Promise<T>, then: (value: T) => void) {
    setError(null);
    try {
      then(await action());
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo completar la operación.'));
    }
  }

  function confirmReturn() {
    if (!ticket || !quote) return;
    const send = (autorizacionId: string | null) =>
      void run(
        () => api.confirm(ticket.ventaId, items(), autorizacionId),
        (result) => {
          setDone(`Devolución registrada. Reintegro: ${formatMoney(result.reintegro)}.`);
          onDone();
        },
      );
    if (!quote.requiereAutorizacion) {
      send(null);
      return;
    }
    setPin({
      type: 'reembolso',
      operationRef: quote.operacionRef,
      branchId,
      summary: `Reintegro en efectivo de ${formatMoney(quote.efectivo)}.`,
      onAuthorized: send,
    });
  }

  function voidSale() {
    if (!ticket) return;
    setPin({
      type: 'anulacion',
      operationRef: `anulacion:${ticket.ventaId}`,
      branchId,
      summary: `Anular el ticket ${String(ticket.numeroTicket)} por ${formatMoney(ticket.total)}.`,
      onAuthorized: (id) =>
        void run(
          () => api.voidSale(ticket.ventaId, id),
          (result) => {
            setDone(`Venta anulada. Reintegro: ${formatMoney(result.reintegro)}.`);
            onDone();
          },
        ),
    });
  }

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle>Devolución o anulación</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error !== null && <Alert severity="error">{error}</Alert>}
            {done !== null && <Alert severity="success">{done}</Alert>}
            {done === null && (
              <Stack direction="row" spacing={1}>
                <TextField
                  label="Número de ticket"
                  value={number}
                  onChange={(e) => {
                    setNumber(e.target.value);
                  }}
                  slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                  autoFocus
                />
                <Button
                  variant="outlined"
                  disabled={number.trim() === ''}
                  onClick={() =>
                    void run(
                      () => api.ticket(Number(number)),
                      (found) => {
                        setTicket(found);
                        setQuantities({});
                        setQuote(null);
                      },
                    )
                  }
                >
                  Buscar
                </Button>
              </Stack>
            )}
            {ticket && done === null && (
              <>
                <Typography>
                  Ticket {String(ticket.numeroTicket)} de {ticket.sucursal}:{' '}
                  {formatMoney(ticket.total)}
                </Typography>
                <Table size="small" aria-label="Ítems del ticket">
                  <TableHead>
                    <TableRow>
                      <TableCell>Producto</TableCell>
                      <TableCell align="right">Vendido</TableCell>
                      <TableCell align="right">Se puede devolver</TableCell>
                      <TableCell align="right">Devolver</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ticket.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.nombre}</TableCell>
                        <TableCell align="right">{formatQuantity(item.cantidad)}</TableCell>
                        <TableCell align="right">{formatQuantity(item.devolvible)}</TableCell>
                        <TableCell align="right">
                          <TextField
                            size="small"
                            value={quantities[item.id] ?? ''}
                            onChange={(e) => {
                              setQuantities({
                                ...quantities,
                                [item.id]: e.target.value.replace(',', '.'),
                              });
                              setQuote(null);
                            }}
                            slotProps={{
                              htmlInput: {
                                inputMode: 'decimal',
                                'aria-label': `Devolver ${item.nombre}`,
                              },
                            }}
                            sx={{ width: 90 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {quote && (
                  <Stack spacing={0.5} aria-label="Reintegro">
                    {quote.porMedio.map((part, index) => (
                      <Typography key={index}>
                        {part.metodo}: {formatMoney(part.monto)}
                      </Typography>
                    ))}
                    <Typography variant="h6">Reintegro: {formatMoney(quote.reintegro)}</Typography>
                    {Number(quote.efectivo) > 0 && (
                      <Typography variant="body2">
                        En efectivo: {formatMoney(quote.efectivo)} (requiere el PIN de un AS)
                      </Typography>
                    )}
                  </Stack>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{done === null ? 'Cancelar' : 'Cerrar'}</Button>
          {ticket && done === null && ticket.anulable && (
            <Button color="error" onClick={voidSale}>
              Anular venta
            </Button>
          )}
          {ticket && done === null && !quote && (
            <Button
              disabled={items().length === 0}
              onClick={() => void run(() => api.quote(ticket.ventaId, items()), setQuote)}
            >
              Calcular reintegro
            </Button>
          )}
          {quote && done === null && (
            <Button variant="contained" onClick={confirmReturn}>
              Confirmar devolución
            </Button>
          )}
        </DialogActions>
      </Dialog>
      {pin && (
        <PinDialog
          pending={pin}
          onAuthorized={(id) => {
            const next = pin.onAuthorized;
            setPin(null);
            next(id);
          }}
          onCancel={() => {
            setPin(null);
          }}
        />
      )}
    </>
  );
}
