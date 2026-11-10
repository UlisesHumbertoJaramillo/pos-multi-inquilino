// Guarda de las pantallas autenticadas. Solo decide qué pantalla mostrar: si el usuario no tiene
// permiso, el backend rechaza cada solicitud igual (Const. 15).
import type { Role } from '@pos/contracts';
import { Box, CircularProgress } from '@mui/material';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { homeFor } from '../navigation';

export function RequireAuth({
  roles,
  fiscal = false,
  children,
}: {
  roles?: Role[];
  // Pantalla fiscal: sin el módulo de facturación se vuelve al inicio (RF-165).
  fiscal?: boolean;
  children: ReactNode;
}) {
  const { status, user, requiresRoleSelection } = useAuth();

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress aria-label="Cargando la sesión" />
      </Box>
    );
  }
  if (status === 'anonymous' || !user) return <Navigate to="/login" replace />;
  if (requiresRoleSelection || user.rolActivo === null)
    return <Navigate to="/elegir-rol" replace />;
  if (roles && !roles.includes(user.rolActivo))
    return <Navigate to={homeFor(user.rolActivo)} replace />;
  if (fiscal && !user.moduloFacturacion) return <Navigate to={homeFor(user.rolActivo)} replace />;
  return children;
}
