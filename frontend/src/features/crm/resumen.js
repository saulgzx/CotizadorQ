// Cálculos del panel del CRM. Funciones puras: reciben lo que devuelve la API.

const ABIERTAS = ['nueva', 'cotizada', 'negociacion'];
const monto = (op) => Number(op?.monto) || 0;

export const esAbierta = (op) => ABIERTAS.includes(op.etapa);

/** Tasa de cierre del mes: ganadas / (ganadas + perdidas). null si no hubo cierres. */
export const tasaCierre = (embudo) => {
  const g = embudo?.ganadas_mes?.cantidad || 0;
  const p = embudo?.perdidas_mes?.cantidad || 0;
  return g + p === 0 ? null : g / (g + p);
};

/** Etapas abiertas del embudo con su proporción respecto de la mayor (para el ancho de barra). */
export const etapasEmbudo = (embudo) => {
  const filas = ABIERTAS.map((clave) => {
    const e = (embudo?.etapas || []).find((x) => x.etapa === clave);
    return { clave, cantidad: e?.cantidad || 0, monto: Number(e?.monto) || 0 };
  });
  const mayor = Math.max(...filas.map((f) => f.monto), 0);
  return filas.map((f) => ({ ...f, razon: mayor > 0 ? f.monto / mayor : 0 }));
};

/** Empresas ordenadas por monto abierto. */
export const empresasPorPipeline = (oportunidades, limite = 6) => {
  const mapa = new Map();
  (oportunidades || []).filter(esAbierta).forEach((op) => {
    const previa = mapa.get(op.empresa_id) || { empresa_id: op.empresa_id, nombre: op.empresa_nombre, monto: 0, cantidad: 0 };
    previa.monto += monto(op);
    previa.cantidad += 1;
    mapa.set(op.empresa_id, previa);
  });
  const lista = [...mapa.values()].sort((a, b) => b.monto - a.monto || b.cantidad - a.cantidad).slice(0, limite);
  const mayor = lista[0]?.monto || 0;
  return lista.map((e) => ({ ...e, razon: mayor > 0 ? e.monto / mayor : 0 }));
};

/** Oportunidades abiertas que llevan más días sin cambiar de etapa. */
export const estancadas = (oportunidades, { minimoDias = 7, limite = 5 } = {}) =>
  (oportunidades || [])
    .filter((op) => esAbierta(op) && (Number(op.dias_en_etapa) || 0) >= minimoDias)
    .sort((a, b) => b.dias_en_etapa - a.dias_en_etapa || monto(b) - monto(a))
    .slice(0, limite);

/** Monto abierto por marca, en orden fijo (el color sigue a la marca, no al ranking). */
export const pipelinePorMarca = (oportunidades) => {
  const orden = ['AXIS', 'QNAP', 'MIXTA'];
  const abiertas = (oportunidades || []).filter(esAbierta);
  const total = abiertas.reduce((s, op) => s + monto(op), 0);
  const filas = orden.map((marca) => {
    const m = abiertas.filter((op) => op.marca === marca).reduce((s, op) => s + monto(op), 0);
    return { marca, monto: m, razon: total > 0 ? m / total : 0 };
  });
  const sinMarca = abiertas.filter((op) => !orden.includes(op.marca)).reduce((s, op) => s + monto(op), 0);
  return { total, filas, sinMarca };
};

// ---- Seguimiento automático ----

export const ESTADOS_SEGUIMIENTO = {
  buscando_envio: { nombre: 'Buscando el correo', tono: 'neutro', grupo: 'curso' },
  esperando: { nombre: 'Esperando respuesta', tono: 'info', grupo: 'curso' },
  borrador_listo: { nombre: 'Borrador por enviar', tono: 'aviso', grupo: 'borrador' },
  respondida: { nombre: 'Cliente respondió', tono: 'ok', grupo: 'respondida' },
  cerrada_sin_respuesta: { nombre: 'Cerrada sin respuesta', tono: 'critico', grupo: 'cerrada' },
  pausada: { nombre: 'Pausada', tono: 'neutro', grupo: 'detenida' },
  sin_envio: { nombre: 'Sin correo encontrado', tono: 'aviso', grupo: 'detenida' }
};

export const GRUPOS_SEGUIMIENTO = [
  { clave: 'curso', nombre: 'En curso' },
  { clave: 'borrador', nombre: 'Borradores por enviar' },
  { clave: 'respondida', nombre: 'Respondieron' },
  { clave: 'detenida', nombre: 'Pausadas o sin correo' },
  { clave: 'cerrada', nombre: 'Cerradas' }
];

const ACCIONES = {
  buscar_envio: 'Buscar el correo enviado',
  marcar_sin_envio: 'Marcar como sin correo',
  crear_borrador_1: 'Redactar 1er seguimiento',
  crear_borrador_2: 'Redactar 2º seguimiento',
  esperar_envio_borrador: 'Esperando que envíes el borrador',
  cerrar: 'Cerrar sin respuesta',
  detener: 'Detener el seguimiento'
};

export const nombreAccion = (accion) => ACCIONES[accion] || accion || '—';
export const estadoSeguimiento = (clave) => ESTADOS_SEGUIMIENTO[clave] || { nombre: clave, tono: 'neutro', grupo: 'curso' };

export const conteoSeguimiento = (items) => {
  const conteo = Object.fromEntries(GRUPOS_SEGUIMIENTO.map((g) => [g.clave, 0]));
  (items || []).forEach((s) => { conteo[estadoSeguimiento(s.estado).grupo] += 1; });
  return conteo;
};

/** Los cuatro hitos de la cadencia y cuáles ya ocurrieron. */
export const hitosSeguimiento = (s) => [
  { nombre: 'Cotización enviada', hecho: !!s.enviado_en },
  { nombre: '1er seguimiento', hecho: s.paso >= 1 },
  { nombre: '2º seguimiento', hecho: s.paso >= 2 },
  s.estado === 'respondida'
    ? { nombre: 'Respondió', hecho: true, final: 'ok' }
    : { nombre: 'Cierre', hecho: s.estado === 'cerrada_sin_respuesta', final: 'critico' }
];

/** "hoy", "mañana", "en 3 días", "hace 2 días" respecto de ahora. */
export const cuando = (iso, ahora = new Date()) => {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const dia = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const dias = Math.round((dia(fecha) - dia(ahora)) / 86400000);
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  if (dias === -1) return 'ayer';
  return dias > 0 ? `en ${dias} días` : `hace ${-dias} días`;
};

export const puedePausar = (s) => ['buscando_envio', 'esperando', 'borrador_listo'].includes(s.estado);
export const puedeReanudar = (s) => ['pausada', 'sin_envio'].includes(s.estado);
