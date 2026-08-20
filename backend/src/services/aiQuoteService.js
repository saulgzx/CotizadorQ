// Interpretación de requerimientos en texto libre -> líneas de cotización.
//
// El modelo NUNCA decide precios: solo empareja texto del cliente contra el catálogo
// y devuelve producto_id + cantidad. El precio lo sigue calculando el backend en
// POST /api/cotizaciones a partir de la tabla productos, igual que hoy.
//
// La feature es opcional: sin ANTHROPIC_API_KEY el servicio queda deshabilitado y
// el endpoint responde 503 sin romper nada más.
//
// Se llama la API REST de Anthropic con el fetch global de Node 18 en vez de usar
// @anthropic-ai/sdk a propósito: agregar el SDK obliga a regenerar package-lock.json
// y el despliegue (Railway/Vercel) corre npm ci, que falla si el lock esta
// desincronizado. Sin dependencia nueva, el lock no se toca.
const { logger } = require('../utils/logger');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const MODEL = (process.env.ANTHROPIC_MODEL || 'claude-opus-5').trim();
const MAX_CATALOG_ITEMS = parseInt(process.env.AI_QUOTE_MAX_CATALOG || '4000', 10);
const MAX_PROMPT_CHARS = parseInt(process.env.AI_QUOTE_MAX_PROMPT_CHARS || '4000', 10);
const TIMEOUT_MS = parseInt(process.env.AI_QUOTE_TIMEOUT_MS || '90000', 10);
const MAX_RETRIES = 2;
const MAX_LINE_QTY = 9999;

const isEnabled = () => Boolean((process.env.ANTHROPIC_API_KEY || '').trim());

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST a /v1/messages con reintentos en 429 y 5xx. Los 4xx restantes son errores
// de nuestra request: no se reintentan.
const llamarApi = async (payload) => {
  let ultimoError = null;

  for (let intento = 0; intento <= MAX_RETRIES; intento += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': (process.env.ANTHROPIC_API_KEY || '').trim(),
          'anthropic-version': API_VERSION
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (response.ok) return response.json();

      const detalle = await response.text().catch(() => '');
      const reintentable = response.status === 429 || response.status >= 500;

      logger.warn(
        { event: 'ai_quote_api_error', status: response.status, intento, reintentable },
        'Error llamando a la API de Anthropic'
      );

      if (!reintentable || intento === MAX_RETRIES) {
        const error = new Error(
          response.status === 429
            ? 'El asistente esta saturado. Intenta en unos minutos.'
            : 'El asistente no esta disponible en este momento.'
        );
        error.status = response.status === 429 ? 429 : 502;
        error.detalle = detalle.slice(0, 500);
        throw error;
      }
    } catch (error) {
      if (error?.status) throw error;
      // Abort o fallo de red: reintentable.
      ultimoError = error;
      logger.warn(
        { event: 'ai_quote_api_network_error', intento, mensaje: error?.message },
        'Fallo de red llamando a la API de Anthropic'
      );
      if (intento === MAX_RETRIES) break;
    } finally {
      clearTimeout(timer);
    }

    await esperar(500 * 2 ** intento);
  }

  const error = new Error('No se pudo contactar al asistente.');
  error.status = 504;
  error.detalle = ultimoError?.message || '';
  throw error;
};

// Instrucción estable. Va primero y se mantiene byte a byte igual entre requests
// para no invalidar el prefijo cacheado.
const SYSTEM_INSTRUCCION = [
  'Eres un asistente de preventa que arma cotizaciones para un distribuidor de',
  'infraestructura TI (QNAP y AXIS principalmente).',
  '',
  'Recibes el requerimiento de un cliente en texto libre y lo conviertes en líneas',
  'de cotización usando EXCLUSIVAMENTE los productos del catálogo que se te entrega.',
  '',
  'Reglas:',
  '- Usa únicamente ids que aparezcan en el catálogo. No inventes ids ni SKUs.',
  '- Si el cliente pide algo que no está en el catálogo, no lo fuerces contra un',
  '  producto parecido: repórtalo en sin_coincidencia.',
  '- Si el texto no indica cantidad, asume 1.',
  '- Marca confianza "alta" solo cuando el SKU o el MPN coinciden de forma explícita.',
  '  Usa "media" cuando la coincidencia es por descripción y "baja" cuando es una',
  '  inferencia o una equivalencia sugerida.',
  '- En razon explica en una frase corta por qué elegiste ese producto, en español.',
  '- No menciones ni estimes precios: no los conoces y no forman parte de tu tarea.'
].join('\n');

const HERRAMIENTA = {
  name: 'proponer_lineas_cotizacion',
  description: 'Devuelve las líneas de cotización propuestas a partir del requerimiento del cliente.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      lineas: {
        type: 'array',
        description: 'Productos del catálogo que responden al requerimiento.',
        items: {
          type: 'object',
          properties: {
            producto_id: { type: 'integer', description: 'id exacto tomado del catálogo.' },
            cantidad: { type: 'integer', description: 'Unidades solicitadas. Mínimo 1.' },
            confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
            razon: { type: 'string', description: 'Justificación breve en español.' }
          },
          required: ['producto_id', 'cantidad', 'confianza', 'razon'],
          additionalProperties: false
        }
      },
      sin_coincidencia: {
        type: 'array',
        description: 'Partes del requerimiento que no se pudieron mapear al catálogo.',
        items: {
          type: 'object',
          properties: {
            texto: { type: 'string' },
            motivo: { type: 'string' }
          },
          required: ['texto', 'motivo'],
          additionalProperties: false
        }
      },
      notas: {
        type: 'string',
        description: 'Observaciones para el vendedor. Cadena vacía si no hay nada que destacar.'
      }
    },
    required: ['lineas', 'sin_coincidencia', 'notas'],
    additionalProperties: false
  }
};

