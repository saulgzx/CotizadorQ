/**
 * OOR (Open Order Report de Axis): lectura, comparacion entre dos versiones y cruce con las BO.
 *
 * El dueno reemplaza la pestana OOR de la planilla maestra cada ~2 dias. Axis suele mover las
 * fechas de entrega, y eso descuadra lo que el ya configuro en cada BO de OSO (mes y semana de
 * facturacion). Este modulo es PURO (sin red ni base): recibe filas y devuelve que cambio.
 *
 * Identidad de una linea: Order No + Line No + Del No (asi viene el reporte de Axis). El cruce
 * con OSO no esta en la planilla: es el "PO Axis" que el dueno asocia a cada BO en la app
 * (bo_meta.po_axis), que corresponde a "Customer PO No" del OOR.
 *
 * Fechas: en la planilla conviven celdas que son fecha real (llegan como numero de serie) y
 * celdas de TEXTO en dia-mes-ano con o sin ceros ("10-12-2026", "5-6-2026"). Una columna usa
 * mes/dia/ano con barras ("11/23/2026"). parsearFecha resuelve todo eso; `new Date(texto)` no
 * sirve porque lee "10-12-2026" como 12 de octubre.
 */
const crypto = require('crypto');

/** Dias entre el despacho planificado por Axis y la llegada estimada a Chile (misma regla de Ordenes). */
const DIAS_A_ETA = 15;

const DIA_MS = 24 * 60 * 60 * 1000;
const dos = (n) => String(n).padStart(2, '0');

