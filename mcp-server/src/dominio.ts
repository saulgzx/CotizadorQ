// Reglas de negocio puras: sin red, sin variables de entorno, sin estado.
// Todo lo que decide que dice una salida vive aca, para poder testearlo.

import { GARANTIAS, type Garantia } from './datos/garantias.js';
import { EOL_MPN } from './datos/eol.js';

export interface Producto {
  id: number;
  origen: string;
  marca: string;
  sku: string;
  mpn: string;
  descripcion: string;
  tiempo_entrega: string;
  precio_cliente: number;
}

/**
 * Clave de comparacion: solo letras y numeros, en mayuscula. Asi "rail b02",
 * "RAIL-B02" y "Rail_B02" colapsan al mismo valor RAILB02.
 */
export const clavear = (valor: unknown) =>
  String(valor ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

export const normalizarMpn = (valor: unknown) => String(valor ?? '').trim().toUpperCase();

// ------------------------------------------------------------------- stock

/**
 * Una lectura de stock. `verificado` es true solo si el dato salio de una
 * lectura en vivo que funciono AHORA; un snapshot viejo nunca cuenta como
 * verificado, aunque traiga unidades.
 */
export interface LecturaStock {
  mapa: Map<string, number | string>;
  verificado: boolean;
  origen: 'vivo' | 'snapshot' | 'ninguno';
  /** ISO de cuando se leyo el dato que se esta usando. */
  leido_en: string | null;
  error: string | null;
}

export const SUFIJO_ENTREGA_STOCK = 'unidades disponible en entrega inmediata, salvo venta previa';

/** Unidades como numero cuando se puede; el texto crudo si la planilla trae algo raro. */
export const unidadesDe = (lectura: LecturaStock, producto: Producto): number | string | null => {
  const valor = lectura.mapa.get(normalizarMpn(producto.mpn));
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  // 0 disponible (todo asignado en OSO, o bodega vacia) cuenta como sin stock.
  const numero = Number(String(valor).replace(',', '.'));
  if (Number.isFinite(numero) && numero <= 0) return null;
  return valor;
};

const tieneUnidades = (valor: number | string | null): boolean => {
  if (valor === null) return false;
  const numero = Number(String(valor).replace(',', '.'));
  return Number.isFinite(numero) ? numero > 0 : String(valor).trim() !== '';
};

const ZONA = 'America/Santiago';

// Meses fijos: la abreviatura de Intl cambia segun la version de ICU ("sep" / "sept").
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "12-sep 09:40" en hora de Chile. */
export const fechaCorta = (iso: string): string => {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(iso));
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value || '';
  return `${parte('day')}-${MESES[Number(parte('month')) - 1]} ${parte('hour')}:${parte('minute')}`;
};

const mismoDia = (a: Date, b: Date) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA });
  return f.format(a) === f.format(b);
};

/**
 * Texto de stock para la salida legible. Con snapshot, la antiguedad va en el
 * texto y no solo en el JSON: un dato fechado se puede juzgar, uno sin fecha no.
 */
export const textoStock = (
  lectura: LecturaStock,
  unidades: number | string | null,
  ahora: Date = new Date()
): string => {
  if (lectura.origen === 'ninguno') return 'sin dato';
  const cantidad = unidades === null ? 'sin unidades' : `${unidades} u.`;
  if (lectura.verificado) return cantidad;
  const cuando = lectura.leido_en ? fechaCorta(lectura.leido_en) : 'fecha desconocida';
  const hoy = lectura.leido_en && mismoDia(new Date(lectura.leido_en), ahora);
  return `${cantidad} al ${cuando} · no verificado ${hoy ? 'desde entonces' : 'hoy'}`;
};

// --------------------------------------------------------------- sku estado

export type SkuEstado = 'activo' | 'por_crear';

// El catalogo marca los productos sin SKU Intcomex con el literal "To Create".
export const skuEstado = (producto: Producto): SkuEstado => {
  const clave = clavear(producto.sku);
  return !clave || clave === 'TOCREATE' ? 'por_crear' : 'activo';
};

export const esEol = (producto: Producto, eolExtra: ReadonlySet<string> = new Set()): boolean => {
  const clave = clavear(producto.mpn);
  return Boolean(clave) && (EOL_MPN.has(clave) || eolExtra.has(clave));
};

// ------------------------------------------------------------------ entrega

export interface InfoEntrega {
  /** Plazo afirmado. null cuando el stock no se pudo verificar: no se adivina. */
  entrega: string | null;
  /** El plazo del catalogo, siempre etiquetado como tal. */
  entrega_catalogo: string;
  stock_verificado: boolean;
  sku_estado: SkuEstado;
  dias_creacion_sku: number | null;
}

