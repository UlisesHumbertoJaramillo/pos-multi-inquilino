// Ventas del turno (T-162, T-163, T-185, T-186; RF-054, RF-060, RF-065, RF-068, RF-073, RF-077,
// RF-126, RF-128, RF-157, RF-061, RF-062): carritos en curso, búsqueda con stock en vivo, carrito
// táctil, descuento manual, cliente, cobro mixto, pagos por verificar, traspasos, cobros de cuenta
// corriente, el ticket y los periféricos (T-238 a T-240: impresora y lector de códigos). Sin
// conexión no se agrega ni se cobra; una falla de impresión no cambia la venta (RF-108). Todos los
// importes los calcula el backend: esta pantalla solo los muestra.
// POS rápido (T-268, T-271, T-276 a T-278; RF-175 a RF-183, D-100 a D-102): la búsqueda queda lista
// sin clics, el primer producto inicia la venta, la cantidad se escribe antes con el atajo de
// cantidad (3 * código), cada acción tiene su atajo visible y la sección de productos acompaña al
// carrito en pantallas anchas.
import type {
  AccountCollection,
  Cart,
  SaleBillingOption,
  SalePayment,
  SalePaymentMethod,
  SaleReceipt,
  SaleSearchResult,
  TransferTarget,
} from '@pos/contracts';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
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
  useMediaQuery,
  type Theme,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from '../../components/DetailPanel';
import { ShortcutHelp, WithShortcut } from '../../shortcuts/ShortcutHint';
import { useShortcuts } from '../../shortcuts/ShortcutsContext';
import { ProductSection, type ProductSectionHandle } from './ProductSection';
import { formatMoney } from '../../api/catalog';
import { collectionsApi } from '../../api/collections';
import { ApiError } from '../../api/httpClient';
import { formatQuantity, salesApi } from '../../api/sales';
import { AttentionCard } from '../../components/AttentionCard';
import { Status } from '../../components/Status';
import type { Severity } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../components/PageSection';
import { PinDialog, type PinRequest } from '../../components/PinDialog';
import { useLoader } from '../../hooks/useLoader';
import { useRealtime } from '../../realtime/RealtimeContext';
import { AccountCollectionDialog } from './AccountCollectionDialog';
import { CustomerPicker } from './CustomerPicker';
import { PaymentDialog, type PaymentLine } from './PaymentDialog';
import { ReturnDialog } from './ReturnDialog';
import { TicketDialog } from './TicketDialog';
import { PrinterDialog } from './PrinterDialog';
import { reportsApi } from '../../api/reports';
import { createScanDetector } from '../../peripherals/barcode';
import { PRINTER_LABELS } from '../../peripherals/printers';
import { usePrinter } from '../../peripherals/usePrinter';

const SEARCH_DELAY_MS = 250;
const REFRESH_MS = 15_000;

const PAYMENT_SEVERITY: Record<SalePayment['estado'], Severity> = {
  pendiente: 'informativa',
  aprobado: 'correcta',
  rechazado: 'critica',
  por_verificar: 'advertencia',
  revirtiendo: 'informativa',
  revertido: 'informativa',
};

const PAYMENT_STATES: Record<SalePayment['estado'], string> = {
  pendiente: 'Procesando',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  por_verificar: 'Por verificar',
  revirtiendo: 'Revirtiendo',
  revertido: 'Revertido',
};

const isLive = (p: SalePayment) => p.estado !== 'rechazado' && p.estado !== 'revertido';

type Dialogs =
  | { kind: 'descuento' }
  | { kind: 'cobro'; methods: SalePaymentMethod[]; billing: SaleBillingOption }
  | { kind: 'cuenta'; methods: SalePaymentMethod[] }
  | { kind: 'devolucion' }
  | { kind: 'traspaso'; targets: TransferTarget[] }
  | null;