const isoDe = (anio, mes, dia) => {
  const t = Date.UTC(anio, mes - 1, dia);
  const d = new Date(t);
  // 31-02-2026 no existe: Date lo correria a marzo.
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${anio}-${dos(mes)}-${dos(dia)}`;
};

/**
 * Valor de una celda de fecha -> 'YYYY-MM-DD', o null si no es una fecha.
 * - numero: numero de serie de Sheets/Excel (dias desde 1899-12-30); se ignora la hora.
 * - 'YYYY-MM-DD' (con o sin hora detras).
 * - 'a-b-yyyy' o 'a/b/yyyy' (o con puntos): si una parte es mayor que 12 no hay duda; si las dos
 *   son <= 12, el guion y el punto son dia-mes (como escribe la planilla) y la barra es mes/dia
 *   (como viene la unica columna con barras). Ano de 2 digitos = 20xx.
 */
const parsearFecha = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 20000 || valor > 80000) return null; // 1954..2119
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(valor) * DIA_MS);
    return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
  }
  const texto = String(valor).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(texto);
  if (m) return isoDe(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})(?:\s.*)?$/.exec(texto);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[3]);
  const anio = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
  let diaPrimero = m[2] !== '/';
  if (a > 12) diaPrimero = true;
  else if (b > 12) diaPrimero = false;
  return diaPrimero ? isoDe(anio, b, a) : isoDe(anio, a, b);
};

const sumarDias = (iso, dias) => {
  if (!iso) return null;
  const [anio, mes, dia] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia) + dias * DIA_MS);
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
};

/** Dias de `desde` a `hasta` (positivo = se atraso). null si falta alguna. */
const diasEntre = (desde, hasta) => {
  if (!desde || !hasta) return null;
  const t = (iso) => Date.UTC(...iso.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((t(hasta) - t(desde)) / DIA_MS);
};

/** 'YYYY-MM-DD' -> 'YYYY-MM'. */
const mesDe = (iso) => (iso ? iso.slice(0, 7) : null);

// ------------------------------------------------------------------ lectura de la pestana

const COLUMNAS = Object.freeze({
  orden: ['Order No'],
  linea: ['Line No'],
  entrega: ['Del No'],
  po: ['Customer PO No'],
  estado: ['Status'],
  estadoOrden: ['Order Status'],
  parte: ['Sales Part', 'Sales Part No', 'Part No'],
  descripcion: ['Sales Part Description', 'Description', 'Product Description'],
  cantidad: ['Sales Qty'],
  despacho: ['Planned Ship Date'],
  entregaPlan: ['Planned Delivery Date'],
  proyecto: ['Project Description']
});

const limpio = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const claveCabecera = (v) => limpio(v).toLowerCase();

const indiceDe = (cabecera, nombres) => {
  const claves = cabecera.map(claveCabecera);
  for (const nombre of nombres) {
    const i = claves.indexOf(claveCabecera(nombre));
    if (i !== -1) return i;
  }
  return -1;
};

/** "60", 60, "3311,2", "1.796,35" -> numero; vacio o basura -> null. */
const numeroDe = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = limpio(v).replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Identificadores que Sheets puede entregar como numero (575740) o como texto ("575740 "). */
const idDe = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v) === v ? Math.trunc(v) : v);
  return limpio(v);
};

/** Una linea facturada, cerrada o cancelada ya no esta pendiente de entrega. */
const esCerrada = (estado) => /invoiced|closed|cancel/i.test(String(estado || ''));

/**
 * Filas crudas de la pestana (la primera es la cabecera) -> { lineas, avisos }.
 * Cada linea: { clave, orden, linea, entrega, po, parte, descripcion, cantidad, estado,
 *   estadoOrden, despacho, entregaPlan, proyecto, cerrada }.
 * Se saltan las filas sin numero de orden (en blanco, totales). Sin la columna "Order No" no hay
 * como identificar nada: devuelve lineas vacias y un aviso, nunca una comparacion a medias.
 */
const leerOor = (filas) => {
  const avisos = [];
  const todas = Array.isArray(filas) ? filas : [];
  const cabecera = Array.isArray(todas[0]) ? todas[0] : [];
  const idx = Object.fromEntries(Object.entries(COLUMNAS).map(([campo, nombres]) => [campo, indiceDe(cabecera, nombres)]));
  if (idx.orden === -1) {
    if (todas.length > 0) avisos.push('La pestaña OOR no trae la columna "Order No": no se puede comparar.');
    return { lineas: [], avisos };
  }
  if (idx.despacho === -1 && idx.entregaPlan === -1) {
    avisos.push('La pestaña OOR no trae "Planned Ship Date" ni "Planned Delivery Date": no hay fechas que comparar.');
  }
  if (idx.po === -1) avisos.push('La pestaña OOR no trae "Customer PO No": no se puede cruzar con las BO.');
  if (idx.linea === -1) avisos.push('La pestaña OOR no trae "Line No": las líneas se identifican por orden y parte.');

  const celda = (fila, campo) => (idx[campo] === -1 ? '' : fila[idx[campo]]);
  const vistas = new Map();
  const lineas = [];
  let fechasIlegibles = 0;
  for (let i = 1; i < todas.length; i += 1) {
    const fila = Array.isArray(todas[i]) ? todas[i] : [];
    const orden = idDe(celda(fila, 'orden'));
    if (!orden) continue;
    const parte = limpio(celda(fila, 'parte'));
    const linea = idDe(celda(fila, 'linea'));
    const entrega = idDe(celda(fila, 'entrega'));
    // Sin "Line No" la linea se identifica por la parte; la repeticion se numera en orden de aparicion.
    const base = linea ? `${orden}|${linea}|${entrega || '1'}` : `${orden}|parte:${parte.toLowerCase()}`;
    const veces = (vistas.get(base) || 0) + 1;
    vistas.set(base, veces);
    const crudoDespacho = celda(fila, 'despacho');
    const crudoEntrega = celda(fila, 'entregaPlan');
    const despacho = parsearFecha(crudoDespacho);
    const entregaPlan = parsearFecha(crudoEntrega);
    if ((limpio(crudoDespacho) && !despacho) || (limpio(crudoEntrega) && !entregaPlan)) fechasIlegibles += 1;
    const estado = limpio(celda(fila, 'estado'));
    const estadoOrden = limpio(celda(fila, 'estadoOrden'));
    lineas.push({
      clave: veces === 1 ? base : `${base}#${veces}`,
      orden,
      linea,
      entrega,
      po: idDe(celda(fila, 'po')),
      parte,
      descripcion: limpio(celda(fila, 'descripcion')),
      cantidad: numeroDe(celda(fila, 'cantidad')),
      estado,
      estadoOrden,
      despacho,
      entregaPlan,
      proyecto: limpio(celda(fila, 'proyecto')),
      cerrada: esCerrada(estado || estadoOrden)
    });
  }
  const repetidas = [...vistas.values()].filter((n) => n > 1).length;
  if (repetidas > 0) avisos.push(`${repetidas} líneas del OOR repiten la misma orden y línea; se compararon en el orden en que aparecen.`);
  if (fechasIlegibles > 0) avisos.push(`${fechasIlegibles} líneas del OOR traen una fecha que no se pudo leer.`);
  return { lineas, avisos };
};

