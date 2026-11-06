// Buscador de clientes del POS: la lista aparece mientras se escribe.
import type { SaleCustomer } from '@pos/contracts';
import { Autocomplete, ListItemText, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { formatMoney } from '../../api/catalog';

const SEARCH_DELAY_MS = 250;

export function CustomerPicker({
  search,
  onPick,
  label = 'Buscar cliente por nombre o documento',
}: {
  search: (q: string) => Promise<SaleCustomer[]>;
  onPick: (customer: SaleCustomer) => void;
  label?: string;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ term: string; items: SaleCustomer[] } | null>(null);
  const term = query.trim();
  useEffect(() => {
    if (term === '') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      search(term).then(
        (items) => {
          if (!cancelled) setFound({ term, items });
        },
        () => {
          if (!cancelled) setFound({ term, items: [] });
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, term]);
  const searching = term !== '' && found?.term !== term;

  return (
    <Autocomplete<SaleCustomer>
      options={!searching && term !== '' && found ? found.items : []}
      filterOptions={(x) => x}
      getOptionLabel={(c) => c.razonSocial}
      value={null}
      inputValue={query}
      onInputChange={(_, value, reason) => {
        if (reason !== 'reset') setQuery(value);
      }}
      onChange={(_, customer) => {
        if (customer) {
          setQuery('');
          onPick(customer);
        }
      }}
      open={term !== ''}
      autoHighlight
      clearOnBlur={false}
      loading={searching}
      loadingText="Buscando…"
      noOptionsText="No se encontraron clientes."
      popupIcon={null}
      renderOption={(props, c) => {
        const { key, ...rest } = props;
        return (
          <li key={key} {...rest} style={{ minHeight: 56 }}>
            <ListItemText
              primary={c.razonSocial}
              secondary={
                c.cuentaCorriente
                  ? `Debe ${formatMoney(c.saldo)} · disponible ${formatMoney(c.disponible)}`
                  : 'Sin cuenta corriente'
              }
            />
          </li>
        );
      }}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}
