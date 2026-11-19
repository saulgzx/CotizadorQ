import { ETAPAS } from './formato';

// Lógica pura de la pestaña Árbol del CRM (sin React ni red): armar los tres
// niveles grupo ▸ oportunidad ▸ cotización, filtrarlos, aplanarlos para la
// pantalla y resolver el movimiento de foco del treegrid.

export const AGRUPACIONES = [
  { clave: 'empresa', nombre: 'Empresa' },
  { clave: 'etapa', nombre: 'Etapa' },
  { clave: 'marca', nombre: 'Marca' }
];

export const ETAPAS_ABIERTAS = ['nueva', 'cotizada', 'negociacion'];

const CLAVES_ETAPA = ETAPAS.map((e) => e.clave);
const MARCAS_ORDEN = ['AXIS', 'QNAP', 'MIXTA'];
const MARCAS_FILTRO = ['', ...MARCAS_ORDEN, 'SIN'];
const CLAVE_PREFERENCIAS = 'crmArbol';
const MAX_EXPANDIDOS = 2000;

const ES_ABIERTA = new Set(ETAPAS_ABIERTAS);

// ---------- Utilidades ----------

/** Minúsculas y sin tildes, para comparar y buscar. */
const normalizar = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Monto en centavos enteros (texto o null no rompen: valen 0). */
const centavos = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const aMonto = (cent) => cent / 100;

const lista = (valor) => (Array.isArray(valor) ? valor : []);

const comparar = (a, b) => normalizar(a).localeCompare(normalizar(b), 'es');

// ---------- Filtrado ----------

/**
 * Oportunidades que pasan los filtros, con sus cotizaciones y si calzaron por
 * una cotización. Las cotizaciones sin oportunidad en la lista se ignoran.
 */
function filtrarOportunidades(datos, { busqueda = '', etapas = [], marca = '' } = {}) {
  const ops = lista(datos?.oportunidades).filter((o) => o && typeof o === 'object');
  const porOp = new Map();
  lista(datos?.cotizaciones).forEach((c) => {
    if (!c || typeof c !== 'object' || c.oportunidad_id == null) return;
    const clave = String(c.oportunidad_id);
    if (!porOp.has(clave)) porOp.set(clave, []);
    porOp.get(clave).push(c);
  });

  const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean);
  const etapasSel = new Set(lista(etapas));
  const resultado = [];

  ops.forEach((op) => {
    if (etapasSel.size > 0 && !etapasSel.has(op.etapa)) return;
    if (marca && (MARCAS_ORDEN.includes(op.marca) ? op.marca : 'SIN') !== marca) return;
    const cots = porOp.get(String(op.id)) || [];
    let porCotizacion = false;
    if (palabras.length > 0) {
      const textoOp = normalizar(
        [op.empresa_nombre, op.titulo, op.contacto_nombre, op.bo, op.marca, op.seguimiento_nota].filter((v) => v != null).join(' ')
      );
      const textoCots = normalizar(
        cots.map((c) => [`#${c.numero}`, c.numero, c.proyecto, c.pid, c.usuario].filter((v) => v != null).join(' ')).join(' ')
      );
      const enOp = palabras.every((p) => textoOp.includes(p));
      if (!enOp && !palabras.every((p) => `${textoOp} ${textoCots}`.includes(p))) return;
      porCotizacion = !enOp;
    }
    resultado.push({ op, cots, porCotizacion });
  });
  return resultado;
}

// ---------- Árbol ----------

const claveGrupo = (agruparPor, op) => {
  if (agruparPor === 'etapa') return String(op.etapa ?? 'sin');
  if (agruparPor === 'marca') return MARCAS_ORDEN.includes(op.marca) ? op.marca : 'SIN';
  if (op.empresa_id != null && op.empresa_id !== '') return String(op.empresa_id);
  const nombre = normalizar(op.empresa_nombre).trim();
  return nombre ? `n:${nombre}` : 'sin';
};

const tituloGrupo = (agruparPor, clave, op) => {
  if (agruparPor === 'etapa') return ETAPAS.find((e) => e.clave === clave)?.nombre || clave;
  if (agruparPor === 'marca') return clave === 'SIN' ? 'Sin marca' : clave;
  return String(op.empresa_nombre || '').trim() || 'Sin empresa';
};

const ordenFijo = (orden, clave) => {
  const i = orden.indexOf(clave);
  return i === -1 ? orden.length : i;
};

