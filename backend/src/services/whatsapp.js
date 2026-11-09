// Canal WhatsApp del asistente IA (WhatsApp Business Cloud API de Meta).
//
// Meta envia cada mensaje al webhook del backend; el mensaje entra a la misma
// cola del asistente y, cuando el agente responde, la respuesta vuelve por
// WhatsApp. Solo se atienden los numeros autorizados.

const crypto = require('crypto');

const MAX_CHARS_WHATSAPP = 3500; // el limite de Meta es 4096 por mensaje
const CONVERSACION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TURNOS = 20;

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

const leerConfigWhatsApp = (env = process.env) => ({
  token: String(env.WHATSAPP_TOKEN || '').trim(),
  phoneNumberId: String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
  verifyToken: String(env.WHATSAPP_VERIFY_TOKEN || '').trim(),
  appSecret: String(env.WHATSAPP_APP_SECRET || '').trim(),
  graphVersion: String(env.WHATSAPP_GRAPH_VERSION || 'v23.0').trim(),
  numeros: String(env.WHATSAPP_NUMEROS || '')
    .split(',')
    .map(soloDigitos)
    .filter(Boolean)
});

const whatsappHabilitado = (c) =>
  !!(
    c.token &&
    c.phoneNumberId &&
    c.verifyToken &&
    c.appSecret &&
    c.numeros.length
  );

/** Parte un texto largo en trozos que WhatsApp acepta, cortando en saltos de linea. */
const partirMensaje = (texto, max = MAX_CHARS_WHATSAPP) => {
  const partes = [];
  let resto = String(texto || '').trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(' ', max);
    if (corte < max * 0.5) corte = max;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
};

const firmaValida = (appSecret, cuerpo, cabecera) => {
  if (!appSecret || !cuerpo || !cabecera) return false;
  const esperado = `sha256=${crypto.createHmac('sha256', appSecret).update(cuerpo).digest('hex')}`;
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(cabecera));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const AYUDA = [
  '*Asistente de preventa MyQuote*',
  '- Escribe el requerimiento tal cual (puedes pegar el correo).',
  '- Empieza con *axis* o *qnap* para forzar la marca; si no, la IA la deduce.',
  '- Sigue escribiendo para ajustar la última respuesta.',
  '- *nueva*: empieza una conversación nueva.'
].join('\n');