export function SalesPanel({ onChanged }: { onChanged: () => void }) {
  const { request, user } = useAuth();
  const api = useMemo(() => salesApi(request), [request]);
  const collections = useMemo(() => collectionsApi(request), [request]);
  const fetchSales = useCallback(() => api.listOwn(), [api]);
  const loaded = useLoader(fetchSales, 'No se pudieron cargar las ventas.');
  const fetchPending = useCallback(() => collections.pendingCollections(), [collections]);
  const pendingCollections = useLoader(fetchPending, 'No se pudieron cargar los cobros.');
  const [selected, setSelected] = useState<string | null>(null);
  const [override, setOverride] = useState<Cart | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ term: string; items: SaleSearchResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pin, setPin] = useState<(PinRequest & { onAuthorized: (id: string) => void }) | null>(
    null,
  );
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [ticketOf, setTicketOf] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const realtime = useRealtime();
  // Sin conexión no se agrega ni se cobra (RF-062): las reservas siguen sujetas a su vencimiento.
  const offline = realtime.status === 'sin_conexion';
  const reports = useMemo(() => reportsApi(request), [request]);
  const printer = usePrinter();
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printFailure, setPrintFailure] = useState<{ saleId: string; ticket: number } | null>(null);
  // Cantidad del próximo producto, escrita antes del atajo de cantidad (D-101).
  const [pendingQuantity, setPendingQuantity] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<ProductSectionHandle | null>(null);
  const wide = useMediaQuery((t: Theme) => t.breakpoints.up('md'));

  // Imprime el ticket que arma el backend. Si falla, la venta sigue confirmada y se puede
  // reimprimir (RF-108).
  async function printTicket(saleId: string, ticket: number) {
    setPrintFailure(null);
    try {
      const document = await reports.ticket(saleId);
      if (!(await printer.print(document.impresion.lineas))) {
        setPrintFailure({ saleId, ticket });
      }
    } catch {
      setPrintFailure({ saleId, ticket });
    }
  }

  const sales = loaded.data?.ventas ?? [];
  const incoming = loaded.data?.traspasosRecibidos ?? [];
  const fromList = sales.find((s) => s.id === selected) ?? sales[0] ?? null;
  // La última respuesta del backend manda: trae los totales recalculados.
  const cart = override?.id === fromList?.id ? override : fromList;

  // El worker resuelve los pagos por verificar: la pantalla los vuelve a pedir mientras esperan.
  const waiting =
    sales.some((s) => s.estado === 'pago_por_verificar') ||
    (pendingCollections.data ?? []).length > 0;
  const { reload: reloadSales } = loaded;
  const { reload: reloadPending } = pendingCollections;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      setOverride(null);
      reloadSales();
      reloadPending();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [waiting, reloadSales, reloadPending]);

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
    const quantity = pendingQuantity ?? '1';
    // Sin una venta en curso, el primer producto la inicia, en una sola operación (RF-176).
    const saleId = cart?.id ?? null;
    const ok = await run(
      () =>
        saleId === null
          ? api.start({ productoId: product.id, cantidad: quantity })
          : api.addItem(saleId, product.id, quantity),
      updated,
    );
    if (ok) {
      setFound(null);
      setQuery('');
      setPendingQuantity(null);
      setProductsOpen(false);
      loaded.reload();
      searchRef.current?.focus();
    }
  }

  function openPayment() {
    if (!cart) return;
    void run(
      async () => ({ methods: await api.methods(), billing: await api.billing(cart.id) }),
      ({ methods, billing }) => {
        setDialogError(null);
        setDialog({ kind: 'cobro', methods, billing });
      },
    );
  }

  function startEmpty() {
    void run(
      () => api.start(),
      (created) => {
        updated(created);
        loaded.reload();
        searchRef.current?.focus();
      },
    );
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
          onAuthorized: (id) => {
            void applyDiscount(form, id).then(() => {
              setNotice('Descuento autorizado.');
            });
          },
        });
        return;
      }
      setDialogError(errorMessage(e, 'No se pudo aplicar el descuento.'));
    }
  }

  async function pay(
    lines: PaymentLine[],
    invoice: boolean | null,
    authorizationId: string | null,
  ) {
    if (!cart) return;
    setDialogError(null);
    try {
      const result = await api.pay(cart.id, {
        pagos: lines,
        ...(invoice === null ? {} : { facturar: invoice }),
        ...(authorizationId === null ? {} : { autorizacionId: authorizationId }),
      });
      setDialog(null);
      setReceipt(result);
      if (printer.kind !== 'ninguna') void printTicket(result.venta.id, result.numeroTicket);
      setSelected(null);
      refresh();
    } catch (e: unknown) {
      // Exceso de crédito (RF-074): el backend informa el disponible y pide el PIN de un AS.
      if (e instanceof ApiError && e.code === 'CREDITO_EXCEDIDO') {
        setPin({
          type: 'credito',
          operationRef: `credito:${cart.id}:${cart.total}`,
          branchId: cart.sucursalId,
          summary: e.message,
          onAuthorized: (id) => {
            void pay(lines, invoice, id);
          },
        });
        return;
      }
      setDialogError(errorMessage(e, 'No se pudo cobrar.'));
    }
  }

  async function chargeElectronic(methodId: string, fraction: string) {
    if (!cart) return;
    setDialogError(null);
    try {
      const attempt = await api.charge(cart.id, methodId, fraction);
      updated(attempt.venta);
      loaded.reload();
      if (attempt.pago.estado === 'rechazado') {
        setDialogError('La pasarela rechazó el pago: probá con otro medio.');
      }
      if (attempt.pago.estado === 'por_verificar') {
        setDialog(null);
        setNotice('La pasarela no respondió: el pago quedó por verificar.');
      }
    } catch (e: unknown) {
      setDialogError(errorMessage(e, 'No se pudo cobrar.'));
    }
  }

  function askResolution(sale: Cart, payment: SalePayment, resultado: 'aprobado' | 'rechazado') {
    setPin({
      type: 'pago_por_verificar',
      operationRef: `pago:${payment.id}`,
      branchId: sale.sucursalId,
      summary: `Pago de ${formatMoney(payment.fraccion)} con ${payment.metodo}: ${resultado === 'aprobado' ? 'se cobró' : 'no se cobró'}.`,
      onAuthorized: (id) => {
        void run(() => api.resolve(sale.id, payment.id, resultado, id), updated).then(() => {
          loaded.reload();
        });
      },
    });
  }

  function askCollectionResolution(c: AccountCollection, resultado: 'aprobado' | 'rechazado') {
    const branchId = cart?.sucursalId ?? user?.sucursales[0] ?? '';
    setPin({
      type: 'pago_por_verificar',
      operationRef: `pago:${c.pagoId}`,
      branchId,
      summary: `Cobro de ${c.cliente} por ${formatMoney(c.monto)}: ${resultado === 'aprobado' ? 'se cobró' : 'no se cobró'}.`,
      onAuthorized: (id) => {
        void run(
          () => collections.resolveCollection(c.id, resultado, id),
          () => {
            pendingCollections.reload();
            onChanged();
          },
        );
      },
    });
  }

  // Stock en vivo (RF-061): el disponible de los resultados se actualiza sin recargar. Los combos
  // dependen de varios componentes: se vuelve a buscar.
  const latestFound = useRef(found);
  latestFound.current = found;
  const { onStock } = realtime;
  useEffect(
    () =>
      onStock((change) => {
        const current = latestFound.current;
        if (!current) return;
        if (current.items.some((p) => p.tipo === 'combo')) {
          api.search(current.term).then(
            (items) => {
              setFound((now) => (now?.term === current.term ? { term: current.term, items } : now));
            },
            () => undefined,
          );
          return;
        }
        setFound((now) =>
          now
            ? {
                ...now,
                items: now.items.map((p) =>
                  p.id === change.productoId ? { ...p, disponible: change.disponible } : p,
                ),
              }
            : now,
        );
      }),
    [onStock, api],
  );

  // Al volver la conexión se muestra la venta vigente, o se informa que se descartó (RF-062).
  const cartId = cart?.id ?? null;
  const lostCart = useRef<string | null>(null);
  useEffect(() => {
    if (offline) lostCart.current = cartId;
  }, [offline, cartId]);
  const { reconnections } = realtime;
  useEffect(() => {
    if (reconnections === 0) return;
    const previous = lostCart.current;
    lostCart.current = null;
    api.listOwn().then(
      (list) => {
        setOverride(null);
        reloadSales();
        if (previous === null) setConnectionNotice('Volvió la conexión.');
        else if (list.ventas.some((v) => v.id === previous)) {
          setConnectionNotice('Volvió la conexión: se muestra la venta vigente.');
        } else {
          setSelected(null);
          setConnectionNotice(
            'Volvió la conexión, pero la venta en curso se descartó: venció su reserva mientras no había conexión.',
          );
        }
      },
      () => undefined,
    );
  }, [reconnections, api, reloadSales]);

  // Lector de códigos (RF-054): escribe rápido y termina con Enter. Si el foco está en un campo,
  // ese campo lo maneja (la búsqueda ya agrega el código exacto); si no, se busca acá.
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    const detect = createScanDetector((code) => {
      api.search(code).then(
        (items) => {
          const exact = items.find((p) => p.codigoBarras === code && p.precio !== null);
          if (exact) void addRef.current(exact);
          else setError(`No se encontró un producto con el código ${code}.`);
        },
        (e: unknown) => {
          setError(errorMessage(e, 'No se pudo buscar el código.'));
        },
      );
    });
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (editable || offline) return;
      if (detect(event.key, event.timeStamp)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [api, offline]);

  const locked = cart !== null && (cart.traspaso !== null || cart.pagos.some(isLive));
  const canPay =
    cart !== null &&
    !offline &&
    cart.items.length > 0 &&
    cart.traspaso === null &&
    cart.estado !== 'pago_por_verificar';

  // Atajos del POS (RF-181). Mientras hay un diálogo abierto, el diálogo maneja sus teclas.
  const idle =
    dialog === null &&
    pin === null &&
    receipt === null &&
    ticketOf === null &&
    !helpOpen &&
    !printerOpen;
  const cycle = (step: number) => {
    if (sales.length < 2 || !cart) return;
    const index = sales.findIndex((sale) => sale.id === cart.id);
    const next = sales[(index + step + sales.length) % sales.length];
    if (next) setSelected(next.id);
  };
  useShortcuts(
    {
      cantidad: () => {
        const typed = query.trim().replace(',', '.');
        if (/^\d+(\.\d{1,3})?$/.test(typed) && Number(typed) > 0) {
          setPendingQuantity(typed);
          setQuery('');
          setFound(null);
        } else {
          setNotice('Escribí la cantidad y después el atajo de cantidad, antes del producto.');
        }
        searchRef.current?.focus();
      },
      cobrar: () => {
        if (canPay) openPayment();
      },
      quitar_item: () => {
        const last = cart?.items.at(-1);
        if (cart && last && !locked && !offline) {
          void run(() => api.removeItem(cart.id, last.id), updated);
        }
      },
      descuento: () => {
        if (cart && !locked) setDialog({ kind: 'descuento' });
      },
      cancelar: () => {
        setPendingQuantity(null);
        setQuery('');
        setFound(null);
        searchRef.current?.focus();
      },
      buscar: () => {
        searchRef.current?.focus();
      },
      ayuda: () => {
        setHelpOpen(true);
      },
      venta_anterior: () => {
        cycle(-1);
      },
      venta_siguiente: () => {
        cycle(1);
      },
      nueva_venta: () => {
        if (!offline) startEmpty();
      },
      devolucion: () => {
        if (!offline) setDialog({ kind: 'devolucion' });
      },
    },
    idle,
  );

  return (
    <Stack spacing={2}>
      {offline && (
        <Alert severity="error" data-testid="pos-sin-conexion">
          Sin conexión con el servidor: no se pueden agregar productos ni cobrar. Las reservas
          siguen corriendo; al volver la conexión se muestra la venta vigente.
        </Alert>
      )}
      {connectionNotice !== null && !offline && (
        <Alert
          severity={connectionNotice.includes('descartó') ? 'warning' : 'info'}
          onClose={() => {
            setConnectionNotice(null);
          }}
        >
          {connectionNotice}
        </Alert>
      )}
      {printFailure !== null && (
        <Alert
          severity="warning"
          data-testid="falla-impresion"
          action={
            <Button
              size="small"
              color="inherit"
              onClick={() => void printTicket(printFailure.saleId, printFailure.ticket)}
            >
              Reimprimir
            </Button>
          }
        >
          No se pudo imprimir el ticket {String(printFailure.ticket)}
          {printer.status.state === 'falla' ? `: ${printer.status.message}` : '.'} La venta quedó
          confirmada.
        </Alert>
      )}
      {(error ?? loaded.error) !== null && <Alert severity="error">{error ?? loaded.error}</Alert>}
      {notice !== null && <Alert severity="success">{notice}</Alert>}
      {(pendingCollections.data ?? []).map((c) => (
        <Alert
          key={c.id}
          severity="warning"
          action={
            c.resolucionManual ? (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  onClick={() => {
                    askCollectionResolution(c, 'aprobado');
                  }}
                >
                  Se cobró
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    askCollectionResolution(c, 'rechazado');
                  }}
                >
                  No se cobró
                </Button>
              </Stack>
            ) : undefined
          }
        >
          Cobro de {c.cliente} por {formatMoney(c.monto)}: por verificar.
        </Alert>
      ))}
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
        <Button variant="outlined" disabled={offline} aria-label="Nueva venta" onClick={startEmpty}>
          <WithShortcut action="nueva_venta">Nueva venta</WithShortcut>
        </Button>
        <Button
          variant="outlined"
          disabled={offline}
          onClick={() =>
            void run(
              () => api.methods(),
              (methods) => {
                setDialog({ kind: 'cuenta', methods });
              },
            )
          }
        >
          Cobro de cuenta corriente
        </Button>
        <Button
          variant="outlined"
          disabled={offline}
          aria-label="Devolución o anulación"
          onClick={() => {
            setDialog({ kind: 'devolucion' });
          }}
        >
          <WithShortcut action="devolucion">Devolución o anulación</WithShortcut>
        </Button>
        <Button
          variant="text"
          color="inherit"
          aria-label="Ver los atajos"
          onClick={() => {
            setHelpOpen(true);
          }}
        >
          <WithShortcut action="ayuda">Atajos</WithShortcut>
        </Button>
        <Button
          variant="text"
          color={printer.status.state === 'falla' ? 'error' : 'inherit'}
          onClick={() => {
            setPrinterOpen(true);
          }}
        >
          Impresora: {PRINTER_LABELS[printer.kind]}
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 3fr) minmax(280px, 2fr)' },
          alignItems: 'start',
        }}
      >
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          {pendingQuantity !== null && (
            <Typography data-testid="cantidad-pendiente">
              Próximo producto: <strong>{formatQuantity(pendingQuantity)}</strong> unidades
            </Typography>
          )}
          {!wide && (
            <Button
              variant="outlined"
              onClick={() => {
                setProductsOpen(true);
              }}
            >
              Elegir de la lista de productos
            </Button>
          )}
          <Autocomplete<SaleSearchResult>
            options={options}
            disabled={offline}
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
              // Con la búsqueda vacía, la flecha baja a la sección de productos (RF-180).
              if (e.key === 'ArrowDown' && term === '' && wide) {
                e.preventDefault();
                sectionRef.current?.focus();
              }
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
              <TextField
                {...params}
                label="Buscar por nombre o código"
                autoFocus
                inputRef={searchRef}
                data-atajos="datos"
              />
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
                            disabled={locked || offline || Number(item.cantidad) <= 1}
                            onClick={() =>
                              void run(
                                () =>
                                  api.setQuantity(
                                    cart.id,
                                    item.id,
                                    String(Number(item.cantidad) - 1),
                                  ),
                                updated,
                              )
                            }
                          >
                            −
                          </IconButton>
                          <span>{formatQuantity(item.cantidad)}</span>
                          <IconButton
                            aria-label={`Sumar ${item.nombre}`}
                            disabled={locked || offline}
                            onClick={() =>
                              void run(
                                () =>
                                  api.setQuantity(
                                    cart.id,
                                    item.id,
                                    String(Number(item.cantidad) + 1),
                                  ),
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
                          disabled={locked}
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

              {cart.estado === 'pago_por_verificar' && (
                <AttentionCard
                  severity="advertencia"
                  title="Hay un pago por verificar"
                  detail="La venta espera el resultado de la pasarela. Si ya sabés si se cobró, indicalo en el pago."
                />
              )}
              {cart.pagos.length > 0 && (
                <List dense aria-label="Pagos de la venta">
                  {cart.pagos.map((p) => (
                    <ListItem
                      key={p.id}
                      secondaryAction={
                        <Stack direction="row" spacing={1}>
                          {p.estado === 'aprobado' && p.tipo === 'electronico' && (
                            <Button
                              size="small"
                              onClick={() =>
                                void run(() => api.reverse(cart.id, p.id), updated).then(() => {
                                  loaded.reload();
                                })
                              }
                            >
                              Revertir
                            </Button>
                          )}
                          {p.resolucionManual && (
                            <>
                              <Button
                                size="small"
                                onClick={() => {
                                  askResolution(cart, p, 'aprobado');
                                }}
                              >
                                Se cobró
                              </Button>
                              <Button
                                size="small"
                                color="inherit"
                                onClick={() => {
                                  askResolution(cart, p, 'rechazado');
                                }}
                              >
                                No se cobró
                              </Button>
                            </>
                          )}
                        </Stack>
                      }
                    >
                      <ListItemText
                        primary={`${p.metodo}: ${formatMoney(p.fraccion)}`}
                        secondary={
                          <Status
                            severity={PAYMENT_SEVERITY[p.estado]}
                            label={PAYMENT_STATES[p.estado]}
                          />
                        }
                        slotProps={{ secondary: { component: 'div' } }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}

              {cart.cliente ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip
                    label={`Cliente: ${cart.cliente.razonSocial}`}
                    onDelete={() => void run(() => api.setCustomer(cart.id, null), updated)}
                  />
                  {cart.cliente.cuentaCorriente && (
                    <Typography variant="caption" color="text.secondary">
                      Disponible {formatMoney(cart.cliente.disponible)}
                    </Typography>
                  )}
                </Stack>
              ) : (
                <CustomerPicker
                  search={api.customers}
                  label="Cliente de la venta (opcional)"
                  onPick={(c) => void run(() => api.setCustomer(cart.id, c.id), updated)}
                />
              )}

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ justifyContent: 'flex-end' }}
              >
                <Button
                  size="large"
                  disabled={locked}
                  aria-label="Descuento"
                  onClick={() => {
                    setDialog({ kind: 'descuento' });
                  }}
                >
                  <WithShortcut action="descuento">Descuento</WithShortcut>
                </Button>
                <Button
                  size="large"
                  disabled={locked}
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
                  disabled={locked}
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
                  disabled={!canPay}
                  aria-label="Cobrar"
                  onClick={openPayment}
                >
                  <WithShortcut action="cobrar">Cobrar</WithShortcut>
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
        {wide && (
          <ProductSection
            ref={sectionRef}
            disabled={offline}
            onPick={(p) => void add(p)}
            onLeave={() => searchRef.current?.focus()}
          />
        )}
      </Box>
      {!wide && (
        <DetailPanel
          title="Productos"
          open={productsOpen}
          onClose={() => {
            setProductsOpen(false);
          }}
        >
          <ProductSection
            ref={sectionRef}
            disabled={offline}
            onPick={(p) => void add(p)}
            onLeave={() => undefined}
          />
        </DetailPanel>
      )}
      {helpOpen && (
        <ShortcutHelp
          onClose={() => {
            setHelpOpen(false);
            searchRef.current?.focus();
          }}
        />
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
        <PaymentDialog
          cart={cart}
          methods={dialog.methods}
          billing={dialog.billing}
          error={dialogError}
          onCharge={chargeElectronic}
          onConfirm={(lines, invoice) => void pay(lines, invoice, null)}
          onCancel={() => {
            setDialog(null);
            setDialogError(null);
          }}
        />
      )}
      {dialog?.kind === 'devolucion' && (
        <ReturnDialog
          branchId={cart?.sucursalId ?? user?.sucursales[0] ?? ''}
          onDone={refresh}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'cuenta' && (
        <AccountCollectionDialog
          methods={dialog.methods}
          search={api.customers}
          collect={collections.collect}
          onDone={() => {
            pendingCollections.reload();
            onChanged();
          }}
          onClose={() => {
            setDialog(null);
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
            const done = pin.onAuthorized;
            setPin(null);
            done(id);
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
              {receipt.pagos.map((p) => (
                <Typography key={p.id}>
                  {p.metodo}: {formatMoney(p.fraccion)}
                </Typography>
              ))}
              <Typography>Cobrado: {formatMoney(receipt.cobrado)}</Typography>
              {Number(receipt.entregado) > 0 && (
                <Typography>Entregado: {formatMoney(receipt.entregado)}</Typography>
              )}
              {receipt.seFactura ? (
                <Typography variant="caption">
                  Factura en trámite con ARCA: el resultado lo ven el AS y el AC en Comprobantes.
                </Typography>
              ) : (
                <Typography variant="caption">Ticket no válido como factura.</Typography>
              )}
              {receipt.estadoCobro === 'saldo_cuenta_corriente' && (
                <Typography>Con saldo en cuenta corriente.</Typography>
              )}
              <Typography variant="h5">Vuelto: {formatMoney(receipt.vuelto)}</Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            {printer.kind !== 'ninguna' && (
              <Button onClick={() => void printTicket(receipt.venta.id, receipt.numeroTicket)}>
                Imprimir
              </Button>
            )}
            <Button
              onClick={() => {
                setTicketOf(receipt.venta.id);
                setReceipt(null);
              }}
            >
              Ver ticket
            </Button>
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
      {printerOpen && (
        <PrinterDialog
          printer={printer}
          onClose={() => {
            setPrinterOpen(false);
          }}
        />
      )}
      {ticketOf !== null && (
        <TicketDialog
          onPrint={printer.kind === 'ninguna' ? null : printer.print}
          saleId={ticketOf}
          onClose={() => {
            setTicketOf(null);
          }}
        />
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