/**
 * Arma el árbol agrupado y filtrado.
 * → { grupos, totales, abrirPorBusqueda } (abrirPorBusqueda es un Set de ids).
 */
export function construirArbol(datos, { agruparPor = 'empresa', busqueda = '', etapas = [], marca = '' } = {}) {
  const agrupacion = AGRUPACIONES.some((a) => a.clave === agruparPor) ? agruparPor : 'empresa';
  const grupos = new Map();
  const abrirPorBusqueda = new Set();
  const hayBusqueda = normalizar(busqueda).trim() !== '';

  filtrarOportunidades(datos, { busqueda, etapas, marca }).forEach(({ op, cots, porCotizacion }) => {
    const clave = claveGrupo(agrupacion, op);
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = {
        id: `g:${agrupacion}:${clave}`,
        tipo: 'grupo',
        agrupacion,
        clave,
        titulo: tituloGrupo(agrupacion, clave, op),
        ...(agrupacion === 'empresa' && op.empresa_id != null && op.empresa_id !== '' ? { empresaId: op.empresa_id } : {}),
        oportunidades: [],
        conteo: 0,
        abiertas: 0,
        montoAbierto: 0,
        montoGanado: 0,
        montoTotal: 0
      };
      grupos.set(clave, grupo);
    }
    if (agrupacion === 'empresa' && grupo.titulo === 'Sin empresa' && op.empresa_nombre) {
      grupo.titulo = String(op.empresa_nombre).trim() || grupo.titulo;
    }
    const nodo = {
      id: `o:${op.id}`,
      tipo: 'oportunidad',
      op,
      cotizaciones: cots.map((cot, i) => ({ id: `c:${cot.id}`, tipo: 'cotizacion', cot, vigente: i === 0 }))
    };
    grupo.oportunidades.push(nodo);
    const cent = centavos(op.monto);
    grupo.conteo += 1;
    grupo.montoTotal += cent;
    if (ES_ABIERTA.has(op.etapa)) {
      grupo.abiertas += 1;
      grupo.montoAbierto += cent;
    }
    if (op.etapa === 'ganada') grupo.montoGanado += cent;
    if (hayBusqueda) {
      abrirPorBusqueda.add(grupo.id);
      if (porCotizacion) abrirPorBusqueda.add(nodo.id);
    }
  });

  const ordenados = [...grupos.values()].sort((a, b) => {
    if (agrupacion === 'etapa') return ordenFijo(CLAVES_ETAPA, a.clave) - ordenFijo(CLAVES_ETAPA, b.clave);
    if (agrupacion === 'marca') return ordenFijo(MARCAS_ORDEN, a.clave) - ordenFijo(MARCAS_ORDEN, b.clave);
    return b.montoAbierto - a.montoAbierto || comparar(a.titulo, b.titulo);
  });

  const totales = { grupos: ordenados.length, oportunidades: 0, abiertas: 0, montoAbierto: 0, montoGanado: 0 };
  let abierto = 0;
  let ganado = 0;
  ordenados.forEach((g) => {
    totales.oportunidades += g.conteo;
    totales.abiertas += g.abiertas;
    abierto += g.montoAbierto;
    ganado += g.montoGanado;
  });
  totales.montoAbierto = aMonto(abierto);
  totales.montoGanado = aMonto(ganado);

  ordenados.forEach((g) => {
    g.montoAbierto = aMonto(g.montoAbierto);
    g.montoGanado = aMonto(g.montoGanado);
    g.montoTotal = aMonto(g.montoTotal);
  });

  return { grupos: ordenados, totales, abrirPorBusqueda };
}

/** Cuántas oportunidades hay en cada etapa con búsqueda y marca aplicadas (sin el filtro de etapas). */
export function conteosPorEtapa(datos, { busqueda = '', marca = '' } = {}) {
  const conteo = Object.fromEntries(CLAVES_ETAPA.map((c) => [c, 0]));
  filtrarOportunidades(datos, { busqueda, marca }).forEach(({ op }) => {
    if (op.etapa in conteo) conteo[op.etapa] += 1;
  });
  return conteo;
}

// ---------- Filas visibles y foco ----------

/**
 * Lista plana en orden de pantalla. Un nodo se ve si todos sus ancestros están
 * desplegados. `expandidos` es un Set de ids (también sirve un arreglo).
 */