const limpiar = (value) => (value == null ? '' : String(value).replace(/[\r\n|]+/g, ' ').trim());

// Una línea por producto. Formato compacto y determinista: el orden lo fija el
// caller (por id) para que el texto no cambie entre requests y el cache sirva.
const construirCatalogo = (productos) => {
  const filas = productos.slice(0, MAX_CATALOG_ITEMS).map((p) => [
    p.id,
    limpiar(p.origen) || 'QNAP',
    limpiar(p.marca),
    limpiar(p.sku),
    limpiar(p.mpn),
    limpiar(p.descripcion)
  ].join(' | '));

  return [
    'CATÁLOGO DISPONIBLE',
    'Formato: id | origen | marca | sku | mpn | descripción',
    '',
    ...filas
  ].join('\n');
};

const normalizarLineas = (input, productosPorId) => {
  const lineas = [];
  const descartadas = [];
  const vistos = new Set();

  for (const linea of Array.isArray(input?.lineas) ? input.lineas : []) {
    const productoId = Number(linea?.producto_id);
    const producto = productosPorId.get(productoId);

    // El modelo puede alucinar un id pese al schema. Se descarta, no se corrige.
    if (!producto) {
      descartadas.push({ producto_id: linea?.producto_id ?? null, razon: 'id fuera del catálogo' });
      continue;
    }
    if (vistos.has(productoId)) continue;
    vistos.add(productoId);

    const cantidadRaw = Number(linea?.cantidad);
    const cantidad = Number.isFinite(cantidadRaw)
      ? Math.min(Math.max(Math.trunc(cantidadRaw), 1), MAX_LINE_QTY)
      : 1;

    lineas.push({
      producto_id: productoId,
      cantidad,
      confianza: ['alta', 'media', 'baja'].includes(linea?.confianza) ? linea.confianza : 'baja',
      razon: limpiar(linea?.razon).slice(0, 300),
      // Se devuelve el producto real de la BD, no lo que dijo el modelo.
      sku: producto.sku || '',
      mpn: producto.mpn || '',
      marca: producto.marca || '',
      origen: producto.origen || 'QNAP',
      descripcion: producto.descripcion || ''
    });
  }

  const sinCoincidencia = (Array.isArray(input?.sin_coincidencia) ? input.sin_coincidencia : [])
    .map((item) => ({
      texto: limpiar(item?.texto).slice(0, 300),
      motivo: limpiar(item?.motivo).slice(0, 300)
    }))
    .filter((item) => item.texto);

  return { lineas, sinCoincidencia, descartadas, notas: limpiar(input?.notas).slice(0, 1000) };
};

/**
 * Interpreta un requerimiento en texto libre contra el catálogo recibido.
 *
 * @param {string} texto Requerimiento del cliente.
 * @param {Array<object>} productos Filas de productos activos (id, origen, marca, sku, mpn, descripcion).
 * @returns {Promise<{lineas: Array, sinCoincidencia: Array, notas: string, uso: object}>}
 */
const interpretarRequerimiento = async (texto, productos) => {
  if (!isEnabled()) {
    const error = new Error('Asistente de cotización no configurado');
    error.status = 503;
    throw error;
  }

  const requerimiento = limpiar(texto);
  if (!requerimiento) {
    const error = new Error('Texto del requerimiento vacío');
    error.status = 400;
    throw error;
  }

  const catalogo = [...productos].sort((a, b) => Number(a.id) - Number(b.id));
  if (catalogo.length === 0) {
    const error = new Error('No hay productos activos en el catálogo');
    error.status = 409;
    throw error;
  }

  const productosPorId = new Map(catalogo.map((p) => [Number(p.id), p]));

  const response = await llamarApi({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: [
      { type: 'text', text: SYSTEM_INSTRUCCION },
      // El catálogo es la parte grande y estable: se cachea para que las siguientes
      // interpretaciones solo paguen el texto del requerimiento.
      { type: 'text', text: construirCatalogo(catalogo), cache_control: { type: 'ephemeral' } }
    ],
    tools: [HERRAMIENTA],
    tool_choice: { type: 'tool', name: HERRAMIENTA.name },
    messages: [
      {
        role: 'user',
        content: `Requerimiento del cliente:\n\n${requerimiento.slice(0, MAX_PROMPT_CHARS)}`
      }
    ]
  });

  if (response.stop_reason === 'refusal') {
    logger.warn(
      { event: 'ai_quote_refusal', category: response.stop_details?.category || null },
      'El modelo declinó interpretar el requerimiento'
    );
    const error = new Error('No se pudo interpretar el requerimiento');
    error.status = 422;
    throw error;
  }

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    const error = new Error('Respuesta del modelo sin líneas de cotización');
    error.status = 502;
    throw error;
  }

  const resultado = normalizarLineas(toolUse.input, productosPorId);

  if (resultado.descartadas.length > 0) {
    logger.warn(
      { event: 'ai_quote_hallucinated_ids', descartadas: resultado.descartadas },
      'Se descartaron líneas con ids fuera del catálogo'
    );
  }

  return {
    lineas: resultado.lineas,
    sinCoincidencia: resultado.sinCoincidencia,
    notas: resultado.notas,
    uso: {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      cache_read_input_tokens: response.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: response.usage?.cache_creation_input_tokens ?? 0
    }
  };
};

module.exports = { interpretarRequerimiento, isEnabled, MODEL };
