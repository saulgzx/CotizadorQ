// Lectura de un quote de fabricante (ISS, Neural Labs, Milestone): manda el PDF o la
// imagen a la cola del asistente IA y devuelve las líneas ya normalizadas.
// Hermano de leerPantallazo: mismo sondeo, mismo corte por tiempo con cancelación.
//
// No escribe nada: devuelve una propuesta que el cotizador revisa antes de cargar al carrito.

import { iaAPI } from '../../api';
import { archivoABase64 } from './leerPantallazo';
import { normalizarMonto } from './pantallazoMontos';
import { normalizarLineasQuote, resumenQuote, FABRICANTES } from './quoteFabricante';

const VACIO = () => ({ lineas: [], moneda: '', descuentoGlobalPct: null, notas: '' });

const esObjeto = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Bloque ```json (o ``` a secas); si no hay, desde el primer { o [ hasta el último } o ].
const sacarJson = (contenido) => {
  const bloque = contenido.match(/```(?:json)?\s*([[{][\s\S]*?)```/i);
  if (bloque) return bloque[1].trim();
  const llave = contenido.indexOf('{');
  const corchete = contenido.indexOf('[');
  const inicios = [llave, corchete].filter((i) => i >= 0);
  if (!inicios.length) return null;
  const inicio = Math.min(...inicios);
  const fin = contenido.lastIndexOf(inicio === llave ? '}' : ']');
  return fin > inicio ? contenido.slice(inicio, fin + 1) : null;
};

const lineaCruda = (f) => ({
  mpn: f.mpn ?? '',
  descripcion: f.descripcion ?? f.desc ?? '',
  cantidad: f.cantidad ?? f.qty ?? null,
  costo_unitario: f.costo_unitario ?? f.costoUnitario ?? null,
  total_linea: f.total_linea ?? f.totalLinea ?? null
});

/**
 * Saca el quote de la respuesta del lector. Tolera bloque con o sin la palabra json, objeto
 * suelto, array suelto de líneas y JSON roto (resultado vacío, nunca lanza).
 */
export const extraerQuote = (texto) => {
  const crudo = sacarJson(String(texto || ''));
  if (!crudo) return VACIO();
  let datos;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return VACIO();
  }
  const envoltorio = Array.isArray(datos) ? { lineas: datos } : esObjeto(datos) ? datos : null;
  if (!envoltorio) return VACIO();
  const lineas = (Array.isArray(envoltorio.lineas) ? envoltorio.lineas : []).filter(esObjeto).map(lineaCruda);
  const d = envoltorio.descuento_global_pct ?? envoltorio.descuentoGlobalPct;
  return {
    lineas,
    moneda: String(envoltorio.moneda ?? '').trim().toUpperCase(),
    descuentoGlobalPct: normalizarMonto(typeof d === 'string' ? d.replace('%', '') : d),
    notas: String(envoltorio.notas ?? '').trim()
  };
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Manda el quote y espera el resultado. `api` y `dormir` se inyectan para los tests.
 * `limiteMs` corta la espera: si la miniPC está apagada el trabajo se queda en la cola.
 * No se manda `marca` ni `mensajes`: con pantallazo el backend no los exige, y el prompt del
 * quote lo arma él según `fabricante`.
 */
export const leerQuote = async ({
  file,
  fabricante,
  api = iaAPI,
  dormir = espera,
  intervaloMs = 2000,
  limiteMs = 180000
}) => {
  const clave = String(fabricante || '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(FABRICANTES, clave)) {
    throw new Error('Fabricante desconocido: usa ISS, NEURAL, VAIDIO, MILESTONE o VELASEA');
  }
  const datos = await archivoABase64(file);
  const { id } = await api.iniciar({
    pantallazo: { datos, mime: file.type, campo: 'quote', fabricante: clave }
  });

  const hasta = Date.now() + limiteMs;
  for (;;) {
    if (Date.now() > hasta) {
      // No dejamos el trabajo colgado ocupando la cola, que atiende de a uno.
      await api.cancelar?.(id).catch(() => {});
      throw new Error('La miniPC no respondió a tiempo. Revisa que el agente esté corriendo.');
    }
    await dormir(intervaloMs);
    const consulta = await api.obtener(id);
    if (consulta.estado === 'en_curso') continue;
    if (consulta.estado === 'error') {
      throw new Error(consulta.error || 'No se pudo leer el quote');
    }
    const quote = extraerQuote(consulta.texto);
    const { lineas, avisos } = normalizarLineasQuote(quote.lineas, { fabricante: clave });
    const resumen = resumenQuote(quote);
    return {
      lineas,
      moneda: quote.moneda,
      descuentoGlobalPct: quote.descuentoGlobalPct,
      notas: quote.notas,
      avisos: [...avisos, ...resumen.avisos]
    };
  }
};
