// Sección de productos del POS (T-271, T-272; RF-179, RF-180, D-95, D-102): lo más vendido de la
// sucursal y todo por categoría, para elegir con el mouse, el toque o el teclado. El orden, los
// precios y la disponibilidad los da el backend; la disponibilidad se actualiza en vivo (RF-061).
import type { ProductSection as Section, SaleSearchResult } from '@pos/contracts';
import { Box, ButtonBase, Stack, Tab, Tabs, Typography } from '@mui/material';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { formatMoney } from '../../api/catalog';
import { formatQuantity, salesApi } from '../../api/sales';
import { useAuth } from '../../auth/AuthContext';
import { useRealtime } from '../../realtime/RealtimeContext';

export interface ProductSectionHandle {
  // Lleva el foco al primer producto, para seguir con las flechas.
  focus: () => void;
}

const TOP = 'mas-vendidos';

const sellable = (p: SaleSearchResult) => p.precio !== null && Number(p.disponible) > 0;

export const ProductSection = forwardRef<
  ProductSectionHandle,
  { disabled: boolean; onPick: (product: SaleSearchResult) => void; onLeave: () => void }
>(function ProductSection({ disabled, onPick, onLeave }, ref) {
  const { request } = useAuth();
  const api = useMemo(() => salesApi(request), [request]);
  const [section, setSection] = useState<Section | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    api.catalog().then(setSection, () => undefined);
  }, [api]);
  useEffect(load, [load]);

  // Stock en vivo: el disponible de cada producto cambia sin recargar; un combo depende de varios
  // componentes, así que se vuelve a pedir la sección.
  const { onStock } = useRealtime();
  useEffect(
    () =>
      onStock((change) => {
        setSection((now) => {
          if (!now) return now;
          const update = (list: SaleSearchResult[]) =>
            list.map((p) =>
              p.id === change.productoId ? { ...p, disponible: change.disponible } : p,
            );
          if (now.categorias.some((c) => c.productos.some((p) => p.tipo === 'combo'))) load();
          return {
            masVendidos: update(now.masVendidos),
            categorias: now.categorias.map((c) => ({ ...c, productos: update(c.productos) })),
          };
        });
      }),
    [onStock, load],
  );

  const tabs = useMemo(() => {
    if (!section) return [];
    const list = section.categorias.map((c) => ({
      id: c.id ?? 'combos',
      name: c.nombre,
      products: c.productos,
    }));
    return section.masVendidos.length > 0
      ? [{ id: TOP, name: 'Más vendidos', products: section.masVendidos }, ...list]
      : list;
  }, [section]);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const products = current?.products ?? [];

  const focusCard = (index: number) => {
    cards.current[Math.max(0, Math.min(index, products.length - 1))]?.focus();
  };
  useImperativeHandle(ref, () => ({
    focus: () => {
      focusCard(0);
    },
  }));

  // Columnas de la grilla en pantalla: las tarjetas a la misma altura que la primera.
  const columns = () => {
    const first = cards.current[0]?.offsetTop;
    return Math.max(1, cards.current.filter((c) => c?.offsetTop === first).length);
  };

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns(),
      ArrowUp: -columns(),
    };
    const delta = step[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = index + delta;
    // Arriba de la primera fila: las categorías. A la izquierda de la primera: la búsqueda.
    if (next < 0) {
      if (event.key === 'ArrowUp')
        tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
      else onLeave();
      return;
    }
    focusCard(next);
  }

  if (!section) {
    return (
      <Typography variant="body2" color="text.secondary">
        Cargando los productos…
      </Typography>
    );
  }

  return (
    <Stack spacing={1} aria-label="Productos" role="region">
      <Tabs
        ref={tabsRef}
        value={current?.id ?? false}
        onChange={(_, value: string) => {
          setTab(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusCard(0);
          }
        }}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Categorías"
      >
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id} label={t.name} />
        ))}
      </Tabs>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 1,
        }}
      >
        {products.map((p, index) => {
          const enabled = !disabled && sellable(p);
          return (
            <ButtonBase
              key={p.id}
              ref={(element) => {
                cards.current[index] = element;
              }}
              disabled={!enabled}
              focusRipple
              aria-label={`${p.nombre}, ${p.precio === null ? 'sin precio' : formatMoney(p.precio)}, disponible ${formatQuantity(p.disponible)}`}
              onClick={() => {
                onPick(p);
              }}
              onKeyDown={(event) => {
                move(event, index);
              }}
              sx={(t) => ({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                textAlign: 'left',
                minHeight: 96,
                p: 1.5,
                borderRadius: 3,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                opacity: enabled ? 1 : 0.55,
                '&.Mui-focusVisible, &:hover': {
                  borderColor: t.palette.primary.main,
                  boxShadow: `0 0 0 2px ${t.palette.primary.main}`,
                },
              })}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.25 }}>
                {p.nombre}
              </Typography>
              <Stack direction="row" sx={{ width: '100%', alignItems: 'baseline', mt: 1 }}>
                <Typography sx={{ fontWeight: 700, flexGrow: 1 }}>
                  {p.precio === null ? 'Sin precio' : formatMoney(p.precio)}
                </Typography>
                <Typography
                  variant="caption"
                  color={Number(p.disponible) > 0 ? 'text.secondary' : 'error.main'}
                >
                  {Number(p.disponible) > 0 ? formatQuantity(p.disponible) : 'Sin stock'}
                </Typography>
              </Stack>
            </ButtonBase>
          );
        })}
      </Box>
      {products.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No hay productos en esta categoría.
        </Typography>
      )}
    </Stack>
  );
});
