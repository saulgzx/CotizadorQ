// Asistente IA: utilidades del tab. La consulta corre en el backend de MyQuote
// (API de Claude + skills de preventa + conector MyQuote); aqui se arma el
// mensaje y se lee la respuesta para cargarla al cotizador.

export const MARCAS = {
  AXIS: {
    clave: 'AXIS',
    nombre: 'Axis',
    skill: 'preventa-axis',
    descripcion: 'Cámaras, analítica, audio, control de acceso y accesorios.'
  },
  QNAP: {
    clave: 'QNAP',
    nombre: 'QNAP',
    skill: 'preventa-qnap',
    descripcion: 'NAS, almacenamiento, backup, vigilancia y rackeo.'
  }
};

export const MARCADOR_LISTA = 'LISTA COTIZADORQ';

/** Primer mensaje de la conversacion: datos del cliente + requerimiento. */
export const construirMensajeInicial = ({
  requerimiento,
  cliente = '',
  contacto = '',
  notas = ''
}) => {
  const lineas = [];
  if (cliente.trim()) lineas.push(`Cliente: ${cliente.trim()}`);
  if (contacto.trim()) lineas.push(`Contacto: ${contacto.trim()}`);
  if (notas.trim())
    lineas.push(`Notas internas (no van en el correo): ${notas.trim()}`);
  if (lineas.length) lineas.push('');
  lineas.push('Requerimiento:', String(requerimiento || '').trim());
  return lineas.join('\n');
};

/** Texto visible de una respuesta guardada (bloques de la API). */
export const textoDeContenido = (contenido) =>
  (Array.isArray(contenido) ? contenido : [])
    .filter((b) => b?.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n\n');

// ---------------------------------------------------------------------------
// Respuesta de la IA -> lista "codigo<TAB>cantidad" para PegarListaModal.

const limpiarCelda = (c) =>
  String(c ?? '')
    .replace(/\*\*|__|`/g, '')
    .trim();
const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const filasDeTabla = (texto) => {
  const filas = [];
  for (const cruda of String(texto || '').split(/\r?\n/)) {
    const linea = cruda.trim();
    if (linea.includes('|')) {
      const celdas = linea
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(limpiarCelda);
      if (celdas.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // separador markdown
      filas.push(celdas);
    } else if (linea.includes('\t')) {
      filas.push(linea.split('\t').map(limpiarCelda));
    } else {
      filas.push(null); // corta la tabla actual
    }
  }
  return filas;
};

const indiceColumna = (encabezado, patrones) =>
  encabezado.findIndex((c) => patrones.some((p) => p.test(sinAcentos(c))));

// Busca tablas con columnas de cantidad y SKU/MPN (el formato de las skills de preventa).
const listaDesdeTablas = (texto) => {
  const salida = [];
  let columnas = null;
  for (const fila of filasDeTabla(texto)) {
    if (!fila) {
      columnas = null;
      continue;
    }
    const cant = indiceColumna(fila, [
      /^cant\.?$/,
      /^cantidad$/,
      /^qty$/,
      /^unidades$/
    ]);
    const sku = indiceColumna(fila, [/^sku$/, /^codigo$/]);
    const mpn = indiceColumna(fila, [/^mpn$/, /^part ?number$/, /^p\/?n$/]);
    if (cant >= 0 && (sku >= 0 || mpn >= 0)) {
      columnas = { cant, sku, mpn };
      continue;
    }
    if (!columnas) continue;
    const cantidad = Number(
      String(fila[columnas.cant] || '').replace(/[^\d]/g, '')
    );
    const valorSku = columnas.sku >= 0 ? fila[columnas.sku] : '';
    const valorMpn = columnas.mpn >= 0 ? fila[columnas.mpn] : '';
    const codigo =
      valorSku && !/^to ?create$/i.test(valorSku) ? valorSku : valorMpn;
    if (!codigo || !cantidad) continue;
    salida.push(`${codigo}\t${cantidad}`);
  }
  return salida;
};

// Bloque explicito pedido en el prompt.
const listaDesdeBloque = (texto) => {
  const t = String(texto || '');
  const i = t.toUpperCase().indexOf(MARCADOR_LISTA);
  if (i < 0) return [];
  const resto = t.slice(i + MARCADOR_LISTA.length);
  const fence = resto.match(/```[^\n]*\n([\s\S]*?)```/);
  const cuerpo = fence
    ? fence[1]
    : resto
        .split(/\n\s*\n/)
        .slice(0, 2)
        .join('\n');
  return cuerpo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) => l && !/^```/.test(l) && !l.toUpperCase().includes(MARCADOR_LISTA)
    );
};

/**
 * Extrae los productos de la respuesta de la IA. Prioriza el bloque
 * LISTA COTIZADORQ, luego la tabla del preview y, si no hay ninguno,
 * devuelve el texto tal cual para que el parser de listas lo intente.
 */
export const extraerListaDeRespuesta = (texto) => {
  const bloque = listaDesdeBloque(texto);
  if (bloque.length) return { origen: 'bloque', texto: bloque.join('\n') };
  const tabla = listaDesdeTablas(texto);
  if (tabla.length) return { origen: 'tabla', texto: tabla.join('\n') };
  return { origen: 'texto', texto: String(texto || '').trim() };
};
