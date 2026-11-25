// Cambios del OOR (reporte de órdenes abiertas de Axis): formato y utilidades PURAS para el
// pop-up de cambios, su historial y el resumen en texto. El servidor ya detecta y cruza los
// cambios con las BO; aquí solo se presentan. Todo es tolerante a datos incompletos.

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];
const MESES_ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const MENOS = '−';

// 'YYYY-MM' (o 'YYYY-MM-DD') -> { anio, mes } o null.
const partesMes = (valor) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(valor ?? ''));
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return { anio: Number(m[1]), mes };
};

export const mesLargo = (valor) => {
  const p = partesMes(valor);
  return p ? `${MESES[p.mes - 1]} de ${p.anio}` : '';
};

// Sin año si es el del año de referencia ('2026-06' con 2026 -> 'junio').
export const mesCorto = (valor, anioDeReferencia) => {
  const p = partesMes(valor);
  if (!p) return '';
  if (anioDeReferencia != null && Number(anioDeReferencia) === p.anio) return MESES[p.mes - 1];
  return `${MESES[p.mes - 1]} de ${p.anio}`;
};

// '2026-06-10' -> '10-jun-2026'.
export const fechaCorta = (valor) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? ''));
  if (!m) return '';
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return '';
  return `${m[3]}-${MESES_ABREV[mes - 1]}-${m[1]}`;
};

const dosDigitos = (n) => String(n).padStart(2, '0');

const fechaDeIso = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ISO 8601 -> '25-11-2026'.
export const fechaNumerica = (iso) => {
  const d = fechaDeIso(iso);
  return d ? `${dosDigitos(d.getDate())}-${dosDigitos(d.getMonth() + 1)}-${d.getFullYear()}` : '';
};

