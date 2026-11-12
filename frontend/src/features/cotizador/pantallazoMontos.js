// Montos leidos de un pantallazo (OC del cliente o planilla de costos de
// Axis) -> lineas de una orden.
//
// Modulo puro: sin React y sin red. Recibe las filas ya extraidas del
// pantallazo y las lineas de la orden, y dice que monto va en que linea.
// Es plata: nunca adivina, nunca redondea y nunca elige entre dos montos
// distintos. Lo que no esta claro queda reportado para que lo vea una persona.

import { normalizeLookupKey } from './cotizadorHelpers';

// Simbolos y codigos de moneda que pueden venir pegados al numero.
const MONEDA = /us\$|usd|clp|[$€]/gi;
const SOLO_NUMERO = /^\d[\d.,]*$/;
const ENTERO = /^\d+$/;
// Parte entera agrupada de a miles: "1", "12.345", "1.234.567".
const esMilesValido = (texto, separador) => {
  const grupos = texto.split(separador);
  if (!/^[1-9]\d{0,2}$/.test(grupos[0])) return false;
  return grupos.slice(1).every((g) => /^\d{3}$/.test(g));
};

const aPositivo = (numero) => (Number.isFinite(numero) && numero > 0 ? numero : null);

// Deja el texto como "1234.56" (o null si no se puede leer sin adivinar).
const aTextoDecimal = (texto) => {
  const tieneComa = texto.includes(',');
  const tienePunto = texto.includes('.');
  if (!tieneComa && !tienePunto) return texto;

  if (tieneComa && tienePunto) {
    // Con los dos separadores, el que aparece ultimo es el decimal y el
    // otro agrupa miles: "1,234.56" (ingles) o "1.234,56" (espanol).
    const decimal = texto.lastIndexOf(',') > texto.lastIndexOf('.') ? ',' : '.';
    const miles = decimal === ',' ? '.' : ',';
    const partes = texto.split(decimal);
    if (partes.length !== 2) return null;
    const [entera, fraccion] = partes;
    if (!ENTERO.test(fraccion) || !esMilesValido(entera, miles)) return null;
    return `${entera.split(miles).join('')}.${fraccion}`;
  }

  const separador = tieneComa ? ',' : '.';
  const partes = texto.split(separador);
  if (partes.length > 2) {
    // Repetido solo puede ser separador de miles: "1,234,567" / "1.234.567".
    return esMilesValido(texto, separador) ? partes.join('') : null;
  }
  const [entera, fraccion] = partes;
  if (!ENTERO.test(entera) || !ENTERO.test(fraccion)) return null;
  // "1.234" / "1,234" son mil doscientos treinta y cuatro. Con cualquier
  // otro largo despues del separador (o con "0" adelante, como "0.125") no
  // puede ser miles, asi que es decimal.
  if (fraccion.length === 3 && esMilesValido(texto, separador)) return `${entera}${fraccion}`;
  return `${entera}.${fraccion}`;
};

export const normalizarMonto = (valor) => {
  if (typeof valor === 'number') return aPositivo(valor);
  if (typeof valor !== 'string') return null;
  const texto = valor.replace(MONEDA, '').replace(/\s+/g, '');
  // Aca caen vacio, "-", "N/A", negativos ("-410", "(410)") y cualquier basura.
  if (!SOLO_NUMERO.test(texto)) return null;
  const decimal = aTextoDecimal(texto);
  return decimal === null ? null : aPositivo(Number(decimal));
};

export const claveLinea = (linea) => `${normalizeLookupKey(linea?.sku)}||${normalizeLookupKey(linea?.mpn)}`;

// Niveles de calce, en orden de prioridad: campo de la fila -> campo de la linea.
const NIVELES = [
  { por: 'mpn', campoFila: 'mpn', campoLinea: 'mpn' },
  { por: 'sku', campoFila: 'sku', campoLinea: 'sku' },
  { por: 'descripcion', campoFila: 'descripcion', campoLinea: 'desc' }
];

export const calzarMontos = ({ filas, lineas } = {}) => {
  const listaFilas = Array.isArray(filas) ? filas : [];
  const listaLineas = Array.isArray(lineas) ? lineas : [];

  // Claves de linea en el orden de la orden, sin repetir.
  const claves = [];
  const vistas = new Set();
  // indices[por]: valor normalizado -> Set de claves de linea que lo tienen.
  const indices = { mpn: new Map(), sku: new Map(), descripcion: new Map() };
  for (const linea of listaLineas) {
    if (!linea || typeof linea !== 'object') continue;
    const clave = claveLinea(linea);
    if (!vistas.has(clave)) {
      vistas.add(clave);
      claves.push(clave);
    }
    for (const { por, campoLinea } of NIVELES) {
      const valor = normalizeLookupKey(linea[campoLinea]);
      if (!valor) continue;
      if (!indices[por].has(valor)) indices[por].set(valor, new Set());
      indices[por].get(valor).add(clave);
    }
  }

  // Primer nivel que apunta a UNA sola linea. Si un dato pega con varias
  // lineas distintas no sirve para decidir y se prueba el nivel siguiente.
  const buscarLinea = (fila) => {
    if (!fila || typeof fila !== 'object') return null;
    for (const { por, campoFila } of NIVELES) {
      const valor = normalizeLookupKey(fila[campoFila]);
      const candidatas = valor ? indices[por].get(valor) : null;
      if (candidatas && candidatas.size === 1) return { clave: [...candidatas][0], por };
    }
    return null;
  };

  const sinCalce = [];
  const sinMonto = [];
  // clave -> { montos: [distintos, en orden de aparicion], por: nivel de la primera fila }
  const recibidos = new Map();
  for (const fila of listaFilas) {
    const calce = buscarLinea(fila);
    if (!calce) {
      sinCalce.push(fila);
      continue;
    }
    const monto = normalizarMonto(fila.monto);
    if (monto === null) {
      sinMonto.push(fila);
      continue;
    }
    if (!recibidos.has(calce.clave)) recibidos.set(calce.clave, { montos: [], por: calce.por });
    const { montos } = recibidos.get(calce.clave);
    if (!montos.includes(monto)) montos.push(monto);
  }

  const asignaciones = {};
  const calzadas = [];
  const ambiguas = [];
  const lineasSinDato = [];
  for (const clave of claves) {
    const recibido = recibidos.get(clave);
    if (!recibido) {
      lineasSinDato.push(clave);
    } else if (recibido.montos.length > 1) {
      ambiguas.push({ clave, montos: recibido.montos });
    } else {
      asignaciones[clave] = recibido.montos[0];
      calzadas.push({ clave, monto: recibido.montos[0], por: recibido.por });
    }
  }

  return { asignaciones, calzadas, sinCalce, sinMonto, lineasSinDato, ambiguas };
};
