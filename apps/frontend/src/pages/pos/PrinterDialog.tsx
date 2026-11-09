// Configuración de la impresora de este equipo (T-238): tipo, permiso del dispositivo y prueba.
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import type { PrintLine } from '../../peripherals/escpos';
import { PRINTER_LABELS, type PrinterKind, supportedKinds } from '../../peripherals/printers';
import type { PrinterControl } from '../../peripherals/usePrinter';

const TEST_PAGE: PrintLine[] = [
  { texto: 'Prueba de impresión', estilo: 'titulo' },
  { texto: '-'.repeat(48), estilo: 'normal' },
  { texto: 'Si leés esto, la impresora funciona.', estilo: 'normal' },
  { texto: 'Acentos: áéíóú ñ ü ¿¡', estilo: 'negrita' },
];

export function PrinterDialog({
  printer,
  onClose,
}: {
  printer: PrinterControl;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const kinds = supportedKinds();
  const needsPermission = printer.kind === 'usb' || printer.kind === 'serial';

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Impresora de tickets</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label="Impresora de este equipo"
            value={printer.kind}
            onChange={(e) => {
              setNotice(null);
              printer.choose(e.target.value as PrinterKind);
            }}
          >
            {kinds.map((k) => (
              <MenuItem key={k} value={k}>
                {PRINTER_LABELS[k]}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="body2" color="text.secondary">
            {printer.kind === 'usb' &&
              'Autorizá la impresora una sola vez: después cada ticket sale sin preguntar.'}
            {printer.kind === 'serial' &&
              'Para impresoras que Windows muestra como puerto COM. Autorizala una sola vez.'}
            {printer.kind === 'navegador' &&
              'Imprime en formato de 80 mm con el diálogo del navegador (sin diálogo si Chrome corre con --kiosk-printing).'}
            {printer.kind === 'ninguna' &&
              'Los tickets no se imprimen solos: podés verlos o imprimirlos desde cada venta.'}
          </Typography>
          {printer.status.state === 'falla' && (
            <Alert severity="error">{printer.status.message}</Alert>
          )}
          {notice !== null && <Alert severity="success">{notice}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {needsPermission && (
          <Button
            onClick={() =>
              void printer.connect().then((ok) => {
                if (ok) setNotice('Impresora autorizada.');
              })
            }
          >
            Autorizar impresora
          </Button>
        )}
        {printer.kind !== 'ninguna' && (
          <Button
            onClick={() =>
              void printer.print(TEST_PAGE).then((ok) => {
                if (ok) setNotice('Prueba enviada.');
              })
            }
          >
            Imprimir prueba
          </Button>
        )}
        <Button variant="contained" onClick={onClose}>
          Listo
        </Button>
      </DialogActions>
    </Dialog>
  );
}
