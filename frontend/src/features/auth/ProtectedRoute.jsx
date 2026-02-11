import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const location = useLocation();
  const token = localStorage.getItem('token');
  const user = getUser();
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';

  if (!token || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/cotizador" replace />;
  }
  return children;
}
