// Cache en el navegador para abrir la app sin esperar la red: se muestra lo
// guardado y se refresca en segundo plano. Se limpia al cerrar sesion.

const PREFIJO = 'mq-cache:';

const claveDe = (nombre, usuario) => `${PREFIJO}${nombre}:${String(usuario ?? 'anon')}`;

export const leerCache = (nombre, usuario, maxEdadMs = 24 * 60 * 60 * 1000) => {
  try {
    const raw = localStorage.getItem(claveDe(nombre, usuario));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (!ts || Date.now() - ts > maxEdadMs) return null;
    return data;
  } catch {
    return null;
  }
};

export const guardarCache = (nombre, usuario, data) => {
  try {
    localStorage.setItem(claveDe(nombre, usuario), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Cuota llena o almacenamiento bloqueado: se sigue sin cache.
  }
};

export const limpiarCaches = () => {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIJO))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // sin almacenamiento
  }
};
