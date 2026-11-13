import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import PaginaProtegida, { RUTAS_PROTEGIDAS } from './features/navegacion/PaginaProtegida';

const LoginPage = lazy(() => import('./features/auth/LoginPage'));

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
        {/* Una sola ruta contenedora: al navegar entre estas rutas la página es la misma
            instancia (no se desmonta), así que no se vuelve a pedir lo que ya tiene. */}
        <Route element={<PaginaProtegida />}>
          {RUTAS_PROTEGIDAS.map(({ path }) => <Route key={path} path={path} element={null} />)}
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
