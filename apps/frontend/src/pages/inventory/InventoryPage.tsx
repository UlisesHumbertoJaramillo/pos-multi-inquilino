// Inventario de la sucursal del AS: saldos en cuatro estados, ajustes, umbrales, mermas,
// revisión, alertas, disponibilidad de combos y movimientos (T-100; RF-039 a RF-043, RF-052,
// RF-088). Los saldos y las reglas los calcula y valida el backend. Primer nivel: lo disponible, lo
// que está en revisión y el mínimo, con los puntos que necesitan atención; el resto, en el detalle
// de cada producto (RF-191, RF-192).
import type { StockRow, WasteReason } from '@pos/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { describeAlert, formatQuantity, inventoryApi, MOVEMENT_TYPES } from '../../api/inventory';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { AttentionCard } from '../../components/AttentionCard';
import { DetailList, DetailPanel } from '../../components/DetailPanel';
import { alertSeverity, Status } from '../../components/Status';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { BranchSelect, useOwnBranches } from './BranchSelect';

type Operation =
  | { kind: 'ajuste'; row: StockRow; cantidad: string; motivo: string }
  | { kind: 'merma'; row: StockRow; cantidad: string; motivo: WasteReason; observacion: string }
  | { kind: 'umbral'; row: StockRow; umbral: string }
  | {
      kind: 'revision';
      row: StockRow;
      accion: 'reingresar' | 'merma';
      cantidad: string;
      motivo: string;
    };

const WASTE_REASONS: Record<WasteReason, string> = {
  rotura: 'Rotura',
  vencimiento: 'Vencimiento',
  perdida: 'Pérdida',
};

const TITLES: Record<Operation['kind'], string> = {
  ajuste: 'Ajustar stock',
  merma: 'Registrar merma',
  umbral: 'Umbral mínimo',
  revision: 'Resolver stock en revisión',
};

