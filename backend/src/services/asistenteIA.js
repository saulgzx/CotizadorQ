// Asistente IA de preventa (Axis / QNAP).
//
// El backend llama a la API de Claude con las skills de preventa como
// instrucciones de sistema. Precios, stock y plazos salen del servidor MCP de
// MyQuote (el mismo conector que se usa desde claude.ai), conectado del lado de
// Anthropic. Solo se habilitan sus herramientas de lectura: desde la web nunca
// se graba una cotizacion.
//
// Las consultas corren en segundo plano y el navegador consulta su avance: una
// respuesta con varias busquedas puede tardar minutos y el proxy de Vercel
// corta los pedidos largos.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILLS_DIR = path.join(__dirname, '..', 'ia', 'skills');

const MARCAS = {
  AXIS: { skill: 'preventa-axis', nombre: 'Axis', dominio: 'axis.com' },
  QNAP: { skill: 'preventa-qnap', nombre: 'QNAP', dominio: 'qnap.com' }
};

const MCP_SERVER_NAME = 'myquote';
// Solo lectura. generar_cotizacion, emitir_pdf y cotizar_y_emitir quedan apagadas.
const HERRAMIENTAS_MYQUOTE = [
  'buscar_productos',
  'consultar_producto',
  'simular_cotizacion'
];

const MARCADOR_LISTA = 'LISTA COTIZADORQ';
const MAX_MENSAJES = 40;
const MAX_CHARS_MENSAJE = 30000;
const MAX_CONTINUACIONES = 6;
const JOB_TTL_MS = 30 * 60 * 1000;

const leerConfig = (env = process.env) => ({
  apiKey: String(env.ANTHROPIC_API_KEY || '').trim(),
  model: String(env.IA_MODEL || 'claude-opus-5-5').trim(),
  effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(env.IA_EFFORT)
    ? env.IA_EFFORT
    : 'medium',
  mcpUrl: String(env.MYQUOTE_MCP_URL || '').trim(),
  mcpToken: String(env.MYQUOTE_MCP_TOKEN || '').trim(),
  maxTokens: Number(env.IA_MAX_TOKENS) > 0 ? Number(env.IA_MAX_TOKENS) : 32000
});

const faltantes = (config) =>
  [
    !config.apiKey && 'ANTHROPIC_API_KEY',
    !config.mcpUrl && 'MYQUOTE_MCP_URL',
    !config.mcpToken && 'MYQUOTE_MCP_TOKEN'
  ].filter(Boolean);

// --- Instrucciones -----------------------------------------------------------

const cacheSkills = new Map();

