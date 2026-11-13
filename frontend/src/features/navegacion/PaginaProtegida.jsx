import React, { lazy } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import ProtectedRoute from '../auth/ProtectedRoute';

const CotizadorPage = lazy(() => import('../cotizador/CotizadorPage'));

// Rutas protegidas de la aplicación. TODAS las atiende la misma página (CotizadorPage):
// cambiar de ruta solo cambia su `routeView`, no la desmonta ni la vuelve a montar.
//   path:  ruta del navegador.
//   vista: vista de la página que le corresponde.
//   admin: exige rol admin (sin sesión siempre se va a /login; un usuario que no es
//          admin en una ruta de admin va a /cotizador).
export const RUTAS_PROTEGIDAS = [
  { path: '/dashboard', vista: 'dashboard', admin: false },
  { path: '/cotizador', vista: 'cotizador', admin: false },
  { path: '/historial', vista: 'historial', admin: false },
  { path: '/ia', vista: 'ia', admin: false },
  { path: '/crm', vista: 'crm', admin: true },
  { path: '/admin/usuarios', vista: 'usuarios', admin: true },
  { path: '/admin/ordenes', vista: 'ordenes', admin: true }
];

// Misma coincidencia que usa el enrutador (sin distinguir mayúsculas ni barra final).
export const rutaProtegidaDe = (pathname) =>
  RUTAS_PROTEGIDAS.find(ruta => matchPath({ path: ruta.path, end: true }, pathname)) || null;

// Ruta contenedora (layout route) de todas las vistas protegidas. Las rutas hijas no
// tienen elemento propio (element={null}): solo sirven para que el enrutador sepa qué rutas existen.
export default function PaginaProtegida() {
  const { pathname } = useLocation();
  const ruta = rutaProtegidaDe(pathname);
  return (
    <ProtectedRoute requireAdmin={!!ruta?.admin}>
      <CotizadorPage routeView={ruta?.vista || 'cotizador'} />
    </ProtectedRoute>
  );
}
