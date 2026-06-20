import React, { useState } from 'react';
import { sesionesAPI } from '../../../api';

// Gate de acceso: exige conceder la ubicación GPS del navegador para usar el cotizador.
// La cuenta de administrador supremo queda exenta (se filtra antes de montar este componente).
export default function LocationGate({ user, onGranted, onLogout }) {
  const [status, setStatus] = useState('idle'); // idle | requesting | error
  const [errMsg, setErrMsg] = useState('');

  const request = () => {
    setErrMsg('');
    if (!('geolocation' in navigator)) {
      setStatus('error');
      setErrMsg('Tu navegador no soporta geolocalización.');
      return;
    }
    setStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await sesionesAPI.setLocation({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        } catch {
          // Si falla el registro en el servidor, igual dejamos pasar: el consentimiento se dio
          // y la ubicación se reintenta en el próximo refresco del mapa.
        }
        onGranted();
      },
      (err) => {
        setStatus('error');
        if (err.code === 1) {
          setErrMsg('Bloqueaste el permiso de ubicación. Habilitalo en el ícono de candado de la barra del navegador y reintentá.');
        } else if (err.code === 3) {
          setErrMsg('Se agotó el tiempo para obtener tu ubicación. Reintentá.');
        } else {
          setErrMsg('No se pudo obtener tu ubicación. Verificá que la ubicación del dispositivo esté activada y reintentá.');
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  return (
    <div className="min-h-screen app-bg flex items-center justify-center p-4">
      <div className="view-enter glass-card w-full max-w-md rounded-2xl border border-white/70 dark:border-white/10 p-6 text-center shadow-[0_30px_80px_-40px_rgba(15,23,42,0.9)]">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-700 text-white flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7" aria-hidden="true">
            <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Ubicación requerida</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Para usar el cotizador necesitamos registrar tu ubicación. Al continuar, aceptás compartir la ubicación de tu dispositivo durante el uso del sistema.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {user?.nombre || user?.usuario}{user?.empresa ? ` · ${user.empresa}` : ''}
        </p>

        {status === 'error' && (
          <div className="mt-3 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
            {errMsg}
          </div>
        )}

        <button
          onClick={request}
          disabled={status === 'requesting'}
          className="mt-5 w-full px-4 py-2.5 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-60 transition"
        >
          {status === 'requesting' ? 'Obteniendo ubicación…' : (status === 'error' ? 'Reintentar' : 'Aceptar y compartir ubicación')}
        </button>
        <button
          onClick={onLogout}
          className="mt-2 w-full px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 text-sm"
        >
          Salir
        </button>
      </div>
    </div>
  );
}
