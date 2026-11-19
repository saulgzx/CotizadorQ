import { ETAPAS_ABIERTAS } from './arbol';
import { ETAPAS } from './formato';

// Lógica pura del Mapa del CRM (sin React ni DOM): un treemap de dos niveles. Cada oportunidad
// es una tarjeta cuya área es proporcional a su monto; las tarjetas se agrupan en bloques.
// Las reglas de fechas y colores de seguimiento viven en seguimiento.js; aquí solo hay geometría
// y las preferencias de la vista.

export const CABECERA_MAPA = 26;
export const MARGEN_MAPA = 6;
export const RELLENO_MAPA = 4;
export const AREA_MINIMA_TARJETA = 2400;

const CLAVE_PREFERENCIAS = 'crmMapa';
const AGRUPACIONES_MAPA = ['empresa', 'etapa', 'marca'];
const COLORES_MAPA = ['seguimiento', 'etapa', 'marca'];
const MARCAS_MAPA = ['', 'AXIS', 'QNAP', 'MIXTA', 'SIN'];
const SEGUIMIENTOS_MAPA = ['', 'vencido', 'hoy', 'semana', 'sin'];

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const redondear = (n) => Math.round(n * 100) / 100;

// ---------- Squarified treemap ----------

/** Peor razón de aspecto de una fila de áreas (de la mayor `max` a la menor `min`) sobre un lado. */
const peorRazon = (max, min, suma, lado) => {
  const l2 = lado * lado;
  const s2 = suma * suma;
  return Math.max((l2 * max) / s2, s2 / (l2 * min));
};

/**
 * Squarified treemap (Bruls, Huizing, van Wijk). `items`: [{ id, peso }]; `rect`: { x, y, w, h }.
 * -> [{ id, x, y, w, h }], uno por item, de mayor a menor peso. Un peso no positivo o un rect sin
 * área da un rectángulo de área 0. Coordenadas reales: quien dibuja decide el redondeo.
 */
export function squarify(items, rect) {
  const x0 = numero(rect?.x);
  const y0 = numero(rect?.y);
  const w = Math.max(0, numero(rect?.w));
  const h = Math.max(0, numero(rect?.h));
  const ordenados = (Array.isArray(items) ? items : [])
    .map((it, i) => ({ id: it?.id, peso: Math.max(0, numero(it?.peso)), i }))
    .sort((a, b) => b.peso - a.peso || a.i - b.i);
  const positivos = ordenados.filter((it) => it.peso > 0);
  const total = positivos.reduce((s, it) => s + it.peso, 0);
  const cero = (it) => ({ id: it.id, x: x0, y: y0, w: 0, h: 0 });
  if (w <= 0 || h <= 0 || total <= 0) return ordenados.map(cero);

  const escala = (w * h) / total;
  const areas = positivos.map((it) => it.peso * escala);
  const n = positivos.length;
  const salida = [];
  let x = x0;
  let y = y0;
  let rw = w;
  let rh = h;
  let i = 0;
  while (i < n) {
    const lado = Math.min(rw, rh);
    if (!(lado > 0)) break;
    // Se agregan items a la fila mientras la peor razón de aspecto no empeore.
    let suma = areas[i];
    let peor = peorRazon(areas[i], areas[i], suma, lado);
    let j = i + 1;
    while (j < n) {
      const suma2 = suma + areas[j];
      const peor2 = peorRazon(areas[i], areas[j], suma2, lado);
      if (peor2 > peor) break;
      suma = suma2;
      peor = peor2;
      j += 1;
    }
    const ultima = j === n;
    if (rw >= rh) {
      // Columna a la izquierda, apilada de arriba abajo.
      const ancho = ultima ? rw : Math.min(rw, suma / rh);
      let yy = y;
      for (let k = i; k < j; k += 1) {
        const alto = k === j - 1 ? y + rh - yy : (areas[k] / suma) * rh;
        salida.push({ id: positivos[k].id, x, y: yy, w: ancho, h: alto });
        yy += alto;
      }
      x += ancho;
      rw -= ancho;
    } else {
      // Fila arriba, de izquierda a derecha.
      const alto = ultima ? rh : Math.min(rh, suma / rw);
      let xx = x;
      for (let k = i; k < j; k += 1) {
        const ancho = k === j - 1 ? x + rw - xx : (areas[k] / suma) * rw;
        salida.push({ id: positivos[k].id, x: xx, y, w: ancho, h: alto });
        xx += ancho;
      }
      y += alto;
      rh -= alto;
    }
    i = j;
  }
  // Lo que no alcanzó a ubicarse (solo por límites numéricos) queda con área 0.
  for (let k = i; k < n; k += 1) salida.push(cero(positivos[k]));
  return [...salida, ...ordenados.filter((it) => it.peso <= 0).map(cero)];
}

// ---------- Alto y pesos ----------

