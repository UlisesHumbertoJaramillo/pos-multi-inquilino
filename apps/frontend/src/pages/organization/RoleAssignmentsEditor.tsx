// Edición de los roles de un usuario del comercio: cada fila es un rol y, para el AS y el VO, su
// sucursal. Si la combinación es válida lo decide el backend (Const. 15).
import type { RoleAssignment } from '@pos/contracts';
import { Button, IconButton, MenuItem, Stack, TextField } from '@mui/material';
import { ROLE_NAMES } from '../../navigation';

export interface BranchOption {
  id: string;
  nombre: string;
}

const TENANT_ROLES = ['AC', 'AS', 'VO'] as const;

export function RoleAssignmentsEditor({
  value,
  branches,
  onChange,
}: {
  value: RoleAssignment[];
  branches: BranchOption[];
  onChange: (roles: RoleAssignment[]) => void;
}) {
  const replace = (index: number, next: RoleAssignment) => {
    onChange(value.map((item, i) => (i === index ? next : item)));
  };

  return (
    <Stack spacing={2}>
      {value.map((assignment, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            select
            label={`Rol ${String(index + 1)}`}
            value={assignment.rol}
            onChange={(e) => {
              const rol = e.target.value as RoleAssignment['rol'];
              replace(index, {
                rol,
                sucursalId:
                  rol === 'AC' ? null : (assignment.sucursalId ?? branches[0]?.id ?? null),
              });
            }}
            sx={{ minWidth: 220 }}
          >
            {TENANT_ROLES.map((role) => (
              <MenuItem key={role} value={role}>
                {ROLE_NAMES[role]}
              </MenuItem>
            ))}
          </TextField>
          {assignment.rol !== 'AC' && (
            <TextField
              select
              label={`Sucursal del rol ${String(index + 1)}`}
              value={assignment.sucursalId ?? ''}
              onChange={(e) => {
                replace(index, { ...assignment, sucursalId: e.target.value });
              }}
              sx={{ flexGrow: 1 }}
            >
              {branches.map((branch) => (
                <MenuItem key={branch.id} value={branch.id}>
                  {branch.nombre}
                </MenuItem>
              ))}
            </TextField>
          )}
          {value.length > 1 && (
            <IconButton
              aria-label={`Quitar rol ${String(index + 1)}`}
              onClick={() => {
                onChange(value.filter((_, i) => i !== index));
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
          onChange([...value, { rol: 'VO', sucursalId: branches[0]?.id ?? null }]);
        }}
      >
        Agregar rol
      </Button>
    </Stack>
  );
}
