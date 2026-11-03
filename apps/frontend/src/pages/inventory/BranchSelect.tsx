// Sucursales del comercio para las pantallas del AS: las propias (su ámbito) y todas (destinos de
// una transferencia). El ámbito real lo verifica el backend.
import type { TransferBranch } from '@pos/contracts';
import { MenuItem, TextField } from '@mui/material';
import { useCallback } from 'react';
import type { inventoryApi } from '../../api/inventory';
import { useLoader } from '../../hooks/useLoader';

export function useOwnBranches(api: ReturnType<typeof inventoryApi>) {
  const fetchBranches = useCallback(() => api.listBranches(), [api]);
  const loaded = useLoader(fetchBranches, 'No se pudieron cargar las sucursales.');
  const all = loaded.data ?? [];
  return { all, own: all.filter((b) => b.propia), error: loaded.error };
}

export function BranchSelect({
  branches,
  value,
  onChange,
  label = 'Sucursal',
}: {
  branches: TransferBranch[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value ?? ''}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      sx={{ minWidth: 200 }}
    >
      {branches.map((b) => (
        <MenuItem key={b.id} value={b.id}>
          {b.nombre}
        </MenuItem>
      ))}
    </TextField>
  );
}