// ISO 8601 -> '25-nov-2026 14:05'.
export const fechaHora = (iso) => {
  const d = fechaDeIso(iso);
  if (!d) return '';
  return `${dosDigitos(d.getDate())}-${MESES_ABREV[d.getMonth()]}-${d.getFullYear()} ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
};

export const titularDeBo = (grupo) => {
  const antes = grupo?.mes?.antes || null;
  const ahora = grupo?.mes?.ahora || null;
  if (!partesMes(ahora)) return 'Sin fecha de entrega';
  if (!partesMes(antes)) return `Ahora en ${mesLargo(ahora)}`;
  if (antes === ahora) return `Sigue en ${mesLargo(ahora)}`;
  return `De ${mesCorto(antes, partesMes(ahora).anio)} a ${mesLargo(ahora)}`;
};

export const textoDias = (dias) => {
  const n = Number(dias);
  if (dias === null || dias === undefined || !Number.isFinite(n) || n === 0) return '';
  const abs = Math.abs(n);
  return `${n > 0 ? '+' : MENOS}${abs} ${abs === 1 ? 'día' : 'días'}`;
};

export const textoFacturacion = (facturacion) => {
  const mes = facturacion?.mes;
  if (!partesMes(mes)) return 'Sin mes de facturación configurado';
  const semana = facturacion?.semana;
  const conSemana = semana !== null && semana !== undefined && String(semana).trim() !== '';
  return `Facturación configurada: ${mesLargo(mes)}${conSemana ? `, semana ${semana}` : ''}`;
};

export const NOMBRE_TIPO = {
  atraso: 'Atraso',
  adelanto: 'Adelanto',
  sin_fecha: 'Quedó sin fecha',
  fecha_nueva: 'Ahora tiene fecha',
  cerrada: 'Facturada o cerrada',
  cantidad: 'Cambió la cantidad',
  nueva: 'Línea nueva',
  desaparecida: 'Ya no viene en el OOR'
};

export const TONO_TIPO = {
  atraso: 'critico',
  sin_fecha: 'critico',
  adelanto: 'ok',
  cerrada: 'ok',
  cantidad: 'aviso',
  desaparecida: 'aviso',
  nueva: 'info',
  fecha_nueva: 'info'
};

const lista = (valor) => (Array.isArray(valor) ? valor : []);
const gruposDe = (datos) => lista(datos?.grupos);

const esAtrasoDeLinea = (l) => l?.tipo === 'atraso' || l?.tipo === 'sin_fecha';
const tieneAtraso = (g) => lista(g?.lineas).some(esAtrasoDeLinea);
const afectaFacturacion = (g) => g?.facturacion?.afectada === true;

export const FILTROS = ['', 'facturacion', 'atraso', 'otros'];

export const filtrarGrupos = (datos, filtro = '') => {
  const grupos = gruposDe(datos);
  switch (filtro) {
    case 'facturacion':
      return grupos.filter(afectaFacturacion);
    case 'atraso':
      return grupos.filter(tieneAtraso);
    case 'otros':
      return grupos.filter((g) => !afectaFacturacion(g) && !tieneAtraso(g));
    default:
      return grupos;
  }
};

export const conteosDeFiltros = (datos) => ({
  todo: filtrarGrupos(datos, '').length,
  facturacion: filtrarGrupos(datos, 'facturacion').length,
  atraso: filtrarGrupos(datos, 'atraso').length,
  otros: filtrarGrupos(datos, 'otros').length
});

const numeroOCero = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Conteos del encabezado, con respaldo calculado de los grupos si el resumen no los trae.
export const indicadoresDe = (datos) => {
  const r = datos?.resumen || {};
  const grupos = gruposDe(datos);
  const lineasSinBo = lista(datos?.sinBo).reduce((s, p) => s + lista(p?.lineas).length, 0);
  return {
    bos: r.bos ?? grupos.length,
    bosAtrasadas: r.bosAtrasadas ?? grupos.filter(tieneAtraso).length,
    bosConFacturacionAfectada: r.bosConFacturacionAfectada ?? grupos.filter(afectaFacturacion).length,
    atraso: numeroOCero(r.atraso),
    adelanto: numeroOCero(r.adelanto),
    nueva: numeroOCero(r.nueva),
    cerrada: numeroOCero(r.cerrada),
    lineasSinBo: r.lineasSinBo ?? lineasSinBo
  };
};

// Cantidad de una línea con cambio: '10 → 4' o solo la cantidad.
export const textoCantidad = (item) => {
  const ahora = item?.linea?.cantidad;
  const antes = item?.cantidadAntes ?? item?.antes?.cantidad;
  const hay = (v) => v !== null && v !== undefined && v !== '';
  if (hay(antes) && hay(ahora) && String(antes) !== String(ahora)) return `${antes} → ${ahora}`;
  return hay(ahora) ? String(ahora) : hay(antes) ? String(antes) : '';
};

// Despacho de una línea con cambio: 'antes → ahora' (solo una fecha si es nueva o desaparecida).
export const textoDespacho = (item) => {
  const ahora = item?.linea?.despacho || null;
  const antes = item?.antes?.despacho || null;
  if (item?.tipo === 'nueva' || item?.tipo === 'desaparecida') return fechaCorta(ahora || antes) || 'Sin fecha';
  if (!item?.antes) return fechaCorta(ahora) || 'Sin fecha';
  if (antes === ahora) return fechaCorta(ahora) || 'Sin fecha';
  return `${fechaCorta(antes) || 'Sin fecha'} → ${fechaCorta(ahora) || 'Sin fecha'}`;
};

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

const lineaEnTexto = (item) => {
  const l = item?.linea || {};
  const cant = l.cantidad !== null && l.cantidad !== undefined && l.cantidad !== '' ? ` x${l.cantidad}` : '';
  const nombre = [l.parte, l.descripcion].filter(Boolean).join(' ') || l.clave || 'Línea';
  const dias = textoDias(item?.dias);
  const conDias = dias ? ` (${dias})` : '';
  const ahora = fechaCorta(l.despacho);
  const antes = fechaCorta(item?.antes?.despacho);
  let detalle;
  switch (item?.tipo) {
    case 'atraso':
    case 'adelanto':
      detalle = `${antes || 'sin fecha'} → ${ahora || 'sin fecha'}${conDias}`;
      break;
    case 'sin_fecha':
      detalle = `${antes || 'sin fecha'} → sin fecha`;
      break;
    case 'fecha_nueva':
      detalle = `sin fecha → ${ahora || 'sin fecha'}`;
      break;
    case 'cantidad':
      detalle = `cantidad ${textoCantidad(item)}`;
      break;
    case 'nueva':
      detalle = `línea nueva${ahora ? `, despacho ${ahora}` : ''}`;
      break;
    case 'desaparecida':
      detalle = 'ya no viene en el OOR';
      break;
    case 'cerrada':
      detalle = 'facturada o cerrada';
      break;
    default:
      detalle = NOMBRE_TIPO[item?.tipo] || 'cambio';
  }
  return `- ${nombre}${cant}: ${detalle}`;
};

const sufijoFacturacion = (afectada) => {
  if (afectada === true) return ' — queda antes de la nueva llegada';
  if (afectada === false) return ' — sigue calzando';
  return '';
};

// Texto plano para pegar en un correo o WhatsApp, una BO por bloque.
export const resumenEnTexto = (datos) => {
  const ind = indicadoresDe(datos);
  const fecha = fechaNumerica(datos?.hasta?.tomado_en);
  const partes = [plural(ind.bos, 'BO con cambios', 'BO con cambios')];
  if (ind.bosAtrasadas > 0) partes.push(plural(ind.bosAtrasadas, 'atrasada', 'atrasadas'));
  if (ind.bosConFacturacionAfectada > 0) partes.push(`${ind.bosConFacturacionAfectada} con facturación afectada`);

  const bloques = [`Cambios del OOR${fecha ? ` (${fecha})` : ''}\n${partes.join(' · ')}`];

  gruposDe(datos).forEach((g) => {
    const cab = [`BO ${g?.bo ?? ''}`, g?.cliente, g?.proyecto].filter(Boolean);
    let primera = cab.length > 1 ? `${cab[0]} · ${cab.slice(1).join(' · ')}` : cab[0];
    if (g?.poAxis) primera += ` (PO Axis ${g.poAxis})`;
    const dias = textoDias(g?.dias);
    const eta = fechaCorta(g?.eta?.ahora);
    let segunda = titularDeBo(g);
    if (dias) segunda += ` (${dias})`;
    if (eta) segunda += `. Llegada estimada: ${eta}`;
    const filas = [primera, segunda];
    filas.push(`${textoFacturacion(g?.facturacion)}${g?.facturacion?.mes ? sufijoFacturacion(g.facturacion.afectada) : ''}`);
    lista(g?.lineas).forEach((l) => filas.push(lineaEnTexto(l)));
    bloques.push(filas.join('\n'));
  });

  const sinBo = lista(datos?.sinBo).filter((p) => lista(p?.lineas).length > 0);
  if (sinBo.length) {
    const filas = ['Cambios de PO sin BO asociada'];
    sinBo.forEach((p) => {
      filas.push(`PO Axis ${p?.po ?? ''}`);
      lista(p.lineas).forEach((l) => filas.push(lineaEnTexto(l)));
    });
    bloques.push(filas.join('\n'));
  }

  return bloques.join('\n\n');
};
