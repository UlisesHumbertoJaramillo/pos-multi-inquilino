// «Ir a…» de la administración y los dashboards (T-280; RF-194): F2 abre un buscador de secciones;
// se escribe parte del nombre y Enter lleva a esa sección. No se dispara mientras se escribe en un
// campo. El menú es el del rol activo: los permisos los sigue verificando el backend.
import type { Role } from '@pos/contracts';
import { Autocomplete, Button, Dialog, DialogContent, DialogTitle, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { navigationFor, type NavItem } from '../navigation';
import { Kbd } from '../shortcuts/ShortcutHint';
import { focusKind } from '../shortcuts/keys';

export const QUICK_NAV_KEY = 'F2';

export function QuickNav({ role, billingModule }: { role: Role; billingModule: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items = navigationFor(role, billingModule).filter((item) => item.available);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== QUICK_NAV_KEY || event.ctrlKey || event.altKey || event.metaKey) return;
      if (focusKind(event.target) === 'texto' || focusKind(event.target) === 'bloqueado') return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      <Button
        color="inherit"
        aria-label="Ir a una sección"
        onClick={() => {
          setOpen(true);
        }}
      >
        Ir a…<Kbd>{QUICK_NAV_KEY}</Kbd>
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Ir a una sección</DialogTitle>
        <DialogContent>
          <Autocomplete<NavItem>
            options={items}
            getOptionLabel={(item) => item.label}
            autoHighlight
            openOnFocus
            onChange={(_, item) => {
              if (!item) return;
              setOpen(false);
              void navigate(item.path);
            }}
            renderInput={(params) => (
              <TextField {...params} label="Sección" autoFocus sx={{ mt: 1 }} />
            )}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
