// Punto de venta del VO: apertura de turno, ingresos y retiros con PIN, Corte X y Corte Z ciegos
// (T-141, T-142; RF-089, RF-091 a RF-095), y las ventas del turno (SalesPanel). Esta pantalla nunca
// recibe el saldo teórico ni el resultado del arqueo: el backend no los envía a un VO (RF-112,
// D-80). Al entrar, si hay una sola caja libre se propone abrirla (RF-177); el Corte X tiene su
// atajo, y los movimientos del turno van en un segundo nivel (RF-192).
import type { CashCount } from '@pos/contracts';
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Grid,
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
import { useCallback, useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { cashApi, MOVEMENT_NAMES, twoDecimals } from '../../api/cash';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { Status } from '../../components/Status';
import { errorMessage, PageSection } from '../../components/PageSection';
import { PinDialog, type PinRequest } from '../../components/PinDialog';
import { useLoader } from '../../hooks/useLoader';
import { AmountDialog, type AmountRequest, CountResultDialog } from '../cash/CashDialogs';
import { DetailPanel } from '../../components/DetailPanel';
import { WithShortcut } from '../../shortcuts/ShortcutHint';
import { useShortcuts } from '../../shortcuts/ShortcutsContext';
import { SalesPanel } from './SalesPanel';

type Operation =
  | { kind: 'abrir'; registerId: string; name: string }
  | { kind: 'ingreso' }
  | { kind: 'retiro' }
  | { kind: 'corte_x' }
  | { kind: 'corte_z'; registerId: string; name: string };

const REQUESTS: Record<Operation['kind'], AmountRequest> = {
  abrir: {
    title: 'Abrir turno',
    label: 'Saldo inicial',
    helper: 'Contá el efectivo con el que arrancás.',
    withReason: false,
    confirm: 'Abrir turno',
  },
  ingreso: { title: 'Ingreso de efectivo', label: 'Monto', withReason: true, confirm: 'Registrar' },
  retiro: {
    title: 'Retiro de efectivo',
    label: 'Monto',
    helper: 'Lo tiene que autorizar un AS de la sucursal con su PIN.',
    withReason: true,
    confirm: 'Pedir autorización',
  },
  corte_x: {
    title: 'Corte X',
    label: 'Efectivo contado',
    helper: 'Contá el efectivo de la caja y declaralo. Se cierra tu turno.',
    withReason: false,
    confirm: 'Cerrar turno',
  },
  corte_z: {
    title: 'Corte Z',
    label: 'Efectivo total contado',
    helper: 'Contá todo el efectivo de la caja. Se cierra la jornada.',
    withReason: false,
    confirm: 'Cerrar jornada',
  },
};

export function PosPage() {
  const { request, user } = useAuth();
  const api = useMemo(() => cashApi(request), [request]);
  const branches = user?.sucursales ?? [];
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const branchId = selectedBranch ?? branches[0] ?? null;
  const [chosen, setOperation] = useState<Operation | null>(null);
  const [proposalDismissed, setProposalDismissed] = useState(false);
  const [pin, setPin] = useState<(PinRequest & { amount: string; reason: string }) | null>(null);
  const [result, setResult] = useState<{ title: string; count: CashCount } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const own = await api.getOwnShift();
    const registers = branchId === null || own.turno ? [] : await api.listRegisters(branchId);
    return { own, registers };
  }, [api, branchId]);
  const loaded = useLoader(fetchData, 'No se pudo cargar la caja.');
  const shift = loaded.data?.own.turno ?? null;
  const [movementsOpen, setMovementsOpen] = useState(false);

  // Una sola caja libre en la sucursal: se propone abrirla y solo se pide el saldo (RF-177). Se
  // propone una vez; si el VO cancela, elige él.
  const free =
    shift || !loaded.data
      ? []
      : loaded.data.registers.filter((r) => !r.turnoAbierto && !r.requiereCorteZ);
  const only = free.length === 1 ? free[0] : undefined;
  const proposal: Operation | null =
    !proposalDismissed && only ? { kind: 'abrir', registerId: only.id, name: only.nombre } : null;
  const operation = chosen ?? proposal;

  useShortcuts(
    {
      corte_x: () => {
        if (shift) setOperation({ kind: 'corte_x' });
      },
    },
    operation === null && pin === null && result === null,
  );

  function close() {
    setOperation(null);
    setProposalDismissed(true);
    setDialogError(null);
  }

  async function run(action: () => Promise<unknown>, success: string | null) {
    setDialogError(null);
    setNotice(null);
    setError(null);
    try {
      await action();
      close();
      if (success) setNotice(success);
      loaded.reload();
    } catch (e: unknown) {
      setDialogError(errorMessage(e, 'No se pudo completar la operación.'));
    }
  }

  function confirm(amount: string, reason: string) {
    if (!operation) return;
    switch (operation.kind) {
      case 'abrir':
        void run(() => api.openShift(operation.registerId, amount), 'Turno abierto.');
        break;
      case 'ingreso':
        void run(() => api.recordCashIn(amount, reason), 'Ingreso registrado.');
        break;
      case 'retiro': {
        if (!shift) return;
        const monto = twoDecimals(amount);
        close();
        setPin({
          type: 'retiro',
          operationRef: `retiro:${shift.id}:${monto}`,
          branchId: shift.sucursalId,
          summary: `Retiro de ${formatMoney(monto)}: ${reason}`,
          amount: monto,
          reason,
        });
        break;
      }
      case 'corte_x':
        void run(async () => {
          const closure = await api.closeOwnShift(amount);
          setResult({ title: 'Turno cerrado', count: closure.arqueo });
        }, null);
        break;
      case 'corte_z':
        void run(async () => {
          const closure = await api.closeJourney(operation.registerId, amount);
          setResult({ title: `Jornada de ${closure.caja} cerrada`, count: closure.arqueo });
        }, null);
        break;
    }
  }

  async function withdraw(authorizationId: string) {
    if (!pin) return;
    const pending = pin;
    setPin(null);
    setNotice(null);
    setError(null);
    try {
      await api.recordWithdrawal(pending.amount, pending.reason, authorizationId);
      setNotice('Retiro registrado.');
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo registrar el retiro.'));
    }
  }

  return (
    <AppShell register={shift?.caja ?? null}>
      <PageSection
        title="Punto de venta"
        actions={
          branches.length > 1 && !shift ? (
            <TextField
              select
              size="small"
              label="Sucursal"
              value={branchId ?? ''}
              onChange={(e) => {
                setSelectedBranch(e.target.value);
              }}
              sx={{ minWidth: 200 }}
            >
              {branches.map((id) => (
                <MenuItem key={id} value={id}>
                  {user?.detalleSucursales.find((b) => b.id === id)?.nombre ?? id}
                </MenuItem>
              ))}
            </TextField>
          ) : undefined
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}

        {shift ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="h6">{shift.caja}</Typography>
              <Status severity="correcta" label="Turno abierto" />
              <Typography variant="body2" color="text.secondary">
                Desde las{' '}
                {new Date(shift.abiertoEn).toLocaleTimeString('es-AR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                , con {formatMoney(shift.saldoInicial)} de saldo inicial
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                variant="outlined"
                size="large"
                onClick={() => {
                  setOperation({ kind: 'ingreso' });
                }}
              >
                Ingreso
              </Button>
              <Button
                variant="outlined"
                size="large"
                onClick={() => {
                  setOperation({ kind: 'retiro' });
                }}
              >
                Retiro
              </Button>
              <Button
                variant="outlined"
                size="large"
                onClick={() => {
                  setMovementsOpen(true);
                }}
              >
                Movimientos del turno
              </Button>
              <Button
                variant="contained"
                size="large"
                aria-label="Corte X"
                onClick={() => {
                  setOperation({ kind: 'corte_x' });
                }}
              >
                <WithShortcut action="corte_x">Corte X</WithShortcut>
              </Button>
            </Stack>
            <SalesPanel onChanged={loaded.reload} />
          </Stack>
        ) : null}
        <DetailPanel
          title="Movimientos del turno"
          open={movementsOpen}
          onClose={() => {
            setMovementsOpen(false);
          }}
        >
          <Stack spacing={1}>
            <Table size="small" aria-label="Movimientos del turno">
              <TableHead>
                <TableRow>
                  <TableCell>Hora</TableCell>
                  <TableCell>Movimiento</TableCell>
                  <TableCell>Motivo</TableCell>
                  <TableCell align="right">Monto</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loaded.data?.own.movimientos.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      {new Date(m.registradoEn).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell>{MOVEMENT_NAMES[m.tipo]}</TableCell>
                    <TableCell>{m.motivo ?? '—'}</TableCell>
                    <TableCell align="right">{formatMoney(m.monto)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {loaded.data?.own.movimientos.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                Todavía no hay movimientos en el turno.
              </Typography>
            )}
          </Stack>
        </DetailPanel>
        {shift ? null : (
          <>
            <Typography variant="body2" color="text.secondary">
              Elegí una caja para abrir tu turno.
            </Typography>
            <Grid container spacing={2}>
              {loaded.data?.registers.map((r) => (
                <Grid key={r.id} size={{ xs: 12, sm: 6, md: 4 }}>
                  <Card variant="outlined" aria-label={r.nombre}>
                    <CardContent>
                      <Typography variant="h6">{r.nombre}</Typography>
                      {r.turnoAbierto ? (
                        <Status
                          severity="informativa"
                          label={`Ocupada por ${r.turnoAbierto.vendedor}`}
                        />
                      ) : r.requiereCorteZ ? (
                        <Status severity="critica" label="Requiere Corte Z" />
                      ) : r.jornada ? (
                        <Status
                          severity="informativa"
                          label={`Jornada del ${new Date(`${r.jornada.fecha}T12:00:00`).toLocaleDateString('es-AR')}`}
                        />
                      ) : (
                        <Status severity="informativa" label="Sin jornada abierta" />
                      )}
                    </CardContent>
                    <CardActions>
                      {!r.turnoAbierto && !r.requiereCorteZ && (
                        <Button
                          variant="contained"
                          onClick={() => {
                            setOperation({ kind: 'abrir', registerId: r.id, name: r.nombre });
                          }}
                        >
                          Abrir turno
                        </Button>
                      )}
                      {!r.turnoAbierto && r.jornada && (
                        <Button
                          onClick={() => {
                            setOperation({ kind: 'corte_z', registerId: r.id, name: r.nombre });
                          }}
                        >
                          Corte Z
                        </Button>
                      )}
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        )}
      </PageSection>

      {operation && (
        <AmountDialog
          request={{
            ...REQUESTS[operation.kind],
            ...(operation.kind === 'abrir' || operation.kind === 'corte_z'
              ? { title: `${REQUESTS[operation.kind].title} · ${operation.name}` }
              : {}),
          }}
          error={dialogError}
          onConfirm={confirm}
          onCancel={close}
        />
      )}
      {pin && (
        <PinDialog
          pending={pin}
          onAuthorized={(id) => void withdraw(id)}
          onCancel={() => {
            setPin(null);
          }}
        />
      )}
      {result && (
        <CountResultDialog
          title={result.title}
          count={result.count}
          onClose={() => {
            setResult(null);
          }}
        />
      )}
    </AppShell>
  );
}