const conCreacion = (plazo: string, dias: number | null): string =>
  dias ? `${plazo} + ${dias} dias de creacion de SKU` : plazo;

/**
 * Regla T0.2: la entrega solo se afirma si el stock se leyo en vivo. Con stock
 * verificado y unidades, entrega inmediata; verificado y sin unidades, el
 * plazo del catalogo pasa a ser el plazo real. Un SKU "por crear" suma los
 * dias de creacion al plazo, porque eso cambia la fecha que se promete.
 */
export const infoEntrega = (
  producto: Producto,
  lectura: LecturaStock,
  diasCreacionSku: number,
  cantidad?: number
): InfoEntrega => {
  const estado = skuEstado(producto);
  const dias = estado === 'por_crear' ? diasCreacionSku : null;
  const catalogo = (producto.tiempo_entrega || '').trim();
  const unidades = unidadesDe(lectura, producto);

  let entrega: string | null = null;
  if (lectura.verificado) {
    let base = catalogo;
    if (tieneUnidades(unidades)) {
      base = `${unidades} ${SUFIJO_ENTREGA_STOCK}`;
      // Stock parcial: lo que falta llega con el plazo de importacion (ETA).
      if (cantidad !== undefined && Number(unidades) < cantidad) {
        base += ` | diferencia ${catalogo || 'ETA por confirmar'}`;
      }
    }
    entrega = base ? conCreacion(base, dias) : null;
  }

  return {
    entrega,
    entrega_catalogo: catalogo ? conCreacion(catalogo, dias) : '',
    stock_verificado: lectura.verificado,
    sku_estado: estado,
    dias_creacion_sku: dias
  };
};

/** Lo que va en la columna o linea "Entrega" del texto. */
export const textoEntrega = (info: InfoEntrega): string =>
  info.entrega ?? 'plazo no verificado';

// ----------------------------------------------------------------- garantia

export interface InfoGarantia {
  garantia_anios: number | null;
  garantia_estado: 'validada' | 'sin_validar';
  garantia_validada_en: string | null;
  garantia_url_ficha: string | null;
}

// Sufijos de region que QNAP agrega al MPN comercial. Quitarlo no es inferir:
// TS-873A-8G-US y TS-873A-8G son el mismo equipo.
const SUFIJO_REGION = /-(US|EU|UK|AU|JP|LA|CN|TW)$/i;

export const modeloBase = (mpn: string): string => String(mpn || '').trim().replace(SUFIJO_REGION, '');

/**
 * Regla dura T1.3: solo coincidencia exacta del modelo base contra una fila
 * validada a mano. Nunca se hereda de la familia ni del modelo vecino: el R5 y
 * el R7 del mismo chasis pueden tener garantias distintas.
 */
export const garantiaDe = (
  producto: Producto,
  tabla: readonly Garantia[] = GARANTIAS
): InfoGarantia => {
  const clave = clavear(modeloBase(producto.mpn));
  const fila = clave ? tabla.find((g) => clavear(modeloBase(g.modelo_base)) === clave) : undefined;
  if (!fila) {
    return {
      garantia_anios: null,
      garantia_estado: 'sin_validar',
      garantia_validada_en: null,
      garantia_url_ficha: null
    };
  }
  return {
    garantia_anios: fila.anios,
    garantia_estado: 'validada',
    garantia_validada_en: fila.validado_en,
    garantia_url_ficha: fila.url_ficha
  };
};

export const textoGarantia = (info: InfoGarantia): string =>
  info.garantia_anios === null
    ? 'sin validar'
    : `${info.garantia_anios} ${info.garantia_anios === 1 ? 'año' : 'años'} (validada ${info.garantia_validada_en})`;

// ------------------------------------------------------------------ busqueda

export type TipoCoincidencia = 'exacta' | 'parcial' | 'descripcion';

export interface ResultadoBusqueda {
  producto: Producto | null;
  tipo: TipoCoincidencia | null;
  /** Se llena cuando hay mas de un candidato: no se elige por el usuario. */
  candidatos: Producto[];
}

const MAX_CANDIDATOS = 10;

const palabrasDe = (texto: string) =>
  String(texto || '')
    .toLowerCase()
    .split(/\s+/)
    .map((palabra) => palabra.trim())
    .filter((palabra) => palabra.length > 1);

const coincidePorTexto = (p: Producto, palabras: string[]) => {
  const campos = `${p.sku} ${p.mpn} ${p.marca} ${p.descripcion}`.toLowerCase();
  return palabras.every((palabra) => campos.includes(palabra));
};

/**
 * Busqueda tolerante en tres niveles. Deliberadamente NO usa distancia de
 * edicion sobre los codigos: dos productos reales pueden diferir en un solo
 * caracter (RAIL-B02 / RAIL-B03) y elegir "el mas parecido" pondria el
 * articulo equivocado en una cotizacion real. Ante ambiguedad se devuelven los
 * candidatos para que decida una persona.
 */
