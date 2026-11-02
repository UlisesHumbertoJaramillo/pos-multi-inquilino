// Inicio de la administración (SA, AC y AS). Cada sección llega con su entrega.
import { AppShell } from '../../components/AppShell';
import { HomePanel } from '../HomePanel';

export function AdminPage() {
  return (
    <AppShell>
      <HomePanel
        title="Administración"
        description="Elegí una sección del menú. Las que figuran como «Próximamente» se habilitan en las próximas entregas."
      />
    </AppShell>
  );
}
