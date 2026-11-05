// Ventas del turno (T-162, T-163; RF-054, RF-060, RF-065, RF-077, RF-157): carritos en curso,
// búsqueda, carrito táctil, descuento manual con PIN si supera la cuota, cobro en efectivo y
// traspasos. Todos los importes los calcula el backend: esta pantalla solo los muestra.
import type { Cart, SaleReceipt, SaleSearchResult, TransferTarget } from '@pos/contracts';
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { ApiError } from '../../api/httpClient';
import { formatQuantity, salesApi } from '../../api/sales';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../components/PageSection';
import { PinDialog, type PinRequest } from '../../components/PinDialog';
import { useLoader } from '../../hooks/useLoader';

const SEARCH_DELAY_MS = 250;

type Dialogs =
  | { kind: 'descuento' }
  | { kind: 'cobro' }
  | { kind: 'traspaso'; targets: TransferTarget[] }
  | null;

export function SalesPanel({ onChanged }: { onChanged: () => void }) {
  const { request } = useAuth();
  const api = useMemo(() => salesApi(request), [request]);
  const fetchSales = useCallback(() => api.listOwn(), [api]);
  const loaded = useLoader(fetchSales, 'No se pudieron cargar las ventas.');
  const [selected, setSelected] = useState<string | null>(null);
  const [override, setOverride] = useState<Cart | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ term: string; items: SaleSearchResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pin, setPin] = useState<(PinRequest & { discount: DiscountForm }) | null>(null);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);

  const sales = loaded.data?.ventas ?? [];
  const incoming = loaded.data?.traspasosRecibidos ?? [];
  const fromList = sales.find((s) => s.id === selected) ?? sales[0] ?? null;
  // La última respuesta del backend manda: trae los totales recalculados.
  const cart = override?.id === fromList?.id ? override : fromList;

  async function run<T>(action: () => Promise<T>, onDone?: (value: T) => void) {
    setError(null);
    setNotice(null);
    try {
      const value = await action();
      onDone?.(value);
      return true;
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo completar la operación.'));
      return false;
    }
  }

  const refresh = () => {
    setOverride(null);
    loaded.reload();
    onChanged();
  };

  const updated = (next: Cart) => {
    setOverride(next);
    setSelected(next.id);
  };

  // Búsqueda mientras se escribe: espera una pausa corta para no consultar en cada tecla.
  const term = query.trim();
  useEffect(() => {
    if (term === '') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.search(term).then(
        (items) => {
          if (!cancelled) setFound({ term, items });
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e, 'No se pudo buscar.'));
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, term]);
  const searching = term !== '' && found?.term !== term;
  const options = !searching && term !== '' && found ? found.items : [];

  // Enter antes de que lleguen los resultados (típico de un lector de código de barras):
  // busca en el acto y agrega el producto si el código coincide exacto.
  async function submit() {
    if (term === '' || !searching) return;
    await run(
      () => api.search(term),
      (items) => {
        const exact = items.find((p) => p.codigoBarras === term && p.precio !== null);
        if (exact) void add(exact);
        else setFound({ term, items });
      },
    );
  }

  async function add(product: SaleSearchResult) {
    // Sin una venta en curso, el primer producto empieza una.
    let saleId = cart?.id ?? null;
    if (saleId === null) {
      try {
        saleId = (await api.start()).id;
      } catch (e: unknown) {
        setError(errorMessage(e, 'No se pudo empezar la venta.'));
        return;
      }
    }
    const ok = await run(() => api.addItem(saleId, product.id, '1'), updated);
    if (ok) {
      setFound(null);
      setQuery('');
      loaded.reload();
    }
  }

  async function applyDiscount(form: DiscountForm, authorizationId: string | null) {
    if (!cart) return;
    setDialogError(null);
    try {
      const next = await api.setDiscount(cart.id, {
        descuento: form.valor.trim() === '' ? null : { tipo: form.tipo, valor: form.valor.trim() },
        autorizacionId: authorizationId,
      });
      updated(next);
      setDialog(null);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === 'DESCUENTO_REQUIERE_AUTORIZACION') {
        setDialog(null);
        setPin({
          type: 'descuento',
          operationRef: `descuento:${cart.id}`,
          branchId: cart.sucursalId,
          summary: `${e.message} Descuento: ${form.tipo === 'porcentaje' ? `${form.valor} %` : formatMoney(form.valor)}.`,
          discount: form,
        });
        return;
      }
      setDialogError(errorMessage(e, 'No se pudo aplicar el descuento.'));
    }
  }

  async function pay(tendered: string) {
    if (!cart) return;
    setDialogError(null);
    try {
      const result = await api.payCash(cart.id, tendered.trim() === '' ? null : tendered.trim());
      setDialog(null);
      setReceipt(result);
      setSelected(null);
      refresh();
    } catch (e: unknown) {
      setDialogError(errorMessage(e, 'No se pudo cobrar.'));
    }
  }

  return (
    <Stack spacing={2}>
      {(error ?? loaded.error) !== null && <Alert severity="error">{error ?? loaded.error}</Alert>}
      {notice !== null && <Alert severity="success">{notice}</Alert>}
      {incoming.map((t) => (
        <Alert
          key={t.id}
          severity="info"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                onClick={() =>
                  void run(
                    () => api.acceptTransfer(t.id),
                    (next) => {
                      updated(next);
                      refresh();
                    },
                  )
                }
              >
                Aceptar
              </Button>
              <Button
                size="small"
                color="inherit"
                onClick={() => void run(() => api.rejectTransfer(t.id), refresh)}
              >
                Rechazar
              </Button>
            </Stack>
          }
        >
          {t.emisor} te traspasa una venta.
        </Alert>
      ))}

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }} useFlexGap>
        <Typography variant="subtitle1">Ventas en curso</Typography>
        {sales.map((s, i) => (
          <Chip
            key={s.id}
            label={`Venta ${String(i + 1)} · ${formatMoney((override?.id === s.id ? override : s).total)}`}
            color={cart?.id === s.id ? 'primary' : 'default'}
            onClick={() => {
              setSelected(s.id);
            }}
          />
        ))}
        <Button
          variant="outlined"
          onClick={() =>
            void run(
              () => api.start(),
              (created) => {
                updated(created);
                loaded.reload();
              },
            )
          }
        >
          Nueva venta
        </Button>
      </Stack>

      <Autocomplete<SaleSearchResult>
        options={options}
        filterOptions={(x) => x}
        getOptionLabel={(p) => p.nombre}
        getOptionDisabled={(p) => p.precio === null}
        value={null}
        inputValue={query}
        onInputChange={(_, value, reason) => {
          if (reason !== 'reset') setQuery(value);
        }}
        onChange={(_, product) => {
          if (product) void add(product);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && searching) void submit();
        }}
        open={term !== ''}
        autoHighlight
        clearOnBlur={false}
        blurOnSelect={false}
        loading={searching}
        loadingText="Buscando…"
        noOptionsText="No se encontraron productos."
        popupIcon={null}
        renderOption={(props, p) => {
          const { key, ...rest } = props;
          return (
            <li key={key} {...rest} style={{ minHeight: 56 }}>
              <ListItemText
                primary={`${p.nombre}${p.tipo === 'combo' ? ' (combo)' : ''}`}
                secondary={
                  p.precio === null
                    ? 'Sin precio en la lista de la sucursal'
                    : `${formatMoney(p.precio)} · disponible ${formatQuantity(p.disponible)}${p.codigoBarras ? ` · ${p.codigoBarras}` : ''}`
                }
              />
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField {...params} label="Buscar por nombre o código" autoFocus />
        )}
      />

      {cart && (
        <Stack spacing={1}>
          {cart.traspaso && (
            <Alert severity="warning">
              Traspaso pendiente a {cart.traspaso.receptor}: no se puede modificar hasta que lo
              responda.
            </Alert>
          )}
          <Table size="small" aria-label="Carrito">
            <TableHead>
              <TableRow>
                <TableCell>Producto</TableCell>
                <TableCell align="center">Cantidad</TableCell>
                <TableCell align="right">Precio</TableCell>
                <TableCell align="right">Importe</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {cart.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {item.nombre}
                    {item.promocion && (
                      <Chip
                        size="small"
                        color="success"
                        label={`${item.promocion.nombre} −${formatMoney(item.descuentoPromocion)}`}
                        sx={{ ml: 1 }}
                      />
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: 'center', alignItems: 'center' }}
                    >
                      <IconButton
                        aria-label={`Restar ${item.nombre}`}
                        disabled={Number(item.cantidad) <= 1}
                        onClick={() =>
                          void run(
                            () =>
                              api.setQuantity(cart.id, item.id, String(Number(item.cantidad) - 1)),
                            updated,
                          )
                        }
                      >
                        −
                      </IconButton>
                      <span>{formatQuantity(item.cantidad)}</span>
                      <IconButton
                        aria-label={`Sumar ${item.nombre}`}
                        onClick={() =>
                          void run(
                            () =>
                              api.setQuantity(cart.id, item.id, String(Number(item.cantidad) + 1)),
                            updated,
                          )
                        }
                      >
                        +
                      </IconButton>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{formatMoney(item.precioUnitario)}</TableCell>
                  <TableCell align="right">{formatMoney(item.importeFinal)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      onClick={() => void run(() => api.removeItem(cart.id, item.id), updated)}
                    >
                      Quitar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {cart.items.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Buscá un producto para agregarlo a la venta.
            </Typography>
          )}

          <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }} aria-label="Totales">
            <Typography>Subtotal: {formatMoney(cart.subtotal)}</Typography>
            {Number(cart.descuentoPromociones) > 0 && (
              <Typography color="success.main">
                Promociones: −{formatMoney(cart.descuentoPromociones)}
              </Typography>
            )}
            {cart.descuento && (
              <Typography>
                Descuento{cart.descuento.autorizado ? ' autorizado' : ''}: −
                {formatMoney(cart.descuentoManual)}
              </Typography>
            )}
            <Typography variant="h5">Total: {formatMoney(cart.total)}</Typography>
          </Stack>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ justifyContent: 'flex-end' }}
          >
            <Button
              size="large"
              disabled={cart.traspaso !== null}
              onClick={() => {
                setDialog({ kind: 'descuento' });
              }}
            >
              Descuento
            </Button>
            <Button
              size="large"
              disabled={cart.traspaso !== null}
              onClick={() =>
                void run(
                  () => api.transferTargets(cart.id),
                  (targets) => {
                    setDialog({ kind: 'traspaso', targets });
                  },
                )
              }
            >
              Traspasar
            </Button>
            <Button
              size="large"
              color="error"
              disabled={cart.traspaso !== null}
              onClick={() => {
                if (window.confirm('¿Descartar la venta? Se liberan las reservas.')) {
                  void run(
                    () => api.discard(cart.id),
                    () => {
                      setNotice('Venta descartada.');
                      setSelected(null);
                      refresh();
                    },
                  );
                }
              }}
            >
              Descartar
            </Button>
            <Button
              size="large"
              variant="contained"
              disabled={cart.items.length === 0 || cart.traspaso !== null}
              onClick={() => {
                setDialog({ kind: 'cobro' });
              }}
            >
              Cobrar en efectivo
            </Button>
          </Stack>
        </Stack>
      )}

      {dialog?.kind === 'descuento' && cart && (
        <DiscountDialog
          error={dialogError}
          initial={
            cart.descuento
              ? { tipo: cart.descuento.tipo, valor: String(Number(cart.descuento.valor)) }
              : null
          }
          onConfirm={(form) => void applyDiscount(form, null)}
          onCancel={() => {
            setDialog(null);
            setDialogError(null);
          }}
        />
      )}
      {dialog?.kind === 'cobro' && cart && (
        <PayDialog
          total={cart.total}
          error={dialogError}
          onConfirm={(tendered) => void pay(tendered)}
          onCancel={() => {
            setDialog(null);
            setDialogError(null);
          }}
        />
      )}
      {dialog?.kind === 'traspaso' && cart && (
        <Dialog
          open
          onClose={() => {
            setDialog(null);
          }}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Traspasar la venta</DialogTitle>
          <DialogContent>
            {dialog.targets.length === 0 ? (
              <Typography>No hay otros vendedores con turno abierto en la sucursal.</Typography>
            ) : (
              <List aria-label="Vendedores">
                {dialog.targets.map((t) => (
                  <ListItemButton
                    key={t.id}
                    sx={{ minHeight: 56 }}
                    onClick={() =>
                      void run(
                        () => api.transfer(cart.id, t.id),
                        () => {
                          setDialog(null);
                          setNotice(`Traspaso enviado a ${t.nombre}.`);
                          refresh();
                        },
                      )
                    }
                  >
                    <ListItemText primary={t.nombre} />
                  </ListItemButton>
                ))}
              </List>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setDialog(null);
              }}
            >
              Cancelar
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {pin && (
        <PinDialog
          pending={pin}
          onAuthorized={(id) => {
            const form = pin.discount;
            setPin(null);
            void applyDiscount(form, id).then(() => {
              setNotice('Descuento autorizado.');
            });
          }}
          onCancel={() => {
            setPin(null);
          }}
        />
      )}
      {receipt && (
        <Dialog
          open
          onClose={() => {
            setReceipt(null);
          }}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Venta cobrada · Ticket {String(receipt.numeroTicket)}</DialogTitle>
          <DialogContent>
            <Stack spacing={1}>
              <Typography>Cobrado: {formatMoney(receipt.cobrado)}</Typography>
              <Typography>Entregado: {formatMoney(receipt.entregado)}</Typography>
              <Typography variant="h5">Vuelto: {formatMoney(receipt.vuelto)}</Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button
              variant="contained"
              onClick={() => {
                setReceipt(null);
              }}
            >
              Listo
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

interface DiscountForm {
  tipo: 'porcentaje' | 'monto';
  valor: string;
}

function DiscountDialog({
  initial,
  error,
  onConfirm,
  onCancel,
}: {
  initial: DiscountForm | null;
  error: string | null;
  onConfirm: (form: DiscountForm) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<DiscountForm>(initial ?? { tipo: 'porcentaje', valor: '' });
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Descuento manual</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          <TextField
            select
            label="Tipo"
            value={form.tipo}
            onChange={(e) => {
              setForm({ ...form, tipo: e.target.value === 'monto' ? 'monto' : 'porcentaje' });
            }}
          >
            <MenuItem value="porcentaje">Porcentaje</MenuItem>
            <MenuItem value="monto">Monto</MenuItem>
          </TextField>
          <TextField
            label={form.tipo === 'porcentaje' ? 'Porcentaje' : 'Monto'}
            value={form.valor}
            onChange={(e) => {
              setForm({ ...form, valor: e.target.value.replace(',', '.') });
            }}
            helperText="Vacío: sin descuento."
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            autoFocus
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          variant="contained"
          onClick={() => {
            onConfirm(form);
          }}
        >
          Aplicar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PayDialog({
  total,
  error,
  onConfirm,
  onCancel,
}: {
  total: string;
  error: string | null;
  onConfirm: (tendered: string) => void;
  onCancel: () => void;
}) {
  const [tendered, setTendered] = useState('');
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Cobrar en efectivo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          <Typography variant="h5">Total: {formatMoney(total)}</Typography>
          <TextField
            label="Entregado"
            value={tendered}
            onChange={(e) => {
              setTendered(e.target.value.replace(',', '.'));
            }}
            helperText="Vacío: el importe justo. El recargo o descuento del efectivo lo aplica el sistema."
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            autoFocus
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          variant="contained"
          onClick={() => {
            onConfirm(tendered);
          }}
        >
          Cobrar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
