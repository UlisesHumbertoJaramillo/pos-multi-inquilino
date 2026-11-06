// Caja de la sucursal para el AS: estado de las cajas, turnos abiertos con cierre forzado ciego,
// Corte Z y alertas de caja (T-143; RF-095, RF-097, RF-098, RF-115).
import type { CashCount, CashShift, CashRegisterStatus } from '@pos/contracts';
import {
  Alert,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { cashApi } from '../../api/cash';
import { describeAlert, inventoryApi } from '../../api/inventory';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { BranchSelect, useOwnBranches } from '../inventory/BranchSelect';
import { AmountDialog, CountResultDialog } from './CashDialogs';

const CASH_ALERTS = new Set([
  'reintegro_pendiente',
  'diferencia_apertura',
  'retiro_rechazado',
  'arqueo_fuera_de_tolerancia',
  'jornada_sin_z',
]);

type Operation =
  { kind: 'forzar'; shift: CashShift } | { kind: 'corte_z'; register: CashRegisterStatus };

const time = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

export function BranchCashPage() {
  const { request } = useAuth();
  const api = useMemo(() => cashApi(request), [request]);
  const inventory = useMemo(() => inventoryApi(request), [request]);
  const branches = useOwnBranches(inventory);
  const [selected, setSelected] = useState<string | null>(null);
  const branchId = selected ?? branches.own[0]?.id ?? null;
  const [operation, setOperation] = useState<Operation | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; count: CashCount } | null>(null);

  const fetchData = useCallback(async () => {
    if (branchId === null) return null;
    return {
      registers: await api.listRegisters(branchId),
      shifts: await api.listOpenShifts(branchId),
      alerts: (await inventory.listAlerts(branchId)).filter((a) => CASH_ALERTS.has(a.tipo)),
    };
  }, [api, inventory, branchId]);
  const loaded = useLoader(fetchData, 'No se pudo cargar la caja de la sucursal.');
  const data = loaded.data;

  async function confirm(amount: string) {
    if (!operation) return;
    setDialogError(null);
    try {
      if (operation.kind === 'forzar') {
        const closure = await api.forceCloseShift(operation.shift.id, amount);
        setResult({ title: `Turno de ${operation.shift.vendedor} cerrado`, count: closure.arqueo });
      } else {
        const closure = await api.closeJourney(operation.register.id, amount);
        setResult({ title: `Jornada de ${closure.caja} cerrada`, count: closure.arqueo });
      }
      setOperation(null);
      loaded.reload();
    } catch (e: unknown) {
      setDialogError(errorMessage(e, 'No se pudo completar la operación.'));
    }
  }

  return (
    <AppShell>
      <PageSection
        title="Caja"
        actions={
          <BranchSelect
            branches={branches.own}
            value={branchId}
            onChange={(id) => {
              setSelected(id);
            }}
          />
        }
      >
        {(loaded.error ?? branches.error) !== null && (
          <Alert severity="error">{loaded.error ?? branches.error}</Alert>
        )}
        {data?.alerts.map((alert) => (
          <Alert key={alert.id} severity={alert.severidad === 'critica' ? 'error' : 'warning'}>
            {describeAlert(alert)}
          </Alert>
        ))}

        <Typography variant="subtitle1">Cajas</Typography>
        <TableContainer>
          <Table size="small" aria-label="Cajas">
            <TableHead>
              <TableRow>
                <TableCell>Caja</TableCell>
                <TableCell>Jornada</TableCell>
                <TableCell>Turno abierto</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.registers.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.nombre}</TableCell>
                  <TableCell>
                    {r.jornada ? (
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <span>
                          {new Date(`${r.jornada.fecha}T12:00:00`).toLocaleDateString('es-AR')}
                        </span>
                        {r.requiereCorteZ && (
                          <Chip size="small" color="error" label="Requiere Corte Z" />
                        )}
                      </Stack>
                    ) : (
                      'Sin jornada abierta'
                    )}
                  </TableCell>
                  <TableCell>{r.turnoAbierto?.vendedor ?? '—'}</TableCell>
                  <TableCell align="right">
                    {r.jornada && !r.turnoAbierto && (
                      <Button
                        size="small"
                        onClick={() => {
                          setOperation({ kind: 'corte_z', register: r });
                        }}
                      >
                        Corte Z
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="subtitle1">Turnos abiertos</Typography>
        <TableContainer>
          <Table size="small" aria-label="Turnos abiertos">
            <TableHead>
              <TableRow>
                <TableCell>Vendedor</TableCell>
                <TableCell>Caja</TableCell>
                <TableCell>Abierto</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.shifts.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.vendedor}</TableCell>
                  <TableCell>{s.caja}</TableCell>
                  <TableCell>{time(s.abiertoEn)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      onClick={() => {
                        setOperation({ kind: 'forzar', shift: s });
                      }}
                    >
                      Forzar cierre
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data?.shifts.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No hay turnos abiertos en la sucursal.
          </Typography>
        )}
      </PageSection>

      {operation && (
        <AmountDialog
          request={
            operation.kind === 'forzar'
              ? {
                  title: `Forzar el cierre del turno de ${operation.shift.vendedor}`,
                  label: 'Efectivo contado',
                  helper:
                    'Contá el efectivo de la caja y declaralo. Las ventas en curso del turno se descartan y se avisa al AC.',
                  withReason: false,
                  confirm: 'Forzar cierre',
                }
              : {
                  title: `Corte Z · ${operation.register.nombre}`,
                  label: 'Efectivo total contado',
                  helper: 'Contá todo el efectivo de la caja. Se cierra la jornada.',
                  withReason: false,
                  confirm: 'Cerrar jornada',
                }
          }
          error={dialogError}
          onConfirm={(amount) => void confirm(amount)}
          onCancel={() => {
            setOperation(null);
            setDialogError(null);
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
