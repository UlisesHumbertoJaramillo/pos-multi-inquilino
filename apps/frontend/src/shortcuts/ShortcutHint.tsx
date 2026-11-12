// El atajo de cada acción, visible junto a ella, y la ayuda con todos los atajos (T-278; RF-183).
import type { ShortcutAction } from '@pos/contracts';
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import { keyLabel } from './keys';
import { useShortcutMap } from './ShortcutsContext';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        fontFamily: 'inherit',
        fontSize: '0.75rem',
        fontWeight: 600,
        lineHeight: 1,
        px: 0.75,
        py: 0.4,
        ml: 1,
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        borderBottomWidth: 2,
        color: 'text.secondary',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

// Texto de un botón con su atajo, si la acción tiene uno.
export function WithShortcut({
  action,
  children,
}: {
  action: ShortcutAction;
  children: ReactNode;
}) {
  const { map } = useShortcutMap();
  const key = map[action] ?? null;
  return (
    <>
      {children}
      {key !== null && <Kbd>{keyLabel(key)}</Kbd>}
    </>
  );
}

// Nombre accesible de una acción con su atajo: «Cobrar (atajo +)».
export function useShortcutLabel() {
  const { map } = useShortcutMap();
  return (action: ShortcutAction, label: string) => {
    const key = map[action] ?? null;
    return key === null ? label : `${label} (atajo ${keyLabel(key)})`;
  };
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const { map, names } = useShortcutMap();
  const rows = (Object.keys(names) as ShortcutAction[]).filter((a) => (map[a] ?? null) !== null);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Atajos del teclado</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Los números y la coma siempre se escriben. Para la cantidad, escribila y apretá{' '}
          {keyLabel(map.cantidad ?? 'NumpadMultiply')} antes del producto.
        </Typography>
        <Table size="small" aria-label="Atajos del teclado">
          <TableHead>
            <TableRow>
              <TableCell>Acción</TableCell>
              <TableCell align="right">Tecla</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((action) => (
              <TableRow key={action}>
                <TableCell>{names[action]}</TableCell>
                <TableCell align="right">
                  <Kbd>{keyLabel(map[action] ?? '')}</Kbd>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell>Moverse entre productos y medios de pago</TableCell>
              <TableCell align="right">
                <Kbd>Flechas</Kbd>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Listo
        </Button>
      </DialogActions>
    </Dialog>
  );
}