const leerSkill = (skill) => {
  if (cacheSkills.has(skill)) return cacheSkills.get(skill);
  const dir = path.join(SKILLS_DIR, skill);
  const principal = fs
    .readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
    .replace(/^---[\s\S]*?---\s*/, '');
  const refsDir = path.join(dir, 'references');
  const refs = fs.existsSync(refsDir)
    ? fs
        .readdirSync(refsDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map(
          (f) =>
            `<referencia archivo="references/${f}">\n${fs.readFileSync(path.join(refsDir, f), 'utf8').trim()}\n</referencia>`
        )
    : [];
  const texto = [
    `<skill nombre="${skill}">`,
    principal.trim(),
    '</skill>',
    ...refs
  ].join('\n\n');
  cacheSkills.set(skill, texto);
  return texto;
};

const construirSistema = (marca) => {
  const m = MARCAS[marca];
  const entorno = [
    `Estás dentro de MyQuote, la app web de cotización de Intcomex Chile, en el tab Asistente IA.`,
    `Aplica la skill ${m.skill} que sigue, incluidas sus referencias, que ya están cargadas abajo: no necesitas abrirlas.`,
    `El conector MyQuote está disponible con buscar_productos, consultar_producto y simular_cotizacion. Desde aquí no se graban cotizaciones: si piden guardar, emitir PDF o enviar, indica que se hace desde el Cotizador de MyQuote.`,
    `Para especificaciones técnicas usa web_search y web_fetch, que solo alcanzan ${m.dominio}.`,
    `La respuesta se muestra como Markdown. Entrega primero «A — Preview para pegar» y luego «B — Control interno», como pide la skill. No envuelvas el preview en un bloque de código: la tabla debe ir como tabla Markdown.`,
    `Al final, después del bloque B, agrega un bloque de código con el título ${MARCADOR_LISTA}: una línea por producto cotizado con el SKU de Intcomex (o el MPN si el SKU es "To Create"), un tab y la cantidad. Sin encabezados ni precios. Si no cotizaste productos, omite el bloque.`
  ].join('\n');
  return `${entorno}\n\n${leerSkill(m.skill)}`;
};

// --- Validacion de la conversacion --------------------------------------------

const errorValidacion = (mensaje) =>
  Object.assign(new Error(mensaje), { status: 400 });

/**
 * La conversacion la guarda el navegador. Las respuestas previas de la IA
 * vuelven tal cual (bloques incluidos); lo nuevo del usuario es siempre texto.
 */
const validarEntrada = (body) => {
  const marca = String(body?.marca || '').toUpperCase();
  if (!MARCAS[marca]) throw errorValidacion('Marca invalida: usa AXIS o QNAP');
  const mensajes = body?.mensajes;
  if (!Array.isArray(mensajes) || mensajes.length === 0)
    throw errorValidacion('La conversacion esta vacia');
  if (mensajes.length > MAX_MENSAJES)
    throw errorValidacion(
      'La conversacion es demasiado larga: empieza una nueva'
    );
  mensajes.forEach((m, i) => {
    const esperado = i % 2 === 0 ? 'user' : 'assistant';
    if (m?.role !== esperado) throw errorValidacion('Conversacion mal formada');
    if (m.role === 'user') {
      if (typeof m.content !== 'string' || !m.content.trim())
        throw errorValidacion('Mensaje vacio');
      if (m.content.length > MAX_CHARS_MENSAJE)
        throw errorValidacion('Mensaje demasiado largo');
    } else if (!Array.isArray(m.content)) {
      throw errorValidacion('Conversacion mal formada');
    }
  });
  if (mensajes[mensajes.length - 1].role !== 'user')
    throw errorValidacion('Falta el mensaje del usuario');
  return {
    marca,
    mensajes: mensajes.map((m) => ({ role: m.role, content: m.content }))
  };
};

// --- Pedido a la API ----------------------------------------------------------

const construirParametros = ({ config, marca, mensajes }) => {
  const m = MARCAS[marca];
  const configs = Object.fromEntries(
    HERRAMIENTAS_MYQUOTE.map((h) => [h, { enabled: true }])
  );
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.effort },
    betas: ['mcp-client-2025-11-20', 'server-side-fallback-2026-07-01'],
    // Si los filtros de seguridad rechazan el pedido, Anthropic lo reintenta en el modelo recomendado.
    fallbacks: 'default',
    system: [
      {
        type: 'text',
        text: construirSistema(marca),
        cache_control: { type: 'ephemeral' }
      }
    ],
    mcp_servers: [
      {
        type: 'url',
        url: config.mcpUrl,
        name: MCP_SERVER_NAME,
        authorization_token: config.mcpToken
      }
    ],
    tools: [
      {
        type: 'mcp_toolset',
        mcp_server_name: MCP_SERVER_NAME,
        default_config: { enabled: false },
        configs
      },
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 5,
        allowed_domains: [m.dominio]
      },
      {
        type: 'web_fetch_20260209',
        name: 'web_fetch',
        max_uses: 8,
        allowed_domains: [m.dominio]
      }
    ],
    messages: mensajes
  };
};

// Texto corto para mostrar mientras la IA usa una herramienta.
const describirHerramienta = (bloque) => {
  const input = bloque?.input || {};
  const detalle = input.sku || input.texto || input.query || input.url || '';
  const nombres = {
    buscar_productos: 'Buscando en MyQuote',
    consultar_producto: 'Consultando precio y stock',
    simular_cotizacion: 'Simulando la cotización',
    web_search: 'Buscando fichas técnicas',
    web_fetch: 'Leyendo ficha técnica'
  };
  const base =
    nombres[bloque?.name] || `Usando ${bloque?.name || 'herramienta'}`;
  return detalle ? `${base}: ${String(detalle).slice(0, 80)}` : base;
};

// --- Consultas en segundo plano ---------------------------------------------

