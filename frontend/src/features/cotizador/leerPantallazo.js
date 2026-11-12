// Lectura de un pantallazo de montos: manda la imagen a la cola del asistente IA
// (que la resuelve la miniPC con Claude Code) y devuelve los montos ya calzados
// contra las líneas de la orden.
//
// El OCR no escribe nada: devuelve una propuesta. Quien la aplica es el cotizador,
// sobre los borradores de montos, y Alexis sigue revisando y apretando guardar.

import { iaAPI } from '../../api';
import { calzarMontos } from './pantallazoMontos';

/** Tipos que acepta la cola; el componente valida lo mismo antes de llegar acá. */
export const MIMES = ['image/png', 'image/jpeg', 'image/webp'];

/** Imagen → base64 sin el prefijo `data:`, que es lo que espera el backend. */
export const archivoABase64 = (file) =>
  new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
    lector.onload = () => {
      const texto = String(lector.result || '');
      const coma = texto.indexOf(',');
      if (coma < 0) {
        reject(new Error('No se pudo leer el archivo'));
        return;
      }
      resolve(texto.slice(coma + 1));
    };
    lector.readAsDataURL(file);
  });

/**
 * Saca el array de filas de la respuesta. El modelo responde con un bloque ```json,
 * pero no se puede confiar en que venga perfecto: si no se puede parsear se devuelve
 * vacío en vez de reventar la pantalla.
 */
export const extraerFilas = (texto) => {
  const contenido = String(texto || '');
  const bloque = contenido.match(/```(?:json)?\s*([[{][\s\S]*?)```/i);
  const crudo = bloque ? bloque[1] : contenido.match(/\[[\s\S]*\]/)?.[0];
  if (!crudo) return [];
  let datos;
  try {
    datos = JSON.parse(crudo.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      sku: String(f.sku ?? '').trim(),
      mpn: String(f.mpn ?? '').trim(),
      descripcion: String(f.descripcion ?? f.desc ?? '').trim(),
      monto: f.monto ?? null
    }));
};

/** Las líneas que viajan en el prompt: solo lo que sirve para identificar el producto. */
const lineasParaPrompt = (lineas) =>
  (lineas || []).map((l) => ({
    sku: String(l?.sku || ''),
    mpn: String(l?.mpn || ''),
    desc: String(l?.desc || '')
  }));

const TEXTO_CAMPO = {
  intcomex: 'Lee la OC adjunta y devuelve el precio de venta de cada línea.',
  axis: 'Lee la planilla de costos de Axis adjunta y devuelve el costo de cada línea.'
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Manda la imagen y espera el resultado.
 *
 * `api` y `dormir` se inyectan para los tests. `limiteMs` corta la espera: la miniPC
 * puede estar apagada, y en ese caso el trabajo se queda en la cola para siempre.
 */
export const leerPantallazo = async ({
  file,
  campo,
  marca = 'AXIS',
  lineas = [],
  api = iaAPI,
  dormir = espera,
  intervaloMs = 2000,
  limiteMs = 180000
}) => {
  const datos = await archivoABase64(file);
  const { id } = await api.iniciar({
    marca,
    mensajes: [{ role: 'user', content: TEXTO_CAMPO[campo] || TEXTO_CAMPO.intcomex }],
    pantallazo: {
      datos,
      mime: file.type,
      campo,
      lineas: lineasParaPrompt(lineas)
    }
  });

  const hasta = Date.now() + limiteMs;
  for (;;) {
    if (Date.now() > hasta) {
      // No dejamos el trabajo colgado ocupando la cola, que atiende de a uno.
      await api.cancelar?.(id).catch(() => {});
      throw new Error(
        'La miniPC no respondió a tiempo. Revisa que el agente esté corriendo.'
      );
    }
    await dormir(intervaloMs);
    const consulta = await api.obtener(id);
    if (consulta.estado === 'en_curso') continue;
    if (consulta.estado === 'error') {
      throw new Error(consulta.error || 'No se pudo leer el pantallazo');
    }
    const filas = extraerFilas(consulta.texto);
    return { filas, ...calzarMontos({ filas, lineas }) };
  }
};
