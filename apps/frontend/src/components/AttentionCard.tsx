// Punto que necesita atención (T-253; RF-191): su severidad, qué pasa y la acción que lo resuelve.
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { SEVERITY_NAMES, SEVERITY_PALETTE, type Severity } from '../theme';
import { SeverityIcon } from './Status';

export function AttentionCard({
  severity,
  title,
  detail,
  action,
}: {
  severity: Severity;
  title: string;
  detail?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Paper
      variant="outlined"
      role="group"
      aria-label={`${SEVERITY_NAMES[severity]}: ${title}`}
      sx={(t) => ({
        p: 1.5,
        borderLeftWidth: 4,
        borderLeftColor: t.palette[SEVERITY_PALETTE[severity]].main,
        backgroundColor: 'transparent',
      })}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <SeverityIcon severity={severity} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
          {detail !== undefined && (
            <Typography variant="body2" color="text.secondary">
              {detail}
            </Typography>
          )}
        </Box>
        {action && (
          <Button variant="outlined" color={SEVERITY_PALETTE[severity]} onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