const crearGestorConsultas = ({
  crearCliente,
  config = leerConfig(),
  logger = console,
  ahora = () => Date.now()
}) => {
  const consultas = new Map();

  const limpiar = () => {
    const limite = ahora() - JOB_TTL_MS;
    for (const [id, c] of consultas)
      if (c.actualizada < limite) consultas.delete(id);
  };

  const vista = (c) => ({
    id: c.id,
    estado: c.estado,
    texto: c.texto,
    pasos: c.pasos,
    contenido: c.estado === 'lista' ? c.contenido : undefined,
    error: c.error,
    uso: c.uso
  });

  const ejecutar = async (c, { marca, mensajes }) => {
    const cliente = crearCliente(config);
    const historial = [...mensajes];
    const contenido = [];
    try {
      for (let vuelta = 0; vuelta <= MAX_CONTINUACIONES; vuelta += 1) {
        if (c.cancelada) return;
        const stream = cliente.beta.messages.stream(
          construirParametros({ config, marca, mensajes: historial })
        );
        c.stream = stream;
        stream.on('streamEvent', (evento) => {
          c.actualizada = ahora();
          if (evento.type === 'content_block_start') {
            const b = evento.content_block;
            if (b?.type === 'mcp_tool_use' || b?.type === 'server_tool_use')
              c.pasos.push(describirHerramienta(b));
            if (b?.type === 'text' && c.texto && !c.texto.endsWith('\n'))
              c.texto += '\n\n';
          } else if (
            evento.type === 'content_block_delta' &&
            evento.delta?.type === 'text_delta'
          ) {
            c.texto += evento.delta.text;
          }
        });
        const mensaje = await stream.finalMessage();
        contenido.push(...mensaje.content);
        c.uso = {
          entrada: (c.uso?.entrada || 0) + (mensaje.usage?.input_tokens || 0),
          salida: (c.uso?.salida || 0) + (mensaje.usage?.output_tokens || 0),
          cache:
            (c.uso?.cache || 0) + (mensaje.usage?.cache_read_input_tokens || 0)
        };
        if (mensaje.stop_reason === 'refusal') {
          throw Object.assign(
            new Error(
              'La IA no pudo responder este requerimiento. Reformúlalo e intenta de nuevo.'
            ),
            { publico: true }
          );
        }
        if (mensaje.stop_reason !== 'pause_turn') break;
        // Turno pausado por herramientas del servidor: se continua con lo ya generado.
        historial.splice(mensajes.length, historial.length - mensajes.length, {
          role: 'assistant',
          content: [...contenido]
        });
      }
      c.contenido = contenido;
      c.estado = 'lista';
    } catch (error) {
      if (c.cancelada) return;
      c.estado = 'error';
      c.error = error.publico ? error.message : mensajeError(error);
      logger.error?.(
        {
          event: 'ia_consulta_error',
          status: error?.status,
          tipo: error?.name
        },
        'Fallo la consulta al asistente IA'
      );
    } finally {
      c.stream = null;
      c.actualizada = ahora();
    }
  };

  return {
    iniciar({ usuarioId, entrada }) {
      limpiar();
      const enCurso = [...consultas.values()].filter(
        (c) => c.usuarioId === usuarioId && c.estado === 'en_curso'
      );
      if (enCurso.length >= 2)
        throw Object.assign(
          new Error('Ya tienes consultas en curso: espera que terminen'),
          { status: 429 }
        );
      const c = {
        id: crypto.randomUUID(),
        usuarioId,
        estado: 'en_curso',
        texto: '',
        pasos: [],
        contenido: null,
        error: null,
        uso: null,
        cancelada: false,
        actualizada: ahora()
      };
      consultas.set(c.id, c);
      ejecutar(c, entrada);
      return vista(c);
    },
    obtener({ usuarioId, id }) {
      const c = consultas.get(id);
      if (!c || c.usuarioId !== usuarioId) return null;
      return vista(c);
    },
    cancelar({ usuarioId, id }) {
      const c = consultas.get(id);
      if (!c || c.usuarioId !== usuarioId) return false;
      c.cancelada = true;
      c.estado = 'cancelada';
      c.stream?.abort();
      return true;
    }
  };
};

const mensajeError = (error) => {
  const status = error?.status;
  if (status === 401 || status === 403)
    return 'La API key de Anthropic no es válida o no tiene permisos.';
  if (status === 429)
    return 'Se alcanzó el límite de uso de la API de Anthropic. Intenta en unos minutos.';
  if (status === 529 || status >= 500)
    return 'La API de Anthropic está saturada. Intenta en unos minutos.';
  if (status === 400)
    return 'La API rechazó el pedido. Revisa la configuración del asistente (conector MyQuote).';
  return 'No se pudo completar la consulta. Intenta de nuevo.';
};

module.exports = {
  MARCAS,
  HERRAMIENTAS_MYQUOTE,
  leerConfig,
  faltantes,
  construirSistema,
  validarEntrada,
  construirParametros,
  describirHerramienta,
  crearGestorConsultas
};
