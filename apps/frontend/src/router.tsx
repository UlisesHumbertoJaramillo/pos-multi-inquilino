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
