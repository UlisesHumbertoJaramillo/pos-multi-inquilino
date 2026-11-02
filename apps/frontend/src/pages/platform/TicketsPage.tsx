// Tickets de soporte para el SA: seguimiento y respuesta (T-058, RF-017).
import type { TicketDetail, TicketStatus, TicketSummary } from '@pos/contracts';
import {
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../auth/AuthContext';
import { useLoader } from '../../hooks/useLoader';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';

const STATUS_LABEL: Record<TicketStatus, string> = {
  abierto: 'Abierto',
  respondido: 'Respondido',
  cerrado: 'Cerrado',
};

export function TicketsPage() {
  const { request } = useAuth();
  const api = useMemo(() => platformApi(request), [request]);
  const [filter, setFilter] = useState<TicketStatus | ''>('abierto');
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(
    () => api.listTickets(filter === '' ? undefined : filter),
    [api, filter],
  );
  const loaded = useLoader(fetchTickets, 'No se pudieron cargar los tickets.');
  const tickets: TicketSummary[] = loaded.data ?? [];

  async function act(action: () => Promise<TicketDetail>) {
    setError(null);
    try {
      setSelected(await action());
      setReply('');
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo completar la acción.'));
    }
  }

  return (
    <AppShell>
      <PageSection
        title="Tickets de soporte"
        actions={
          <TextField
            select
            size="small"
            label="Estado"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as TicketStatus | '');
            }}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">Todos</MenuItem>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        }
      >
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <List sx={{ minWidth: 280 }} aria-label="Tickets">
            {tickets.length === 0 && (
              <Typography color="text.secondary">No hay tickets.</Typography>
            )}
            {tickets.map((ticket) => (
              <ListItemButton
                key={ticket.id}
                selected={selected?.id === ticket.id}
                onClick={() => void act(() => api.getTicket(ticket.id))}
              >
                <ListItemText primary={ticket.asunto} secondary={ticket.comercioNombre} />
                <Chip size="small" label={STATUS_LABEL[ticket.estado]} />
              </ListItemButton>
            ))}
          </List>
          {selected !== null && (
            <Stack spacing={2} sx={{ flexGrow: 1 }}>
              <Typography variant="h6">
                {selected.asunto} · {selected.comercioNombre}
              </Typography>
              {selected.mensajes.map((message) => (
                <Box
                  key={message.id}
                  sx={{
                    alignSelf: message.deSoporte ? 'flex-end' : 'flex-start',
                    bgcolor: message.deSoporte ? 'primary.main' : 'action.hover',
                    color: message.deSoporte ? 'primary.contrastText' : 'text.primary',
                    borderRadius: 2,
                    px: 2,
                    py: 1,
                    maxWidth: '80%',
                  }}
                >
                  <Typography variant="caption">
                    {message.deSoporte ? 'Soporte' : 'Comercio'}
                  </Typography>
                  <Typography sx={{ whiteSpace: 'pre-wrap' }}>{message.texto}</Typography>
                </Box>
              ))}
              {selected.estado !== 'cerrado' && (
                <>
                  <TextField
                    label="Respuesta"
                    multiline
                    minRows={3}
                    value={reply}
                    onChange={(e) => {
                      setReply(e.target.value);
                    }}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      disabled={!reply.trim()}
                      onClick={() => void act(() => api.replyTicket(selected.id, reply))}
                    >
                      Responder
                    </Button>
                    <Button onClick={() => void act(() => api.closeTicket(selected.id))}>
                      Cerrar ticket
                    </Button>
                  </Stack>
                </>
              )}
            </Stack>
          )}
        </Stack>
      </PageSection>
    </AppShell>
  );
}
