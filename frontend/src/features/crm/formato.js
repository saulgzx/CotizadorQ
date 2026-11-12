const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const usd = (valor) => USD.format(Number(valor) || 0);

export const fechaCL = (valor) => {
  if (!valor) return '—';
  const texto = String(valor);
  // Las fechas "solo día" (YYYY-MM-DD) se leen como locales para no correrse un día.
  const solo = /^\d{4}-\d{2}-\d{2}$/.test(texto);
  const fecha = solo ? new Date(`${texto}T12:00:00`) : new Date(texto);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-CL');
};

export const porcentaje = (razon) => (razon === null || razon === undefined ? '—' : `${Math.round(razon * 100)}%`);

export const ETAPAS = [
  { clave: 'nueva', nombre: 'Nueva', punto: 'bg-slate-400' },
  { clave: 'cotizada', nombre: 'Cotizada', punto: 'bg-blue-500' },
  { clave: 'negociacion', nombre: 'Negociación', punto: 'bg-amber-500' },
  { clave: 'ganada', nombre: 'Ganada', punto: 'bg-emerald-500' },
  { clave: 'perdida', nombre: 'Perdida', punto: 'bg-rose-500' }
];

export const nombreEtapa = (clave) => ETAPAS.find((e) => e.clave === clave)?.nombre || clave;

export const MARCAS = ['AXIS', 'QNAP', 'MIXTA'];

export const diasTexto = (dias) => {
  const n = Number(dias) || 0;
  return n === 0 ? 'hoy' : n === 1 ? '1 día' : `${n} días`;
};

export const mensajeError = (error, porDefecto = 'No se pudo completar la acción') =>
  (error && error.message) || porDefecto;