/** Alto del mapa en px: cabe en una pantalla con pocas oportunidades y crece con muchas. */
export function altoDelMapa({ cantidad = 0, ancho = 0, minimo = 520, areaPorTarjeta = 9000, maximo = 20000 } = {}) {
  const w = numero(ancho);
  if (w <= 0) return minimo;
  const necesario = Math.ceil((Math.max(0, numero(cantidad)) * areaPorTarjeta) / w);
  return Math.min(maximo, Math.max(minimo, necesario));
}

/**
 * Pesos para el treemap: el monto, con un piso para que la tarjeta más chica no baje de
 * `areaMinima` px² cuando el total se reparte en `area`. -> { pesos, piso, enPiso } (enPiso: cuántas
 * tarjetas quedaron en el piso). Si no caben todas con ese mínimo, o todos los montos son 0, todas
 * pesan igual (piso 1) y todas cuentan como "en el piso".
 */
export function pesosConPiso(montos, { area = 0, areaMinima = AREA_MINIMA_TARJETA } = {}) {
  const m = (Array.isArray(montos) ? montos : []).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const cantidad = m.length;
  if (cantidad === 0) return { pesos: [], piso: 0, enPiso: 0 };
  const total = m.reduce((s, v) => s + v, 0);
  const areaOk = numero(area);
  if (total <= 0 || !(areaOk > 0) || cantidad * areaMinima >= areaOk) {
    return { pesos: m.map(() => 1), piso: 1, enPiso: cantidad };
  }
  // Punto fijo: f = areaMinima × Σ max(mᵢ, f) / área. Converge porque cantidad × areaMinima < área.
  let f = 0;
  for (let it = 0; it < 200; it += 1) {
    let suma = 0;
    for (let k = 0; k < cantidad; k += 1) suma += m[k] > f ? m[k] : f;
    const siguiente = (areaMinima * suma) / areaOk;
    const cerca = Math.abs(siguiente - f) <= 1e-9 * Math.max(1, siguiente);
    f = siguiente;
    if (cerca) break;
  }
  let enPiso = 0;
  const pesos = m.map((v) => {
    if (v < f) {
      enPiso += 1;
      return f;
    }
    return v;
  });
  return { pesos, piso: f, enPiso };
}

// ---------- Disposición ----------

/** Vueltas del ajuste que iguala la escala entre bloques (ver disponerMapa). */
const VUELTAS_DE_AJUSTE = 16;

/** Cuánto texto cabe en una tarjeta según su caja. */
export const tamanoDeTarjeta = (w, h) => {
  if (w >= 220 && h >= 130) return 'xl';
  if (w >= 150 && h >= 92) return 'l';
  if (w >= 96 && h >= 58) return 'm';
  // Compacta: no caben tres líneas, pero sí el nombre y el monto en dos.
  if (w >= 70 && h >= 40) return 'c';
  if (w >= 54 && h >= 34) return 's';
  return 'xs';
};

/**
 * Treemap de dos niveles. `grupos`: [{ id, items: [{ id, monto }] }].
 * -> { ancho, alto, grupos: [{ id, x, y, w, h, conCabecera, tarjetas: [{ id, x, y, w, h, tamano }] }], enPiso }
 * Las coordenadas de las tarjetas son absolutas (relativas al mapa), no al bloque.
 */