/**
 * Huella del contenido que importa (identidad, PO, parte, cantidad, estado y fechas), sin
 * depender del orden de las filas. Dos lecturas con la misma huella no tienen nada que comparar.
 */
const huella = (lineas) => {
  const filas = (Array.isArray(lineas) ? lineas : [])
    .map((l) => [l.clave, l.po, l.parte, l.cantidad, l.estado, l.estadoOrden, l.despacho, l.entregaPlan].map((v) => v ?? '').join('\u001f'))
    .sort();
  return crypto.createHash('sha256').update(filas.join('\n')).digest('hex');
};

// ------------------------------------------------------------------ comparacion

/** La fecha que manda es el despacho planificado (la que usa Ordenes para la ETA); si falta, la entrega. */
const fechaDe = (l) => l?.despacho || l?.entregaPlan || null;

const resumenLinea = (l) => ({
  clave: l.clave,
  orden: l.orden,
  linea: l.linea,
  po: l.po,
  parte: l.parte,
  descripcion: l.descripcion,
  cantidad: l.cantidad,
  estado: l.estado || l.estadoOrden,
  despacho: l.despacho,
  entregaPlan: l.entregaPlan,
  eta: sumarDias(l.despacho || l.entregaPlan, DIAS_A_ETA)
});

/**
 * Compara dos lecturas del OOR. Devuelve una lista de cambios, uno por linea afectada:
 *   { tipo, linea (como quedo), antes (como estaba, o null), dias, cantidadAntes }
 * tipo:
 *   'atraso' | 'adelanto'  la fecha se movio (dias > 0 atraso, < 0 adelanto)
 *   'sin_fecha'            tenia fecha y ahora no
 *   'fecha_nueva'          no tenia fecha y ahora si
 *   'cerrada'              paso a facturada/cerrada/cancelada (ya no esta pendiente)
 *   'cantidad'             solo cambio la cantidad
 *   'nueva'                linea que no estaba (y esta abierta)
 *   'desaparecida'         linea abierta que ya no viene en el reporte
 * Una linea cuya fecha Y cantidad cambiaron sale una vez, con el tipo de la fecha y `cantidadAntes`.
 * Los cambios en lineas que ya estaban cerradas no se informan: son ruido.
 */