export function filasVisibles(arbol, expandidos) {
  const abiertos = expandidos instanceof Set ? expandidos : new Set(expandidos || []);
  const grupos = lista(arbol?.grupos);
  const filas = [];
  grupos.forEach((g, i) => {
    const abierto = abiertos.has(g.id);
    const expandible = g.oportunidades.length > 0;
    filas.push({
      id: g.id, tipo: 'grupo', nivel: 1, nodo: g, expandible, expandido: expandible && abierto,
      padreId: null, posicion: i + 1, tamano: grupos.length
    });
    if (!expandible || !abierto) return;
    g.oportunidades.forEach((o, j) => {
      const abiertaOp = abiertos.has(o.id);
      const conHijos = o.cotizaciones.length > 0;
      filas.push({
        id: o.id, tipo: 'oportunidad', nivel: 2, nodo: o, expandible: conHijos, expandido: conHijos && abiertaOp,
        padreId: g.id, posicion: j + 1, tamano: g.oportunidades.length
      });
      if (!conHijos || !abiertaOp) return;
      o.cotizaciones.forEach((c, k) => {
        filas.push({
          id: c.id, tipo: 'cotizacion', nivel: 3, nodo: c, expandible: false, expandido: false,
          padreId: o.id, posicion: k + 1, tamano: o.cotizaciones.length
        });
      });
    });
  });
  return filas;
}

/**
 * Teclado del treegrid (WAI-ARIA). → { foco, expandir, contraer }: id de la fila
 * a enfocar y, si corresponde, id de la fila a desplegar o a plegar.
 */
export function moverFoco(filas, idActual, tecla) {
  const sinCambio = { foco: idActual ?? null, expandir: null, contraer: null };
  const filasL = lista(filas);
  if (filasL.length === 0) return sinCambio;
  const i = filasL.findIndex((f) => f.id === idActual);
  if (i === -1) return { ...sinCambio, foco: filasL[0].id };
  const fila = filasL[i];
  const ir = (idx) => ({ ...sinCambio, foco: filasL[Math.max(0, Math.min(filasL.length - 1, idx))].id });

  switch (tecla) {
    case 'ArrowDown':
      return ir(i + 1);
    case 'ArrowUp':
      return ir(i - 1);
    case 'Home':
      return ir(0);
    case 'End':
      return ir(filasL.length - 1);
    case 'ArrowRight': {
      if (!fila.expandible) return sinCambio;
      if (!fila.expandido) return { ...sinCambio, expandir: fila.id };
      const siguiente = filasL[i + 1];
      return siguiente && siguiente.padreId === fila.id ? { ...sinCambio, foco: siguiente.id } : sinCambio;
    }
    case 'ArrowLeft': {
      if (fila.expandible && fila.expandido) return { ...sinCambio, contraer: fila.id };
      return fila.padreId ? { ...sinCambio, foco: fila.padreId } : sinCambio;
    }
    default:
      return sinCambio;
  }
}

// ---------- Preferencias ----------

export const PREFERENCIAS_POR_DEFECTO = Object.freeze({
  agruparPor: 'empresa',
  etapas: ETAPAS_ABIERTAS,
  marca: '',
  expandidos: []
});

const sanear = (p) => {
  const base = p && typeof p === 'object' ? p : {};
  const agruparPor = AGRUPACIONES.some((a) => a.clave === base.agruparPor) ? base.agruparPor : 'empresa';
  const etapas = Array.isArray(base.etapas)
    ? [...new Set(base.etapas.filter((e) => CLAVES_ETAPA.includes(e)))]
    : [...ETAPAS_ABIERTAS];
  const marca = MARCAS_FILTRO.includes(base.marca) ? base.marca : '';
  const expandidos = Array.isArray(base.expandidos)
    ? [...new Set(base.expandidos.filter((id) => typeof id === 'string' && /^[go]:./.test(id)))].slice(0, MAX_EXPANDIDOS)
    : [];
  return { agruparPor, etapas, marca, expandidos };
};

export function leerPreferencias() {
  try {
    const crudo = window.localStorage.getItem(CLAVE_PREFERENCIAS);
    return sanear(crudo ? JSON.parse(crudo) : null);
  } catch {
    return sanear(null);
  }
}

export function guardarPreferencias(p) {
  try {
    window.localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(sanear(p)));
  } catch {
    // Sin almacenamiento (modo privado, cuota): el árbol funciona igual, sin recordar.
  }
}
