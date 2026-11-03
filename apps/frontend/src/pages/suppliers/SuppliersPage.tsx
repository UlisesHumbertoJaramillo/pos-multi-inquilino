// Proveedores del AC: alta y modificación, cuenta con su saldo, pagos e importación de catálogo
// (T-110; RF-034, RF-035, RF-037, RF-038). El saldo, el exceso y la importación los resuelve el
// backend; acá solo se muestran.
import type {
  CatalogImportResult,
  Supplier,
  SupplierPaymentRequest,
  SupplierStatement,
} from '@pos/contracts';
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
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { ApiError } from '../../api/httpClient';
import { PAYMENT_METHOD_NAMES, suppliersApi } from '../../api/suppliers';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

interface SupplierForm {
  id: string | null;
  razonSocial: string;
  cuit: string;
  contacto: string;
}

interface PaymentForm {
  supplier: Supplier;
  monto: string;
  metodo: SupplierPaymentRequest['metodo'];
  comprobante: string;
  // El backend avisó que el pago supera la deuda: hace falta confirmarlo (RF-038).
  excessWarning: string | null;
}

export function SuppliersPage() {
  const { request } = useAuth();
  const api = useMemo(() => suppliersApi(request), [request]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm | null>(null);
  const [payment, setPayment] = useState<PaymentForm | null>(null);
  const [statement, setStatement] = useState<SupplierStatement | null>(null);
  const [importFor, setImportFor] = useState<Supplier | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<CatalogImportResult | null>(null);

  const fetchSuppliers = useCallback(() => api.listSuppliers(), [api]);
  const loaded = useLoader(fetchSuppliers, 'No se pudieron cargar los proveedores.');

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
    if (!form) return;
    const body = {
      razonSocial: form.razonSocial,
      cuit: form.cuit.trim() || null,
      contacto: form.contacto.trim() || null,
    };
    const ok = await run(
      () => (form.id ? api.updateSupplier(form.id, body) : api.createSupplier(body)),
      form.id
        ? `Proveedor «${form.razonSocial}» modificado.`
        : `Proveedor «${form.razonSocial}» creado.`,
    );
    if (ok) setForm(null);
  }

  async function pay(confirm: boolean) {
    if (!payment) return;
    setError(null);
    setNotice(null);
    try {
      const result = await api.registerPayment(payment.supplier.id, {
        monto: payment.monto,
        metodo: payment.metodo,
        comprobante: payment.comprobante,
        ...(confirm ? { confirmarExceso: true } : {}),
      });
      setPayment(null);
      setNotice(
        `Pago registrado a ${payment.supplier.razonSocial}. Saldo: ${formatMoney(result.saldoAdeudado)}.`,
      );
      loaded.reload();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === 'PAGO_EXCEDE_DEUDA') {
        setPayment({ ...payment, excessWarning: e.message });
        return;
      }
      setError(errorMessage(e, 'No se pudo registrar el pago.'));
    }
  }

  async function upload() {
    if (!importFor || !importFile) return;
    setError(null);
    try {
      setImportResult(await api.importCatalog(importFor.id, importFile));
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo importar el catálogo.'));
      setImportFor(null);
    }
  }

  const closeImport = () => {
    setImportFor(null);
    setImportFile(null);
    setImportResult(null);
  };

  return (
    <AppShell>
      <PageSection
        title="Proveedores"
        actions={
          <Button
            variant="contained"
            onClick={() => {
              setForm({ id: null, razonSocial: '', cuit: '', contacto: '' });
            }}
          >
            Nuevo proveedor
          </Button>
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Proveedores">
            <TableHead>
              <TableRow>
                <TableCell>Razón social</TableCell>
                <TableCell>CUIT</TableCell>
                <TableCell align="right">Saldo adeudado</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loaded.data?.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    {s.razonSocial}
                    {s.contacto && (
                      <Typography variant="body2" color="text.secondary">
                        {s.contacto}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{s.cuit ?? '—'}</TableCell>
                  <TableCell align="right">{formatMoney(s.saldoAdeudado)}</TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}
                    >
                      <Button
                        size="small"
                        onClick={() =>
                          void api.getStatement(s.id).then(setStatement, (e: unknown) => {
                            setError(errorMessage(e, 'No se pudo cargar la cuenta.'));
                          })
                        }
                      >
                        Cuenta
                      </Button>
                      <Button
                        size="small"
                        aria-label={`Pagar a ${s.razonSocial}`}
                        onClick={() => {
                          setPayment({
                            supplier: s,
                            monto: '',
                            metodo: 'transferencia',
                            comprobante: '',
                            excessWarning: null,
                          });
                        }}
                      >
                        Pagar
                      </Button>
                      <Button
                        size="small"
                        aria-label={`Importar catálogo de ${s.razonSocial}`}
                        onClick={() => {
                          setImportFor(s);
                        }}
                      >
                        Importar catálogo
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          setForm({
                            id: s.id,
                            razonSocial: s.razonSocial,
                            cuit: s.cuit ?? '',
                            contacto: s.contacto ?? '',
                          });
                        }}
                      >
                        Modificar
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          if (window.confirm(`¿Dar de baja a ${s.razonSocial}?`)) {
                            void run(
                              () => api.deactivateSupplier(s.id),
                              `${s.razonSocial} dado de baja.`,
                            );
                          }
                        }}
                      >
                        Dar de baja
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </PageSection>

      <Dialog
        open={form !== null}
        onClose={() => {
          setForm(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{form?.id ? 'Modificar proveedor' : 'Nuevo proveedor'}</DialogTitle>
        <DialogContent>
          {form !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Razón social"
                value={form.razonSocial}
                onChange={(e) => {
                  setForm({ ...form, razonSocial: e.target.value });
                }}
                required
                autoFocus
              />
              <TextField
                label="CUIT (opcional)"
                value={form.cuit}
                onChange={(e) => {
                  setForm({ ...form, cuit: e.target.value });
                }}
                helperText="11 dígitos; se aceptan guiones."
              />
              <TextField
                label="Contacto (opcional)"
                value={form.contacto}
                onChange={(e) => {
                  setForm({ ...form, contacto: e.target.value });
                }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setForm(null);
            }}
          >
            Cancelar
          </Button>
          <Button variant="contained" onClick={() => void save()} disabled={!form?.razonSocial}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={payment !== null}
        onClose={() => {
          setPayment(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Pago a {payment?.supplier.razonSocial}</DialogTitle>
        <DialogContent>
          {payment !== null && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                Saldo adeudado: {formatMoney(payment.supplier.saldoAdeudado)}
              </Typography>
              <TextField
                label="Monto"
                value={payment.monto}
                onChange={(e) => {
                  setPayment({ ...payment, monto: e.target.value, excessWarning: null });
                }}
                required
                autoFocus
              />
              <TextField
                select
                label="Método"
                value={payment.metodo}
                onChange={(e) => {
                  setPayment({
                    ...payment,
                    metodo: e.target.value as SupplierPaymentRequest['metodo'],
                  });
                }}
              >
                {Object.entries(PAYMENT_METHOD_NAMES).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Comprobante de referencia"
                value={payment.comprobante}
                onChange={(e) => {
                  setPayment({ ...payment, comprobante: e.target.value });
                }}
                helperText="Número de transferencia, recibo o cheque."
                required
              />
              {payment.excessWarning !== null && (
                <Alert severity="warning">{payment.excessWarning}</Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPayment(null);
            }}
          >
            Cancelar
          </Button>
          {payment?.excessWarning ? (
            <Button variant="contained" color="warning" onClick={() => void pay(true)}>
              Confirmar pago
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => void pay(false)}
              disabled={!payment?.monto || !payment.comprobante}
            >
              Registrar pago
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog
        open={statement !== null}
        onClose={() => {
          setStatement(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Cuenta de {statement?.proveedor.razonSocial}</DialogTitle>
        <DialogContent>
          {statement !== null && (
            <Stack spacing={2}>
              <Typography>
                Saldo adeudado: <strong>{formatMoney(statement.proveedor.saldoAdeudado)}</strong>
              </Typography>
              <Table size="small" aria-label="Movimientos de la cuenta">
                <TableHead>
                  <TableRow>
                    <TableCell>Fecha</TableCell>
                    <TableCell>Movimiento</TableCell>
                    <TableCell>Comprobante</TableCell>
                    <TableCell align="right">Importe</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {statement.movimientos.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{new Date(m.momento).toLocaleDateString('es-AR')}</TableCell>
                      <TableCell>{m.tipo === 'compra' ? 'Compra' : 'Pago'}</TableCell>
                      <TableCell>{m.referencia ?? '—'}</TableCell>
                      <TableCell align="right">
                        {m.tipo === 'pago' ? '−' : ''}
                        {formatMoney(m.importe)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setStatement(null);
            }}
          >
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importFor !== null} onClose={closeImport} fullWidth maxWidth="sm">
        <DialogTitle>Importar catálogo de {importFor?.razonSocial}</DialogTitle>
        <DialogContent>
          {importResult === null ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                Archivo CSV con las columnas Código de barras, Nombre, Costo (sin IVA) y Categoría,
                separadas por coma o punto y coma. Los productos se identifican por código de
                barras: los que existen se actualizan y los nuevos se crean. La categoría tiene que
                existir.
              </Typography>
              <Button variant="outlined" component="label">
                {importFile ? `Archivo: ${importFile.name}` : 'Elegir archivo CSV'}
                <input
                  hidden
                  type="file"
                  aria-label="Archivo del catálogo"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] ?? null);
                  }}
                />
              </Button>
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity={importResult.errores.length > 0 ? 'warning' : 'success'}>
                Se importaron {importResult.filasOk} filas: {importResult.creados} productos nuevos
                y {importResult.actualizados} actualizados. Se recalcularon{' '}
                {importResult.preciosRecalculados} precios.
              </Alert>
              {importResult.errores.length > 0 && (
                <Table size="small" aria-label="Filas no importadas">
                  <TableHead>
                    <TableRow>
                      <TableCell>Fila</TableCell>
                      <TableCell>Código</TableCell>
                      <TableCell>Motivo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {importResult.errores.map((e) => (
                      <TableRow key={e.fila}>
                        <TableCell>{e.fila}</TableCell>
                        <TableCell>{e.codigoBarras || '—'}</TableCell>
                        <TableCell>{e.motivo}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeImport}>{importResult ? 'Cerrar' : 'Cancelar'}</Button>
          {importResult === null && (
            <Button variant="contained" disabled={!importFile} onClick={() => void upload()}>
              Importar
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
