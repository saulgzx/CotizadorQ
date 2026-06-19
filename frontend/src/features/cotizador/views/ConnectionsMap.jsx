import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { sesionesAPI } from '../../../api';
import { formatDateTime } from '../cotizadorHelpers';

const LIGHT_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; OpenStreetMap &copy; CARTO';
const CHILE_CENTER = [-33.45, -70.66];

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Pin SVG inline coloreado por riesgo (rojo = posible uso compartido, azul = normal).
const pinIcon = (risk) => L.divIcon({
  className: '',
  html: `<div style="position:relative;transform:translate(-50%,-100%)">
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 21 13 21s13-11.8 13-21C26 5.8 20.2 0 13 0z" fill="${risk ? '#ef4444' : '#2563eb'}"/>
      <circle cx="13" cy="13" r="5" fill="#fff"/>
    </svg>
    ${risk ? '<span style="position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:9999px;background:#ef4444;border:2px solid #fff;animation:pulse-ring 1.6s ease-out infinite"></span>' : ''}
  </div>`,
  iconSize: [26, 34],
  iconAnchor: [13, 34]
});

export default function ConnectionsMap() {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const markersRef = useRef(null);
  const mountedRef = useRef(true);
  const didFitRef = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const res = await sesionesAPI.getConnections();
      if (mountedRef.current) setData(res);
    } catch (e) {
      if (mountedRef.current) setError(e.message || 'Error cargando el mapa');
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Inicializa el mapa una sola vez.
  useEffect(() => {
    if (mapRef.current || !mapElRef.current) return;
    const isDark = document.documentElement.classList.contains('dark');
    const map = L.map(mapElRef.current, { scrollWheelZoom: false, attributionControl: true }).setView(CHILE_CENTER, 4);
    tileRef.current = L.tileLayer(isDark ? DARK_TILES : LIGHT_TILES, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const invalidateTimer = setTimeout(() => { if (mapRef.current) map.invalidateSize(); }, 50);

    // Cambia el tile al alternar tema.
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains('dark');
      if (tileRef.current) tileRef.current.setUrl(dark ? DARK_TILES : LIGHT_TILES);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      clearTimeout(invalidateTimer);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Pinta los marcadores cuando cambian los datos.
  useEffect(() => {
    const map = mapRef.current;
    const group = markersRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const located = (data?.sessions || []).filter(s => s.lat != null && s.lon != null);
    const bounds = [];
    located.forEach(s => {
      const popup = `
        <div style="min-width:180px;font-size:12px;line-height:1.4">
          <div style="font-weight:700">${escapeHtml(s.nombre || s.usuario)}</div>
          <div style="color:#64748b">${escapeHtml(s.empresa || 'Sin empresa')} · ${escapeHtml(s.role)}</div>
          <div style="margin-top:4px">${escapeHtml(s.city || 'Ciudad desconocida')}, ${escapeHtml(s.country || '')}</div>
          <div style="color:#64748b">${escapeHtml(s.ip_address || '')}${s.isp ? ' · ' + escapeHtml(s.isp) : ''}</div>
          <div style="color:#64748b">Última actividad: ${escapeHtml(formatDateTime(s.last_seen))}</div>
          ${s.shared_risk ? '<div style="margin-top:4px;color:#dc2626;font-weight:600">⚠ Posible uso compartido</div>' : ''}
        </div>`;
      L.marker([s.lat, s.lon], { icon: pinIcon(s.shared_risk) }).bindPopup(popup).addTo(group);
      bounds.push([s.lat, s.lon]);
    });
    // Encuadrar solo en la primera carga con datos; refrescar luego no descarta el
    // pan/zoom manual que el admin haya hecho sobre el mapa.
    if (!didFitRef.current && bounds.length > 0) {
      if (bounds.length === 1) {
        map.setView(bounds[0], 9);
      } else {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
      }
      didFitRef.current = true;
    }
  }, [data]);

  const sessions = data?.sessions || [];
  const located = sessions.filter(s => s.lat != null && s.lon != null);
  const alerts = data?.alerts || [];

  return (
    <div className="glass-card rounded-2xl shadow-[0_20px_40px_-32px_rgba(15,23,42,0.4)] border border-white/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Mapa de conexiones</h2>
          <p className="text-xs text-slate-500">
            Ubicación aproximada por IP · {located.length} de {sessions.length} sesiones localizadas
            {data && data.geo_enabled === false && ' · geolocalización desactivada'}
          </p>
        </div>
        <button
          onClick={() => load()}
          className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800"
        >
          Refrescar
        </button>
      </div>

      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}

      {alerts.length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-3">
          <div className="text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <span>⚠</span> {alerts.length} usuario{alerts.length > 1 ? 's' : ''} con posible uso compartido
          </div>
          <div className="mt-2 space-y-2">
            {alerts.map(a => (
              <div key={a.user_id} className="text-xs text-slate-700 dark:text-slate-300">
                <span className="font-semibold">{a.usuario}</span>
                <ul className="mt-0.5 ml-4 list-disc text-slate-600 dark:text-slate-400">
                  {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 relative">
        {loading && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/60 dark:bg-slate-900/60 rounded-xl text-sm text-slate-500">
            Cargando mapa…
          </div>
        )}
        <div ref={mapElRef} className="h-[420px] w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 z-0" />
      </div>

      {located.length === 0 && !loading && (
        <p className="mt-2 text-xs text-slate-500">
          No hay sesiones localizables todavía. Las IPs locales/privadas (entorno de desarrollo) no se geolocalizan; en producción los pines aparecen tras el próximo login.
        </p>
      )}
    </div>
  );
}
