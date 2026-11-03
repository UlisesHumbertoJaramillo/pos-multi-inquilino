import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { useAuth } from './auth/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { homeFor } from './navigation';
import { AdminPage } from './pages/admin/AdminPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PosPage } from './pages/pos/PosPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { RoleSelectPage } from './pages/RoleSelectPage';
import { ValidateEmailPage } from './pages/ValidateEmailPage';
import { ActivateAccountPage } from './pages/ActivateAccountPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { CombosPage } from './pages/catalog/CombosPage';
import { PriceListPrintPage } from './pages/catalog/PriceListPrintPage';
import { PriceListsPage } from './pages/catalog/PriceListsPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { TransfersPage } from './pages/inventory/TransfersPage';
import { PurchasesPage } from './pages/suppliers/PurchasesPage';
import { ReceptionsPage } from './pages/suppliers/ReceptionsPage';
import { SuppliersPage } from './pages/suppliers/SuppliersPage';
import { SettingsPage } from './pages/organization/SettingsPage';
import { StructurePage } from './pages/organization/StructurePage';
import { UsersPage } from './pages/organization/UsersPage';
import { AccountsPage } from './pages/platform/AccountsPage';
import { PanelPage } from './pages/platform/PanelPage';
import { TechnicalAuditPage } from './pages/platform/TechnicalAuditPage';
import { TenantsPage } from './pages/platform/TenantsPage';
import { TicketsPage } from './pages/platform/TicketsPage';

// Pantallas del Super Administrador.
const saOnly = (element: React.ReactElement) => <RequireAuth roles={['SA']}>{element}</RequireAuth>;
// Pantallas del Administrador de Comercio.
const acOnly = (element: React.ReactElement) => <RequireAuth roles={['AC']}>{element}</RequireAuth>;
// Pantallas del Administrador de Sucursal.
const asOnly = (element: React.ReactElement) => <RequireAuth roles={['AS']}>{element}</RequireAuth>;

// La raíz lleva a la pantalla del rol activo, o al inicio de sesión.
function Home() {
  const { user } = useAuth();
  return (
    <RequireAuth>
      <Navigate to={homeFor(user?.rolActivo ?? null)} replace />
    </RequireAuth>
  );
}

// Dos áreas autenticadas, el POS táctil y la Administración, y las pantallas de acceso.
export const routes: RouteObject[] = [
  { path: '/', element: <Home /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/elegir-rol', element: <RoleSelectPage /> },
  { path: '/validar-correo', element: <ValidateEmailPage /> },
  { path: '/recuperar-contrasena', element: <ForgotPasswordPage /> },
  { path: '/restablecer-contrasena', element: <ResetPasswordPage /> },
  { path: '/activar-cuenta', element: <ActivateAccountPage /> },
  { path: '/admin/comercios', element: saOnly(<TenantsPage />) },
  { path: '/admin/cuentas', element: saOnly(<AccountsPage />) },
  { path: '/admin/soporte', element: saOnly(<TicketsPage />) },
  { path: '/admin/auditoria-tecnica', element: saOnly(<TechnicalAuditPage />) },
  { path: '/admin/panel', element: saOnly(<PanelPage />) },
  { path: '/admin/estructura', element: acOnly(<StructurePage />) },
  { path: '/admin/usuarios', element: acOnly(<UsersPage />) },
  { path: '/admin/parametros', element: acOnly(<SettingsPage />) },
  { path: '/admin/catalogo', element: acOnly(<CatalogPage />) },
  { path: '/admin/combos', element: acOnly(<CombosPage />) },
  { path: '/admin/listas', element: acOnly(<PriceListsPage />) },
  { path: '/admin/listas/:id/imprimir', element: acOnly(<PriceListPrintPage />) },
  { path: '/admin/proveedores', element: acOnly(<SuppliersPage />) },
  { path: '/admin/compras', element: acOnly(<PurchasesPage />) },
  { path: '/admin/recepciones', element: asOnly(<ReceptionsPage />) },
  { path: '/admin/inventario', element: asOnly(<InventoryPage />) },
  { path: '/admin/transferencias', element: asOnly(<TransfersPage />) },
  {
    path: '/pos',
    element: (
      <RequireAuth roles={['VO']}>
        <PosPage />
      </RequireAuth>
    ),
  },
  {
    path: '/admin',
    element: (
      <RequireAuth roles={['SA', 'AC', 'AS']}>
        <AdminPage />
      </RequireAuth>
    ),
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