const crearWhatsApp = ({
  config = leerConfigWhatsApp(),
  gestor,
  logger = console,
  fetchImpl = fetch,
  ahora = () => Date.now()
}) => {
  const conversaciones = new Map(); // numero -> { marca, mensajes, actualizada, ocupada }
  const vistos = new Map(); // id de mensaje de Meta -> hora (Meta reintenta)

  const enviar = async (numero, texto) => {
    for (const parte of partirMensaje(texto)) {
      const res = await fetchImpl(
        `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: numero,
            type: 'text',
            text: { body: parte, preview_url: false }
          })
        }
      );
      if (!res.ok) {
        const detalle = await res.text().catch(() => '');
        logger.error?.(
          {
            event: 'whatsapp_envio_error',
            status: res.status,
            detalle: detalle.slice(0, 300)
          },
          'No se pudo enviar el WhatsApp'
        );
        return false;
      }
    }
    return true;
  };

  const conversacion = (numero) => {
    const c = conversaciones.get(numero);
    if (c && c.actualizada > ahora() - CONVERSACION_TTL_MS) return c;
    const nueva = {
      marca: null,
      mensajes: [],
      actualizada: ahora(),
      ocupada: false
    };
    conversaciones.set(numero, nueva);
    return nueva;
  };

  const atender = async (numero, texto) => {
    const limpio = texto.trim();
    const comando = limpio.toLowerCase();
    if (['nueva', 'nuevo', 'reset', 'reiniciar'].includes(comando)) {
      conversaciones.delete(numero);
      return enviar(
        numero,
        'Listo, conversación nueva. Envíame el requerimiento.'
      );
    }
    if (['ayuda', 'help', '?'].includes(comando)) return enviar(numero, AYUDA);

    let conv = conversacion(numero);
    if (conv.ocupada)
      return enviar(
        numero,
        'Sigo trabajando en tu consulta anterior. Te aviso apenas termine.'
      );

    // "axis ..." o "qnap ..." al inicio: conversacion nueva con esa marca.
    const marcaPedida =
      /^(axis|qnap)\b/i.exec(limpio)?.[1]?.toUpperCase() || null;
    if (marcaPedida) {
      conversaciones.delete(numero);
      conv = conversacion(numero);
      conv.marca = marcaPedida;
    }
    if (!conv.marca && gestor.modo?.() === 'api') {
      return enviar(
        numero,
        'Empieza el mensaje con *axis* o *qnap* para saber qué skill usar.'
      );
    }
    if (conv.mensajes.length >= MAX_TURNOS * 2) {
      conversaciones.delete(numero);
      conv = conversacion(numero);
    }
    const mensajes = [
      ...conv.mensajes,
      { role: 'user', content: limpio.slice(0, 30000) }
    ];
    conv.ocupada = true;
    conv.actualizada = ahora();

    try {
      gestor.iniciar({
        usuarioId: `wa:${numero}`,
        canal: 'whatsapp',
        entrada: { marca: conv.marca, mensajes },
        alTerminar: async (resultado) => {
          conv.ocupada = false;
          conv.actualizada = ahora();
          if (resultado.estado === 'lista') {
            const respuesta =
              resultado.contenido?.map((b) => b.text || '').join('\n\n') ||
              resultado.texto;
            conv.mensajes = [
              ...mensajes,
              {
                role: 'assistant',
                content: [{ type: 'text', text: respuesta }]
              }
            ];
            await enviar(numero, respuesta || 'La IA no devolvió texto.');
          } else if (resultado.estado === 'error') {
            await enviar(
              numero,
              `No pude completar la consulta. ${resultado.error || ''}`.trim()
            );
          }
        }
      });
    } catch (error) {
      conv.ocupada = false;
      return enviar(numero, error.message || 'No pude iniciar la consulta.');
    }
    const agente = gestor.estadoAgente?.();
    const aviso =
      gestor.modo?.() === 'agente' && agente && !agente.conectado
        ? 'Recibido. Ojo: el servidor IA de casa aparece desconectado; la consulta espera 5 minutos en cola.'
        : 'Recibido, consultando precios y stock…';
    return enviar(numero, aviso);
  };

  return {
    habilitado: () => whatsappHabilitado(config),

    /** GET de verificacion de Meta: devuelve el challenge o null. */
    verificar(query) {
      if (
        query?.['hub.mode'] === 'subscribe' &&
        config.verifyToken &&
        query['hub.verify_token'] === config.verifyToken
      ) {
        return String(query['hub.challenge'] || '');
      }
      return null;
    },

    firmaValida: (cuerpo, cabecera) =>
      firmaValida(config.appSecret, cuerpo, cabecera),

    /** Procesa el POST de Meta. No espera a la IA: responde rapido y avisa por WhatsApp. */
    async procesar(body) {
      const limite = ahora() - 24 * 60 * 60 * 1000;
      for (const [id, t] of vistos) if (t < limite) vistos.delete(id);
      const tareas = [];
      for (const entry of body?.entry || []) {
        for (const change of entry?.changes || []) {
          for (const msg of change?.value?.messages || []) {
            if (!msg?.id || vistos.has(msg.id)) continue;
            vistos.set(msg.id, ahora());
            const numero = soloDigitos(msg.from);
            if (!config.numeros.includes(numero)) {
              logger.warn?.(
                { event: 'whatsapp_numero_no_autorizado' },
                'Mensaje de un numero no autorizado'
              );
              continue;
            }
            if (msg.type !== 'text' || !msg.text?.body) {
              tareas.push(
                enviar(
                  numero,
                  'Por ahora solo entiendo mensajes de texto. Pega el requerimiento como texto.'
                )
              );
              continue;
            }
            tareas.push(atender(numero, msg.text.body));
          }
        }
      }
      await Promise.all(tareas);
    }
  };
};

module.exports = {
  leerConfigWhatsApp,
  whatsappHabilitado,
  partirMensaje,
  firmaValida,
  crearWhatsApp
};