export function disponerMapa({
  grupos,
  ancho,
  alto,
  cabecera = CABECERA_MAPA,
  margen = MARGEN_MAPA,
  relleno = RELLENO_MAPA,
  areaMinima = AREA_MINIMA_TARJETA
} = {}) {
  const W = Math.max(0, numero(ancho));
  const H = Math.max(0, numero(alto));
  const validos = (Array.isArray(grupos) ? grupos : []).filter((g) => g && Array.isArray(g.items) && g.items.length > 0);
  const montos = [];
  validos.forEach((g) => g.items.forEach((it) => montos.push(it?.monto)));

  // Caja útil de un bloque: se encoge `margen/2` por lado y, si le cabe la cabecera, reserva la
  // franja del título y el relleno. Lo que queda es el interior donde van las tarjetas.
  const cajaDe = (r) => {
    const bw = Math.max(0, r.w - margen);
    const bh = Math.max(0, r.h - margen);
    const bx = r.x + (r.w - bw) / 2;
    const by = r.y + (r.h - bh) / 2;
    const conCabecera = bw >= 90 && bh >= 70;
    const interior = conCabecera
      ? { x: bx + relleno, y: by + cabecera, w: Math.max(0, bw - 2 * relleno), h: Math.max(0, bh - cabecera - relleno) }
      : { x: bx, y: by, w: bw, h: bh };
    return { bx, by, bw, bh, conCabecera, interior };
  };

  // UNA escala para todo el mapa (px² por peso). El "decorado" de cada bloque (margen, título,
  // relleno) ocupa un área fija en píxeles que no depende de la plata: repartir el mapa solo
  // por monto le quita proporcionalmente más a los bloques chicos, y una tarjeta de $50.000
  // en una empresa chica se vería menor que una de $50.000 en una grande. Por eso a cada
  // bloque se le da su parte por monto MÁS el área de su decorado, y se itera: el decorado
  // depende de la forma del bloque, que a su vez depende del reparto. Converge en pocas vueltas.
  // El reparto puede oscilar (un bloque que gana o pierde su cabecera cambia de forma): se
  // amortigua desde la cuarta vuelta y al final se usa la vuelta con menor descalce.
  let decorado = validos.map(() => 0);
  let preparados = [];
  let rects = [];
  let enPiso = 0;
  let mejor = null;
  for (let vuelta = 0; vuelta < VUELTAS_DE_AJUSTE; vuelta += 1) {
    const neto = Math.max(0, W * H - decorado.reduce((s, v) => s + v, 0));
    // El piso se calcula una vez sobre todas las tarjetas, con el área que de verdad les queda.
    const conPiso = pesosConPiso(montos, { area: neto, areaMinima });
    enPiso = conPiso.enPiso;
    let cursor = 0;
    preparados = validos.map((g) => {
      const p = g.items.map(() => conPiso.pesos[cursor++]);
      return { g, p, total: p.reduce((s, v) => s + v, 0) };
    });
    const suma = preparados.reduce((s, b) => s + b.total, 0);
    const escala = suma > 0 ? neto / suma : 0;
    rects = squarify(
      preparados.map((b, i) => ({ id: i, peso: escala > 0 ? escala * b.total + decorado[i] : b.total })),
      { x: 0, y: 0, w: W, h: H }
    );
    const siguiente = validos.map(() => 0);
    // Descalce de esta vuelta: cuánto se aparta el interior de cada bloque del área que le toca.
    let descalce = 0;
    rects.forEach((r) => {
      const { interior } = cajaDe(r);
      const areaInterior = interior.w * interior.h;
      siguiente[r.id] = Math.max(0, r.w * r.h - areaInterior);
      const debida = escala * preparados[r.id].total;
      if (debida > 0) descalce = Math.max(descalce, Math.abs(areaInterior / debida - 1));
    });
    if (!mejor || descalce < mejor.descalce) mejor = { descalce, preparados, rects, enPiso };
    if (descalce < 0.002) break;
    decorado = siguiente.map((v, i) => (vuelta < 3 ? v : (v + decorado[i]) / 2));
  }
  if (mejor) ({ preparados, rects, enPiso } = mejor);

  const resultado = rects.map((r) => {
    const { g, p } = preparados[r.id];
    const { bx, by, bw, bh, conCabecera, interior } = cajaDe(r);
    const tarjetas = squarify(g.items.map((it, j) => ({ id: j, peso: p[j] })), interior).map((t) => {
      const x = redondear(t.x);
      const y = redondear(t.y);
      const w2 = redondear(t.w);
      const h2 = redondear(t.h);
      return { id: g.items[t.id].id, x, y, w: w2, h: h2, tamano: tamanoDeTarjeta(w2, h2) };
    });
    return { id: g.id, x: redondear(bx), y: redondear(by), w: redondear(bw), h: redondear(bh), conCabecera, tarjetas };
  });
  return { ancho: W, alto: H, grupos: resultado, enPiso };
}

// ---------- Monto abreviado ----------

const recortado = (n, decimales) => n.toFixed(decimales).replace(/\.?0+$/, '').replace('.', ',');

/** 950 -> "$950"; 35800 -> "$35,8 k"; 1250000 -> "$1,25 M" (coma decimal, como el resto de la pantalla). */
export function usdCorto(valor) {
  const n = Number(valor);
  const v = Number.isFinite(n) && n > 0 ? n : 0;
  if (v < 1000) return `$${Math.round(v)}`;
  if (v < 1e6) {
    const k = recortado(v / 1000, 1);
    if (Number(k.replace(',', '.')) < 1000) return `$${k} k`;
  }
  return `$${recortado(v / 1e6, 2)} M`;
}

// ---------- Preferencias ----------

const sanear = (p) => {
  const base = p && typeof p === 'object' ? p : {};
  const clavesEtapa = ETAPAS.map((e) => e.clave);
  return {
    agruparPor: AGRUPACIONES_MAPA.includes(base.agruparPor) ? base.agruparPor : 'empresa',
    colorPor: COLORES_MAPA.includes(base.colorPor) ? base.colorPor : 'seguimiento',
    etapas: Array.isArray(base.etapas) ? [...new Set(base.etapas.filter((e) => clavesEtapa.includes(e)))] : [...ETAPAS_ABIERTAS],
    marca: MARCAS_MAPA.includes(base.marca) ? base.marca : '',
    seguimiento: SEGUIMIENTOS_MAPA.includes(base.seguimiento) ? base.seguimiento : ''
  };
};

export function leerPreferenciasMapa() {
  try {
    const crudo = window.localStorage.getItem(CLAVE_PREFERENCIAS);
    return sanear(crudo ? JSON.parse(crudo) : null);
  } catch {
    return sanear(null);
  }
}

export function guardarPreferenciasMapa(p) {
  try {
    window.localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(sanear(p)));
  } catch {
    // Sin almacenamiento (modo privado, cuota): el mapa funciona igual, sin recordar.
  }
}
