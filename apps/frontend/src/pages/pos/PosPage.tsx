// Inicio del punto de venta (VO). La venta llega en la entrega E5.
import { AppShell } from '../../components/AppShell';
import { HomePanel } from '../HomePanel';

export function PosPage() {
  return (
    <AppShell>
      <HomePanel
        title="Punto de venta"
        description="Desde acá vas a abrir tu turno, vender y cobrar. La venta se habilita en una próxima entrega."
      />
    </AppShell>
  );
}