export const buscarProductoTolerante = (catalogo: Producto[], texto: string): ResultadoBusqueda => {
  const vacio: ResultadoBusqueda = { producto: null, tipo: null, candidatos: [] };
  const clave = clavear(texto);
  if (!clave) return vacio;

  // Nivel 1: coincidencia exacta ignorando guiones, espacios y mayusculas.
  // "To Create" no es un SKU: nunca resuelve por ese campo.
  const exacta =
    catalogo.find((p) => skuEstado(p) === 'activo' && clavear(p.sku) === clave) ||
    catalogo.find((p) => clavear(p.mpn) === clave);
  if (exacta) return { producto: exacta, tipo: 'exacta', candidatos: [] };

  // Nivel 2: el codigo contiene lo escrito (sirve para codigos incompletos).
  const parciales = catalogo.filter(
    (p) => (skuEstado(p) === 'activo' && clavear(p.sku).includes(clave)) || clavear(p.mpn).includes(clave)
  );
  if (parciales.length === 1) return { producto: parciales[0], tipo: 'parcial', candidatos: [] };
  if (parciales.length > 1) {
    return { producto: null, tipo: null, candidatos: parciales.slice(0, MAX_CANDIDATOS) };
  }

  // Nivel 3: todas las palabras aparecen en algun campo del producto.
  const palabras = palabrasDe(texto);
  if (palabras.length === 0) return vacio;
  const porDescripcion = catalogo.filter((p) => coincidePorTexto(p, palabras));
  if (porDescripcion.length === 1) {
    return { producto: porDescripcion[0], tipo: 'descripcion', candidatos: [] };
  }
  return { producto: null, tipo: null, candidatos: porDescripcion.slice(0, MAX_CANDIDATOS) };
};

/** Grupo de coincidencia para ordenar: menor es mejor. */
export type GrupoCoincidencia = 'mpn_exacto' | 'mpn_prefijo' | 'sku' | 'texto';
const RANGO_GRUPO: Record<GrupoCoincidencia, number> = {
  mpn_exacto: 0,
  mpn_prefijo: 1,
  sku: 2,
  texto: 3
};

export const grupoCoincidencia = (p: Producto, texto: string): GrupoCoincidencia | null => {
  const clave = clavear(texto);
  if (!clave) return 'texto';
  const mpn = clavear(p.mpn);
  if (mpn === clave) return 'mpn_exacto';
  if (mpn.startsWith(clave)) return 'mpn_prefijo';
  if ((skuEstado(p) === 'activo' && clavear(p.sku).includes(clave)) || mpn.includes(clave)) return 'sku';
  const palabras = palabrasDe(texto);
  if (palabras.length > 0 && coincidePorTexto(p, palabras)) return 'texto';
  return null;
};

export interface ProductoRankeado {
  producto: Producto;
  grupo: GrupoCoincidencia;
  unidades: number | string | null;
  con_stock: boolean;
  eol: boolean;
  sku_estado: SkuEstado;
}

/**
 * Regla T1.2, dos criterios encadenados: primero cuan bien coincide, despues
 * que hay en bodega. EOL y "por crear" no se filtran: se rotulan y, dentro de
 * su grupo, quedan detras de los activos. El sort es estable, asi que el
 * orden del catalogo desempata.
 */
export const rankearBusqueda = (
  catalogo: Producto[],
  texto: string,
  lectura: LecturaStock,
  eolExtra: ReadonlySet<string> = new Set()
): ProductoRankeado[] => {
  const rankeados: ProductoRankeado[] = [];
  for (const producto of catalogo) {
    const grupo = grupoCoincidencia(producto, texto);
    if (!grupo) continue;
    const unidades = unidadesDe(lectura, producto);
    rankeados.push({
      producto,
      grupo,
      unidades,
      con_stock: tieneUnidades(unidades),
      eol: esEol(producto, eolExtra),
      sku_estado: skuEstado(producto)
    });
  }
  const peso = (r: ProductoRankeado) => [
    RANGO_GRUPO[r.grupo],
    r.eol ? 1 : 0,
    r.con_stock ? 0 : 1,
    r.sku_estado === 'por_crear' ? 1 : 0
  ];
  return rankeados.sort((a, b) => {
    const pa = peso(a);
    const pb = peso(b);
    for (let i = 0; i < pa.length; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
};

/** Rotulos cortos para una fila de texto. */
export const rotulos = (r: { eol: boolean; sku_estado: SkuEstado }): string =>
  [r.eol ? 'EOL' : '', r.sku_estado === 'por_crear' ? 'por crear' : ''].filter(Boolean).join(' · ');