export function InventoryPage() {
  const { request } = useAuth();
  const api = useMemo(() => inventoryApi(request), [request]);
  const branches = useOwnBranches(api);
  const [selected, setSelected] = useState<string | null>(null);
  const branchId = selected ?? branches.own[0]?.id ?? null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [detail, setDetail] = useState<StockRow | null>(null);

  const fetchData = useCallback(async () => {
    if (branchId === null) return null;
    return {
      stock: await api.listStock(branchId),
      alerts: await api.listAlerts(branchId),
      combos: await api.listCombos(branchId),
      movements: await api.listMovements(branchId),
    };
  }, [api, branchId]);
  const loaded = useLoader(fetchData, 'No se pudo cargar el inventario.');
  const data = loaded.data;

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

  async function save() {
    if (!operation || branchId === null) return;
    const product = operation.row.productoId;
    const name = operation.row.nombre;
    let action: () => Promise<unknown>;
    let success: string;
    switch (operation.kind) {
      case 'ajuste':
        action = () =>
          api.adjust(branchId, {
            productoId: product,
            cantidad: operation.cantidad,
            motivo: operation.motivo,
          });
        success = `Stock de ${name} ajustado.`;
        break;
      case 'merma':
        action = () =>
          api.recordWaste(branchId, {
            productoId: product,
            cantidad: operation.cantidad,
            motivo: operation.motivo,
            observacion: operation.observacion.trim() || null,
          });
        success = `Merma de ${name} registrada.`;
        break;
      case 'umbral':
        action = () => api.setMinimum(branchId, product, operation.umbral.trim() || null);
        success = `Umbral de ${name} actualizado.`;
        break;
      case 'revision':
        action = () =>
          api.resolveReview(branchId, product, {
            accion: operation.accion,
            cantidad: operation.cantidad,
            motivo: operation.accion === 'merma' ? operation.motivo : null,
          });
        success = `Stock en revisión de ${name} resuelto.`;
        break;
    }
    if (await run(action, success)) setOperation(null);
  }

  return (
    <AppShell>
      <Stack spacing={3}>
        {(error ?? loaded.error ?? branches.error) !== null && (
          <Alert severity="error">{error ?? loaded.error ?? branches.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}

        {(data?.alerts.length ?? 0) > 0 && (
          <PageSection title="Necesita atención">
            <Stack spacing={1}>
              {data?.alerts.map((alert) => {
                // El stock bajo se resuelve ajustando el producto; el resto se descarta al revisarlo.
                const row =
                  alert.tipo === 'stock_minimo'
                    ? data.stock.find((r) => r.productoId === alert.referencia)
                    : undefined;
                const action =
                  row !== undefined
                    ? {
                        label: 'Ajustar stock',
                        onClick: () => {
                          setOperation({ kind: 'ajuste', row, cantidad: '', motivo: '' });
                        },
                      }
                    : alert.tipo !== 'stock_minimo' && branchId !== null
                      ? {
                          label: 'Descartar',
                          onClick: () =>
                            void run(
                              () => api.dismissAlert(branchId, alert.id),
                              'Alerta descartada.',
                            ),
                        }
                      : undefined;
                return (
                  <AttentionCard
                    key={alert.id}
                    severity={alertSeverity(alert.severidad)}
                    title={describeAlert(alert)}
                    {...(action ? { action } : {})}
                  />
                );
              })}
            </Stack>
          </PageSection>
        )}

        <PageSection
          title="Inventario"
          actions={
            <BranchSelect
              branches={branches.own}
              value={branchId}
              onChange={(id) => {
                setSelected(id);
                setNotice(null);
              }}
            />
          }
        >
          <TableContainer>
            <Table size="small" aria-label="Stock de la sucursal">
              <TableHead>
                <TableRow>
                  <TableCell>Producto</TableCell>
                  <TableCell align="right">Disponible</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell align="right">En revisión</TableCell>
                  <TableCell align="right">Mínimo</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.stock.map((row) => (
                  <TableRow key={row.productoId}>
                    <TableCell>{row.nombre}</TableCell>
                    <TableCell align="right">{formatQuantity(row.disponible)}</TableCell>
                    <TableCell>
                      {row.alertaActiva ? (
                        <Status severity="advertencia" label="Stock bajo" />
                      ) : !row.activo ? (
                        <Status severity="informativa" label="Dado de baja" />
                      ) : Number(row.enRevision) > 0 ? (
                        <Status severity="informativa" label="En revisión" />
                      ) : null}
                    </TableCell>
                    <TableCell align="right">{formatQuantity(row.enRevision)}</TableCell>
                    <TableCell align="right">{formatQuantity(row.umbralMinimo)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          aria-label={`Detalle de ${row.nombre}`}
                          onClick={() => {
                            setDetail(row);
                          }}
                        >
                          Detalle
                        </Button>
                        <Button
                          size="small"
                          aria-label={`Ajustar ${row.nombre}`}
                          onClick={() => {
                            setOperation({ kind: 'ajuste', row, cantidad: '', motivo: '' });
                          }}
                        >
                          Ajustar
                        </Button>
                        {Number(row.enRevision) > 0 && (
                          <Button
                            size="small"
                            aria-label={`Revisar ${row.nombre}`}
                            onClick={() => {
                              setOperation({
                                kind: 'revision',
                                row,
                                accion: 'reingresar',
                                cantidad: String(Number(row.enRevision)),
                                motivo: '',
                              });
                            }}
                          >
                            Revisar
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </PageSection>

        <PageSection title="Combos">
          <TableContainer>
            <Table size="small" aria-label="Disponibilidad de combos">
              <TableHead>
                <TableRow>
                  <TableCell>Combo</TableCell>
                  <TableCell align="right">Unidades posibles</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.combos.map((combo) => (
                  <TableRow key={combo.comboId}>
                    <TableCell>{combo.nombre}</TableCell>
                    <TableCell align="right">
                      {combo.vendible ? (
                        combo.unidades
                      ) : (
                        <Status severity="advertencia" label="No disponible" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </PageSection>

        <PageSection title="Movimientos recientes">
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader aria-label="Movimientos de stock">
              <TableHead>
                <TableRow>
                  <TableCell>Fecha</TableCell>
                  <TableCell>Producto</TableCell>
                  <TableCell>Movimiento</TableCell>
                  <TableCell align="right">Cantidad</TableCell>
                  <TableCell>Motivo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{new Date(m.momento).toLocaleString('es-AR')}</TableCell>
                    <TableCell>{m.nombre}</TableCell>
                    <TableCell>{MOVEMENT_TYPES[m.tipo]}</TableCell>
                    <TableCell align="right">{formatQuantity(m.cantidad)}</TableCell>
                    <TableCell>{m.motivo ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </PageSection>
      </Stack>

      <DetailPanel
        title={detail ? detail.nombre : 'Producto'}
        open={detail !== null}
        onClose={() => {
          setDetail(null);
        }}
        actions={
          detail && (
            <>
              <Button
                aria-label={`Merma de ${detail.nombre}`}
                onClick={() => {
                  setOperation({
                    kind: 'merma',
                    row: detail,
                    cantidad: '',
                    motivo: 'rotura',
                    observacion: '',
                  });
                  setDetail(null);
                }}
              >
                Registrar merma
              </Button>
              <Button
                aria-label={`Umbral de ${detail.nombre}`}
                onClick={() => {
                  setOperation({
                    kind: 'umbral',
                    row: detail,
                    umbral: detail.umbralMinimo === null ? '' : String(Number(detail.umbralMinimo)),
                  });
                  setDetail(null);
                }}
              >
                Cambiar el mínimo
              </Button>
            </>
          )
        }
      >
        {detail && (
          <DetailList
            items={[
              { label: 'Disponible', value: formatQuantity(detail.disponible) },
              { label: 'Reservado en ventas en curso', value: formatQuantity(detail.reservado) },
              { label: 'En revisión', value: formatQuantity(detail.enRevision) },
              { label: 'En tránsito', value: formatQuantity(detail.enTransito) },
              { label: 'Mínimo', value: formatQuantity(detail.umbralMinimo) },
              { label: 'Estado del producto', value: detail.activo ? 'Activo' : 'Dado de baja' },
            ]}
          />
        )}
      </DetailPanel>

      <Dialog
        open={operation !== null}
        onClose={() => {
          setOperation(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {operation ? `${TITLES[operation.kind]}: ${operation.row.nombre}` : ''}
        </DialogTitle>
        <DialogContent>
          {operation !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {operation.kind === 'ajuste' && (
                <>
                  <TextField
                    label="Cantidad"
                    value={operation.cantidad}
                    onChange={(e) => {
                      setOperation({ ...operation, cantidad: e.target.value });
                    }}
                    helperText="Con signo: 5 suma, -2 resta."
                    required
                    autoFocus
                  />
                  <TextField
                    label="Motivo"
                    value={operation.motivo}
                    onChange={(e) => {
                      setOperation({ ...operation, motivo: e.target.value });
                    }}
                    required
                  />
                </>
              )}
              {operation.kind === 'merma' && (
                <>
                  <TextField
                    label="Cantidad"
                    value={operation.cantidad}
                    onChange={(e) => {
                      setOperation({ ...operation, cantidad: e.target.value });
                    }}
                    required
                    autoFocus
                  />
                  <TextField
                    select
                    label="Motivo"
                    value={operation.motivo}
                    onChange={(e) => {
                      setOperation({ ...operation, motivo: e.target.value as WasteReason });
                    }}
                  >
                    {Object.entries(WASTE_REASONS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Observación (opcional)"
                    value={operation.observacion}
                    onChange={(e) => {
                      setOperation({ ...operation, observacion: e.target.value });
                    }}
                  />
                </>
              )}
              {operation.kind === 'umbral' && (
                <TextField
                  label="Umbral mínimo"
                  value={operation.umbral}
                  onChange={(e) => {
                    setOperation({ ...operation, umbral: e.target.value });
                  }}
                  helperText="Vacío: sin umbral. Por debajo del mínimo se alerta una vez."
                  autoFocus
                />
              )}
              {operation.kind === 'revision' && (
                <>
                  <TextField
                    select
                    label="Destino"
                    value={operation.accion}
                    onChange={(e) => {
                      setOperation({
                        ...operation,
                        accion: e.target.value as 'reingresar' | 'merma',
                      });
                    }}
                  >
                    <MenuItem value="reingresar">Reingresar al disponible</MenuItem>
                    <MenuItem value="merma">Pasar a merma</MenuItem>
                  </TextField>
                  <TextField
                    label="Cantidad"
                    value={operation.cantidad}
                    onChange={(e) => {
                      setOperation({ ...operation, cantidad: e.target.value });
                    }}
                    required
                  />
                  {operation.accion === 'merma' && (
                    <TextField
                      label="Motivo"
                      value={operation.motivo}
                      onChange={(e) => {
                        setOperation({ ...operation, motivo: e.target.value });
                      }}
                      required
                    />
                  )}
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setOperation(null);
            }}
          >
            Cancelar
          </Button>
          <Button variant="contained" onClick={() => void save()}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