const comparar = (antes, ahora) => {
  const previas = new Map((Array.isArray(antes) ? antes : []).map((l) => [l.clave, l]));
  const actuales = new Map((Array.isArray(ahora) ? ahora : []).map((l) => [l.clave, l]));
  const cambios = [];

  for (const [clave, nueva] of actuales) {
    const vieja = previas.get(clave);
    if (!vieja) {
      if (!nueva.cerrada) cambios.push({ tipo: 'nueva', linea: resumenLinea(nueva), antes: null, dias: null, cantidadAntes: null });
      continue;
    }
    if (vieja.cerrada) continue;
    const cantidadCambio = vieja.cantidad !== nueva.cantidad;
    const cantidadAntes = cantidadCambio ? vieja.cantidad : null;
    if (nueva.cerrada) {
      cambios.push({ tipo: 'cerrada', linea: resumenLinea(nueva), antes: resumenLinea(vieja), dias: null, cantidadAntes });
      continue;
    }
    const fAntes = fechaDe(vieja);
    const fAhora = fechaDe(nueva);
    let tipo = null;
    let dias = null;
    if (fAntes && fAhora) {
      // Se comparan fechas del mismo tipo: despacho con despacho, o entrega con entrega.
      const mismaBase = vieja.despacho && nueva.despacho ? ['despacho', 'despacho'] : ['entregaPlan', 'entregaPlan'];
      const a = vieja[mismaBase[0]] || fAntes;
      const b = nueva[mismaBase[1]] || fAhora;
      dias = diasEntre(a, b);
      // Mismo despacho pero otra fecha de entrega: tambien es un movimiento de Axis.
      if (dias === 0 && vieja.entregaPlan && nueva.entregaPlan) dias = diasEntre(vieja.entregaPlan, nueva.entregaPlan);
      if (dias > 0) tipo = 'atraso';
      else if (dias < 0) tipo = 'adelanto';
    } else if (fAntes && !fAhora) tipo = 'sin_fecha';
    else if (!fAntes && fAhora) tipo = 'fecha_nueva';
    if (!tipo && cantidadCambio) tipo = 'cantidad';
    if (tipo) cambios.push({ tipo, linea: resumenLinea(nueva), antes: resumenLinea(vieja), dias: tipo === 'atraso' || tipo === 'adelanto' ? dias : null, cantidadAntes });
  }

  for (const [clave, vieja] of previas) {
    if (actuales.has(clave) || vieja.cerrada) continue;
    cambios.push({ tipo: 'desaparecida', linea: resumenLinea(vieja), antes: resumenLinea(vieja), dias: null, cantidadAntes: null });
  }
  return cambios;
};

// ------------------------------------------------------------------ cruce con las BO

const TIPOS = Object.freeze(['atraso', 'adelanto', 'sin_fecha', 'fecha_nueva', 'cerrada', 'cantidad', 'nueva', 'desaparecida']);

/** "575740", "575740 / 577655", "575740, 577655" -> ['575740', '577655'] (un BO puede llevar varias PO). */
const posDe = (poAxis) =>
  [...new Set(String(poAxis ?? '').split(/[\s,;/|]+/).map((p) => p.trim()).filter(Boolean))];

const ultimaFecha = (lineas) => lineas.reduce((max, l) => { const f = fechaDe(l); return f && (!max || f > max) ? f : max; }, null);

const ORDEN_TIPO = Object.fromEntries(TIPOS.map((t, i) => [t, i]));

/**
 * Agrupa los cambios por BO usando el PO Axis de cada BO.
 * - cambios: salida de comparar().
 * - antes, ahora: las dos lecturas completas (para saber cuando termina de llegar cada BO).
 * - bos: [{ bo, po_axis, customer_name, project_name, estimated_invoice_month, estimated_invoice_week,
 *           customer_po }] de las BO vigentes (no eliminadas ni facturadas).
 *
 * Por cada BO con cambios:
 *   ultimoDespacho { antes, ahora }: la fecha mas tardia entre TODAS sus lineas abiertas del OOR
 *     (la BO se completa cuando llega la ultima), y `eta` = esa fecha + 15 dias.
 *   dias: cuanto se movio esa fecha (positivo = se atraso). mes { antes, ahora } de la ETA.
 *   facturacion { mes, semana, afectada }: lo que el dueno configuro; `afectada` es true cuando la
 *     nueva ETA cae en un mes posterior al de facturacion configurado, false si no, y null si la BO
 *     no tiene mes configurado o no queda fecha que comparar.
 * Los cambios cuyo PO no esta asociado a ninguna BO van en `sinBo`, agrupados por PO.
 * Un PO asociado a dos BO se informa en las dos (con `compartida: true`).
 */
