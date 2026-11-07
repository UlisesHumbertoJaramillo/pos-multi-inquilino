// Sucursales que ofrecen los filtros de reportes: todas las del comercio para el AC y las propias
// para el AS. Solo arma el selector: el ámbito real lo verifica el backend.
import { useCallback, useMemo } from 'react';
import { inventoryApi } from '../../api/inventory';
import { organizationApi } from '../../api/organization';
import { useAuth } from '../../auth/AuthContext';
import { useLoader } from '../../hooks/useLoader';

export interface ReportBranch {
  id: string;
  nombre: string;
}

export function useReportBranches(): { branches: ReportBranch[]; error: string | null } {
  const { request, user } = useAuth();
  const isAc = user?.rolActivo === 'AC';
  const organization = useMemo(() => organizationApi(request), [request]);
  const inventory = useMemo(() => inventoryApi(request), [request]);
  const fetchBranches = useCallback(
    async (): Promise<ReportBranch[]> =>
      isAc
        ? (await organization.getStructure()).sucursales.map((s) => ({
            id: s.id,
            nombre: s.nombre,
          }))
        : (await inventory.listBranches())
            .filter((b) => b.propia)
            .map((b) => ({ id: b.id, nombre: b.nombre })),
    [isAc, organization, inventory],
  );
  const loaded = useLoader(fetchBranches, 'No se pudieron cargar las sucursales.');
  return { branches: loaded.data ?? [], error: loaded.error };
}
