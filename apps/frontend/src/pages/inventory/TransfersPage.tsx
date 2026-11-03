// Transferencias del AS: emitir, recibir con diferencias, rechazar y cancelar (T-101; RF-044 a
// RF-047, RF-150, RF-151). Los saldos, los faltantes y las alertas los resuelve el backend.
import type { StockRow, Transfer } from '@pos/contracts';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { formatQuantity, inventoryApi, TRANSFER_STATES } from '../../api/inventory';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { BranchSelect, useOwnBranches } from './BranchSelect';

interface IssueForm {
  origenId: string;
  destinoId: string;
  items: { productoId: string; cantidad: string }[];
}

type Reception = Record<string, { recibida: string; rechazada: string }>;

export function TransfersPage() {
  const { request } = useAuth();
  const api = useMemo(() => inventoryApi(request), [request]);
  const branches = useOwnBranches(api);
  const ownIds = new Set(branches.own.map((b) => b.id));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issue, setIssue] = useState<IssueForm | null>(null);
  const [originStock, setOriginStock] = useState<StockRow[]>([]);
  const [receiving, setReceiving] = useState<{ transfer: Transfer; lines: Reception } | null>(null);

  const fetchTransfers = useCallback(() => api.listTransfers(), [api]);
  const loaded = useLoader(fetchTransfers, 'No se pudieron cargar las transferencias.');

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      loaded.reload();
      return true;
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo completar la acción.'));
      return false;
    }
  }

  async function chooseOrigin(origenId: string, current: IssueForm | null) {
    const stock = await api.listStock(origenId).catch(() => []);
    setOriginStock(stock);
    const destino = branches.all.find((b) => b.id !== origenId)?.id ?? '';
    setIssue({
      origenId,
      destinoId: current?.destinoId && current.destinoId !== origenId ? current.destinoId : destino,
      items: [{ productoId: stock[0]?.productoId ?? '', cantidad: '' }],
    });
  }

  async function send() {
    if (!issue) return;
    const ok = await run(
      () => api.issueTransfer(issue),
      'Transferencia emitida: el stock quedó en tránsito.',
    );
    if (ok) setIssue(null);
  }

  async function receive() {
    if (!receiving) return;
    const { transfer, lines } = receiving;
    const ok = await run(
      () =>
        api.receiveTransfer(transfer.id, {
          items: transfer.items.map((item) => ({
            productoId: item.productoId,
            recibida: lines[item.productoId]?.recibida ?? '0',
            rechazada: lines[item.productoId]?.rechazada ?? '0',
          })),
        }),
      'Transferencia recibida.',
    );
    if (ok) setReceiving(null);
  }

  const startReception = (transfer: Transfer) => {
    setReceiving({
      transfer,
      lines: Object.fromEntries(
        transfer.items.map((item) => [
          item.productoId,
          { recibida: String(Number(item.enviada)), rechazada: '0' },
        ]),
      ),
    });
  };

  const products = originStock.filter((row) => row.activo);

  return (
    <AppShell>
      <Stack spacing={3}>
        {(error ?? loaded.error ?? branches.error) !== null && (
          <Alert severity="error">{error ?? loaded.error ?? branches.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}

        <PageSection
          title="Transferencias"
          actions={
            <Button
              variant="contained"
              disabled={branches.own.length === 0 || branches.all.length < 2}
              onClick={() => {
                const origin = branches.own[0];
                if (origin) void chooseOrigin(origin.id, null);
              }}
            >
              Nueva transferencia
            </Button>
          }
        >
          <TableContainer>
            <Table size="small" aria-label="Transferencias">
              <TableHead>
                <TableRow>
                  <TableCell>Emitida</TableCell>
                  <TableCell>Origen</TableCell>
                  <TableCell>Destino</TableCell>
                  <TableCell>Productos</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loaded.data?.map((t) => {
                  const pending = t.estado === 'enviada';
                  return (
                    <TableRow key={t.id}>
                      <TableCell>{new Date(t.emitidaEn).toLocaleString('es-AR')}</TableCell>
                      <TableCell>{t.origen.nombre}</TableCell>
                      <TableCell>{t.destino.nombre}</TableCell>
                      <TableCell>
                        {t.items
                          .map((item) => {
                            const missing = Number(item.faltante ?? 0);
                            return `${formatQuantity(item.enviada)} × ${item.nombre}${missing > 0 ? ` (faltaron ${formatQuantity(item.faltante)})` : ''}`;
                          })
                          .join(', ')}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={pending ? 'info' : t.estado === 'parcial' ? 'warning' : 'default'}
                          label={TRANSFER_STATES[t.estado]}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {pending && (
                          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                            {ownIds.has(t.destino.id) && (
                              <>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    startReception(t);
                                  }}
                                >
                                  Recibir
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => {
                                    if (window.confirm('¿Rechazar toda la transferencia?')) {
                                      void run(
                                        () => api.rejectTransfer(t.id),
                                        'Transferencia rechazada: el stock volvió al origen.',
                                      );
                                    }
                                  }}
                                >
                                  Rechazar
                                </Button>
                              </>
                            )}
                            {ownIds.has(t.origen.id) && (
                              <Button
                                size="small"
                                color="error"
                                onClick={() => {
                                  if (window.confirm('¿Cancelar la transferencia?')) {
                                    void run(
                                      () => api.cancelTransfer(t.id),
                                      'Transferencia cancelada: el stock volvió al disponible.',
                                    );
                                  }
                                }}
                              >
                                Cancelar
                              </Button>
                            )}
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </PageSection>
      </Stack>

      <Dialog
        open={issue !== null}
        onClose={() => {
          setIssue(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Nueva transferencia</DialogTitle>
        <DialogContent>
          {issue !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <BranchSelect
                  label="Origen"
                  branches={branches.own}
                  value={issue.origenId}
                  onChange={(id) => void chooseOrigin(id, issue)}
                />
                <BranchSelect
                  label="Destino"
                  branches={branches.all.filter((b) => b.id !== issue.origenId)}
                  value={issue.destinoId}
                  onChange={(id) => {
                    setIssue({ ...issue, destinoId: id });
                  }}
                />
              </Stack>
              {issue.items.map((item, index) => (
                <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField
                    select
                    label={`Producto ${String(index + 1)}`}
                    value={item.productoId}
                    onChange={(e) => {
                      const items = [...issue.items];
                      items[index] = { ...item, productoId: e.target.value };
                      setIssue({ ...issue, items });
                    }}
                    sx={{ flexGrow: 1 }}
                  >
                    {products.map((p) => (
                      <MenuItem key={p.productoId} value={p.productoId}>
                        {p.nombre} (disponible {formatQuantity(p.disponible)})
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={`Cantidad ${String(index + 1)}`}
                    value={item.cantidad}
                    onChange={(e) => {
                      const items = [...issue.items];
                      items[index] = { ...item, cantidad: e.target.value };
                      setIssue({ ...issue, items });
                    }}
                    sx={{ width: 120 }}
                  />
                  {issue.items.length > 1 && (
                    <IconButton
                      aria-label={`Quitar producto ${String(index + 1)}`}
                      onClick={() => {
                        setIssue({ ...issue, items: issue.items.filter((_, i) => i !== index) });
                      }}
                    >
                      ×
                    </IconButton>
                  )}
                </Stack>
              ))}
              <Button
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setIssue({
                    ...issue,
                    items: [
                      ...issue.items,
                      { productoId: products[0]?.productoId ?? '', cantidad: '' },
                    ],
                  });
                }}
              >
                Agregar producto
              </Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setIssue(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={() => void send()}
            disabled={!issue?.destinoId || issue.items.some((i) => !i.productoId || !i.cantidad)}
          >
            Emitir
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={receiving !== null}
        onClose={() => {
          setReceiving(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Recibir transferencia</DialogTitle>
        <DialogContent>
          {receiving !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                Lo que no se reciba ni se rechace se registra como faltante (merma por pérdida en
                tránsito) y se alerta a las dos sucursales.
              </Typography>
              {receiving.transfer.items.map((item) => {
                const line = receiving.lines[item.productoId] ?? { recibida: '', rechazada: '' };
                const update = (change: Partial<typeof line>) => {
                  setReceiving({
                    ...receiving,
                    lines: { ...receiving.lines, [item.productoId]: { ...line, ...change } },
                  });
                };
                return (
                  <Stack
                    key={item.productoId}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <Typography sx={{ flexGrow: 1 }}>
                      {item.nombre}: enviadas {formatQuantity(item.enviada)}
                    </Typography>
                    <TextField
                      label={`Recibidas de ${item.nombre}`}
                      value={line.recibida}
                      onChange={(e) => {
                        update({ recibida: e.target.value });
                      }}
                      sx={{ width: 150 }}
                    />
                    <TextField
                      label={`Rechazadas de ${item.nombre}`}
                      value={line.rechazada}
                      onChange={(e) => {
                        update({ rechazada: e.target.value });
                      }}
                      sx={{ width: 150 }}
                    />
                  </Stack>
                );
              })}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setReceiving(null);
            }}
          >
            Cancelar
          </Button>
          <Button variant="contained" onClick={() => void receive()}>
            Confirmar recepción
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
