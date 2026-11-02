import { createBrowserRouter, Navigate } from 'react-router';
import { AdminPage } from './pages/admin/AdminPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PosPage } from './pages/pos/PosPage';

// Dos áreas: el POS táctil y la Administración de escritorio.
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/pos" replace /> },
  { path: '/pos', element: <PosPage /> },
  { path: '/admin', element: <AdminPage /> },
  { path: '*', element: <NotFoundPage /> },
]);
