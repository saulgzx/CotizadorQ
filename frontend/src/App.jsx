import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './features/auth/ProtectedRoute';

const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const DashboardRoute = lazy(() => import('./features/dashboard/DashboardRoute'));
const CotizadorRoute = lazy(() => import('./features/cotizador/CotizadorRoute'));
const HistorialRoute = lazy(() => import('./features/historial/HistorialRoute'));
const UsuariosRoute = lazy(() => import('./features/usuarios/UsuariosRoute'));
const OrdenesRoute = lazy(() => import('./features/ordenes/OrdenesRoute'));

const loadingFallback = (
  <div className="min-h-screen w-full flex items-center justify-center bg-slate-50">
    <div className="text-slate-600 text-sm">Cargando...</div>
  </div>
);

export default function App() {
  return (
    <Suspense fallback={loadingFallback}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={(
            <ProtectedRoute>
              <DashboardRoute />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/cotizador"
          element={(
            <ProtectedRoute>
              <CotizadorRoute />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/historial"
          element={(
            <ProtectedRoute>
              <HistorialRoute />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/usuarios"
          element={(
            <ProtectedRoute requireAdmin>
              <UsuariosRoute />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/ordenes"
          element={(
            <ProtectedRoute requireAdmin>
              <OrdenesRoute />
            </ProtectedRoute>
          )}
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