const cruzarConBo = ({ cambios, antes = [], ahora = [], bos = [] } = {}) => {
  const bosPorPo = new Map();
  for (const bo of Array.isArray(bos) ? bos : []) {
    for (const po of posDe(bo?.po_axis)) {
      if (!bosPorPo.has(po)) bosPorPo.set(po, []);
      bosPorPo.get(po).push(bo);
    }
  }
  const abiertasPorPo = (lineas) => {
    const mapa = new Map();
    for (const l of Array.isArray(lineas) ? lineas : []) {
      if (!l.po || l.cerrada) continue;
      if (!mapa.has(l.po)) mapa.set(l.po, []);
      mapa.get(l.po).push(l);
    }
    return mapa;
  };
  const antesPorPo = abiertasPorPo(antes);
  const ahoraPorPo = abiertasPorPo(ahora);

  const porBo = new Map();
  const sinBo = new Map();
  for (const cambio of Array.isArray(cambios) ? cambios : []) {
    const po = cambio.linea.po;
    const destinos = bosPorPo.get(po) || [];
    if (destinos.length === 0) {
      const clave = po || '';
      if (!sinBo.has(clave)) sinBo.set(clave, { po: clave, lineas: [] });
      sinBo.get(clave).lineas.push(cambio);
      continue;
    }
    for (const bo of destinos) {
      if (!porBo.has(bo.bo)) porBo.set(bo.bo, { bo, lineas: [], compartida: destinos.length > 1 });
      porBo.get(bo.bo).lineas.push(cambio);
    }
  }

  const ordenarLineas = (lineas) =>
    lineas.sort((a, b) => ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || Math.abs(b.dias || 0) - Math.abs(a.dias || 0) || String(a.linea.clave).localeCompare(String(b.linea.clave)));

  const grupos = [...porBo.values()].map(({ bo, lineas, compartida }) => {
    const pos = posDe(bo.po_axis);
    const lineasDe = (mapa) => pos.flatMap((po) => mapa.get(po) || []);
    const despachoAntes = ultimaFecha(lineasDe(antesPorPo));
    const despachoAhora = ultimaFecha(lineasDe(ahoraPorPo));
    const etaAntes = sumarDias(despachoAntes, DIAS_A_ETA);
    const etaAhora = sumarDias(despachoAhora, DIAS_A_ETA);
    const mesFacturacion = /^\d{4}-\d{2}$/.test(String(bo.estimated_invoice_month || '')) ? bo.estimated_invoice_month : null;
    return {
      bo: bo.bo,
      cliente: limpio(bo.customer_name),
      proyecto: limpio(bo.project_name),
      poAxis: pos.join(', '),
      poCliente: limpio(bo.customer_po),
      compartida,
      ultimoDespacho: { antes: despachoAntes, ahora: despachoAhora },
      eta: { antes: etaAntes, ahora: etaAhora },
      mes: { antes: mesDe(etaAntes), ahora: mesDe(etaAhora) },
      dias: diasEntre(despachoAntes, despachoAhora),
      facturacion: {
        mes: mesFacturacion,
        semana: bo.estimated_invoice_week ?? null,
        afectada: mesFacturacion && etaAhora ? mesDe(etaAhora) > mesFacturacion : null
      },
      lineas: ordenarLineas(lineas)
    };
  });
  // Primero lo que mas duele: facturacion afectada, luego el mayor atraso de la BO.
  grupos.sort((a, b) =>
    Number(b.facturacion.afectada === true) - Number(a.facturacion.afectada === true) ||
    (b.dias || 0) - (a.dias || 0) ||
    String(a.bo).localeCompare(String(b.bo)));

  const sinBoLista = [...sinBo.values()].map((g) => ({ po: g.po, lineas: ordenarLineas(g.lineas) })).sort((a, b) => a.po.localeCompare(b.po));

  const porTipo = Object.fromEntries(TIPOS.map((t) => [t, 0]));
  for (const c of Array.isArray(cambios) ? cambios : []) porTipo[c.tipo] += 1;
  return {
    resumen: {
      cambios: (Array.isArray(cambios) ? cambios : []).length,
      ...porTipo,
      bos: grupos.length,
      bosAtrasadas: grupos.filter((g) => (g.dias || 0) > 0).length,
      bosConFacturacionAfectada: grupos.filter((g) => g.facturacion.afectada === true).length,
      lineasSinBo: sinBoLista.reduce((n, g) => n + g.lineas.length, 0)
    },
    grupos,
    sinBo: sinBoLista
  };
};

module.exports = {
  DIAS_A_ETA,
  TIPOS,
  parsearFecha,
  sumarDias,
  diasEntre,
  mesDe,
  numeroDe,
  esCerrada,
  leerOor,
  huella,
  comparar,
  posDe,
  cruzarConBo
};
