// Carga desde Excel del AC (T-296; RF-170 a RF-174, D-98): se elige qué cargar, se descarga la
// plantilla, se elige el archivo y se ve la vista previa. Nada cambia hasta confirmar. Qué se crea,
// qué se actualiza y por qué se rechaza cada fila lo decide el backend.
import type { ImportSummary } from '@pos/contracts';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import {
  Alert,
  Button,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { useMemo, useRef, useState } from 'react';
import { IMPORT_KINDS, importsApi, type ImportKind } from '../../api/imports';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { Status } from '../../components/Status';
import { MetricRow } from '../reports/ReportTables';
import { Kpi } from '../../components/Charts';

const RESULTS = {
  creado: { severity: 'correcta', label: 'Se crea' },
  actualizado: { severity: 'informativa', label: 'Se actualiza' },
  error: { severity: 'critica', label: 'Se rechaza' },
} as const;

export function ImportPage() {
  const { request } = useAuth();
  const api = useMemo(() => importsApi(request), [request]);
  const [kind, setKind] = useState<ImportKind>('productos');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [applied, setApplied] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  function reset(nextKind: ImportKind = kind) {
    setKind(nextKind);
    setFile(null);
    setPreview(null);
    setApplied(null);
    setError(null);
    if (input.current) input.current.value = '';
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo procesar el archivo.'));
    } finally {
      setBusy(false);
    }
  }

  const download = () =>
    run(async () => {
      const blob = await api.template(kind);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `plantilla-${kind}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    });

  const shown = applied ?? preview;

  return (
    <AppShell>
      <PageSection title="Carga desde Excel">
        <Tabs
          value={kind}
          onChange={(_, value: ImportKind) => {
            reset(value);
          }}
          aria-label="Qué cargar"
        >
          {(Object.keys(IMPORT_KINDS) as ImportKind[]).map((k) => (
            <Tab key={k} value={k} label={IMPORT_KINDS[k].label} />
          ))}
        </Tabs>
        <Typography color="text.secondary">
          Columnas de la plantilla: {IMPORT_KINDS[kind].columns} Hasta 5.000 filas y 5 MB, en un
          libro de Excel (.xlsx) sin macros. Lo que no figura en el archivo no cambia.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button startIcon={<FileDownloadOutlined />} onClick={() => void download()}>
            Descargar la plantilla
          </Button>
          <Button
            variant="outlined"
            component="label"
            startIcon={<UploadFileOutlined />}
            disabled={busy}
          >
            {file ? `Archivo: ${file.name}` : 'Elegir el archivo'}
            <input
              ref={input}
              type="file"
              hidden
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Archivo de Excel"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
                setPreview(null);
                setApplied(null);
                setError(null);
                if (chosen)
                  void run(async () => {
                    setPreview(await api.preview(kind, chosen));
                  });
              }}
            />
          </Button>
        </Stack>

        {error !== null && <Alert severity="error">{error}</Alert>}
        {applied !== null && (
          <Alert severity="success">
            Carga hecha: {String(applied.creados)} creados y {String(applied.actualizados)}{' '}
            actualizados. Las {String(applied.rechazados)} filas rechazadas no cambiaron nada.
          </Alert>
        )}

        {shown !== null && (
          <Stack spacing={2} aria-label={applied ? 'Resultado de la carga' : 'Vista previa'}>
            {applied === null && (
              <Typography variant="subtitle1">Vista previa: todavía no se cargó nada.</Typography>
            )}
            <MetricRow>
              <Kpi label="Se crean" value={String(shown.creados)} />
              <Kpi label="Se actualizan" value={String(shown.actualizados)} />
              <Kpi label="Se rechazan" value={String(shown.rechazados)} />
            </MetricRow>
            <TableContainer sx={{ maxHeight: 420 }}>
              <Table size="small" stickyHeader aria-label="Filas del archivo">
                <TableHead>
                  <TableRow>
                    <TableCell>Fila</TableCell>
                    <TableCell>Clave</TableCell>
                    <TableCell>Resultado</TableCell>
                    <TableCell>Motivo</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shown.filas.map((f) => (
                    <TableRow key={f.fila}>
                      <TableCell>{f.fila}</TableCell>
                      <TableCell>{f.clave || '—'}</TableCell>
                      <TableCell>
                        <Status {...RESULTS[f.resultado]} />
                      </TableCell>
                      <TableCell>{f.motivo ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {applied === null && file !== null && (
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button
                  onClick={() => {
                    reset();
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  variant="contained"
                  disabled={busy || shown.creados + shown.actualizados === 0}
                  onClick={() =>
                    void run(async () => {
                      setApplied(await api.apply(kind, file));
                    })
                  }
                >
                  Confirmar la carga
                </Button>
              </Stack>
            )}
          </Stack>
        )}
      </PageSection>
    </AppShell>
  );
}
