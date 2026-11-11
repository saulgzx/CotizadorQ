// Asistente IA de preventa (Axis / QNAP).
//
// Dos modos:
// - "agente" (IA_AGENTE_TOKEN definido): las consultas quedan en una cola y
//   las resuelve el agente que corre en el equipo del usuario (agente-ia/), con
//   Claude Code, su suscripcion, sus skills y su conector MyQuote. El agente
//   solo hace conexiones salientes: pide trabajo y devuelve el resultado.
// - "api": el backend llama a la API de Claude con las skills como
//   instrucciones y el conector MyQuote del lado de Anthropic (requiere
//   ANTHROPIC_API_KEY y se cobra por uso).
//
// En ambos casos la consulta corre en segundo plano y quien la pidio (el tab
// web o el webhook de WhatsApp) consulta su avance o recibe el resultado.

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
  'simular_cotizacion',
  'calcular_precios'
];

const MARCADOR_LISTA = 'LISTA COTIZADORQ';
const MAX_MENSAJES = 40;
const MAX_CHARS_MENSAJE = 30000;
const MAX_CONTINUACIONES = 6;
const JOB_TTL_MS = 30 * 60 * 1000;

const leerConfig = (env = process.env) => ({
  // Sin comillas ni espacios: es comun pegarla asi en Railway.
  apiKey: String(env.ANTHROPIC_API_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim(),
  model: String(env.IA_MODEL || 'claude-opus-5-5').trim(),
  effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(env.IA_EFFORT)
    ? env.IA_EFFORT
    : 'medium',
  mcpUrl: String(env.MYQUOTE_MCP_URL || '').trim(),
  mcpToken: String(env.MYQUOTE_MCP_TOKEN || '').trim(),
  maxTokens: Number(env.IA_MAX_TOKENS) > 0 ? Number(env.IA_MAX_TOKENS) : 32000,
  agenteToken: String(env.IA_AGENTE_TOKEN || '').trim(),
  // Usuarios de MyQuote que pueden usar el asistente (coma-separados). Vacio: todos los admin.
  usuarios: String(env.IA_USUARIOS || '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean)
});

const modo = (config) => (config.agenteToken ? 'agente' : 'api');

const faltantes = (config) =>
  modo(config) === 'agente'
    ? []
    : [
        !config.apiKey &&
          'ANTHROPIC_API_KEY (o IA_AGENTE_TOKEN para usar el agente)',
        !config.mcpUrl && 'MYQUOTE_MCP_URL',
        !config.mcpToken && 'MYQUOTE_MCP_TOKEN'
      ].filter(Boolean);

const usuarioPermitido = (config, usuario) =>
  config.usuarios.length === 0 ||
  config.usuarios.includes(String(usuario || '').toLowerCase());

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

// --- Instrucciones para el agente (Claude Code ya tiene las skills) -----------

const textoDeContenido = (contenido) =>
  (Array.isArray(contenido) ? contenido : [])
    .filter((b) => b?.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n\n');

const FORMATO_WEB = [
  'La respuesta se muestra como Markdown en MyQuote. Entrega primero «A — Preview para pegar» y luego «B — Control interno», como pide la skill. No envuelvas el preview en un bloque de código: la tabla va como tabla Markdown.',
  `Al final, después del bloque B, agrega un bloque de código con el título ${MARCADOR_LISTA}: una línea por producto cotizado con el SKU de Intcomex (o el MPN si el SKU es "To Create"), un tab y la cantidad. Sin encabezados ni precios. Si no cotizaste productos, omite el bloque.`
].join('\n');

const FORMATO_WHATSAPP = [
  'La respuesta se lee en WhatsApp, que no muestra tablas ni títulos Markdown. Usa *negrita* con un asterisco y listas con guion.',
  'Entrega el preview como una línea por producto: «Cant. x SKU · MPN · Descripción · P. Unit. · P. Total · Entrega». Después, el control interno resumido en pocas líneas.',
  'Sé breve: es para leer en el teléfono.'
].join('\n');

/** Texto completo que el agente le pasa a Claude Code. */
const construirPromptAgente = ({ marca, mensajes, canal = 'web' }) => {
  const m = MARCAS[marca];
  const skill = m
    ? `Usa la skill ${m.skill}.`
    : 'Usa la skill de preventa que corresponda: preventa-axis para Axis o videovigilancia, preventa-qnap para QNAP o almacenamiento. Si no se puede saber, pregunta.';
  const instrucciones = [
    '<instrucciones_myquote>',
    `Respondes un requerimiento de preventa recibido por ${canal === 'whatsapp' ? 'WhatsApp' : 'el tab Asistente IA de MyQuote'} (Intcomex Chile).`,
    skill,
    'Precios, stock y plazos solo con el conector MyQuote (buscar_productos, consultar_producto, simular_cotizacion, calcular_precios). No grabes cotizaciones ni emitas PDF: si lo piden, indica que se hace desde el Cotizador de MyQuote.',
    'Si piden un nivel de partner Axis (Autorizado, Silver, Gold, Multiregional), otro margen o GP (por ejemplo «gold al 8»), o el costo: usa calcular_precios con partner_category y gp_axis/gp_qnap (8 = 8%) y entrega esos precios. Stock y entrega siguen saliendo de consultar_producto. Sin nivel ni GP, el precio es el de consultar_producto.',
    'No ejecutes comandos ni modifiques archivos.',
    canal === 'whatsapp' ? FORMATO_WHATSAPP : FORMATO_WEB,
    '</instrucciones_myquote>'
  ].join('\n');
  const previos = mensajes.slice(0, -1);
  const ultimo = mensajes[mensajes.length - 1].content;
  if (!previos.length) return `${instrucciones}\n\n${ultimo}`;
  const historial = previos
    .map((msg) =>
      msg.role === 'user'
        ? `<usuario>\n${msg.content}\n</usuario>`
        : `<asistente>\n${textoDeContenido(msg.content)}\n</asistente>`
    )
    .join('\n\n');
  return `${instrucciones}\n\n<conversacion_previa>\n${historial}\n</conversacion_previa>\n\nNuevo mensaje del usuario:\n${ultimo}`;
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
    calcular_precios: 'Calculando precio por partner y margen',
    web_search: 'Buscando fichas técnicas',
    web_fetch: 'Leyendo ficha técnica'
  };
  const base =
    nombres[bloque?.name] || `Usando ${bloque?.name || 'herramienta'}`;
  return detalle ? `${base}: ${String(detalle).slice(0, 80)}` : base;
};

// --- Consultas en segundo plano ---------------------------------------------

const AGENTE_CONECTADO_MS = 90 * 1000; // sin pedir trabajo en este lapso: desconectado
const AGENTE_SIN_LATIDO_MS = 3 * 60 * 1000; // consulta tomada sin avance: se devuelve a la cola
const COLA_MAX_ESPERA_MS = 5 * 60 * 1000; // nadie la tomo: falla
const AGENTE_MAX_CHARS = 200000;

const crearGestorConsultas = ({
  crearCliente,
  config = leerConfig(),
  logger = console,
  ahora = () => Date.now()
}) => {
  const consultas = new Map();
  const cola = [];
  let esperas = []; // agentes esperando trabajo (long polling)
  let agenteVisto = 0;

  const vista = (c) => ({
    id: c.id,
    estado: c.estado,
    texto: c.texto,
    pasos: c.pasos,
    contenido: c.estado === 'lista' ? c.contenido : undefined,
    error: c.error,
    uso: c.uso
  });

  const finalizar = (c, cambios) => {
    Object.assign(c, cambios, { actualizada: ahora() });
    const idx = cola.indexOf(c);
    if (idx >= 0) cola.splice(idx, 1);
    if (c.alTerminar) {
      const cb = c.alTerminar;
      c.alTerminar = null;
      Promise.resolve()
        .then(() => cb(vista(c), c))
        .catch((error) =>
          logger.error?.(
            { event: 'ia_al_terminar_error', msg: error?.message },
            'Fallo el aviso de fin de consulta'
          )
        );
    }
  };

  const revisarVencidas = () => {
    const t = ahora();
    for (const [id, c] of consultas) {
      if (c.actualizada < t - JOB_TTL_MS && c.estado !== 'en_curso')
        consultas.delete(id);
    }
    for (const c of [...cola]) {
      if (c.estado !== 'en_curso') continue;
      if (c.tomadaEn && c.actualizada < t - AGENTE_SIN_LATIDO_MS) {
        // El agente la tomo y dejo de reportar (se reinicio o se corto la red).
        c.tomadaEn = null;
        c.pasos.push('El servidor IA dejó de responder: reintentando');
        c.actualizada = t;
      } else if (!c.tomadaEn && c.creada < t - COLA_MAX_ESPERA_MS) {
        finalizar(c, {
          estado: 'error',
          error:
            'El servidor IA de casa no tomó la consulta. Revisa que el miniPC y el agente estén encendidos.'
        });
      }
    }
  };

  // --- modo API ---------------------------------------------------------------
  const ejecutarApi = async (c, { marca, mensajes }) => {
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
            {
              publico: true
            }
          );
        }
        if (mensaje.stop_reason !== 'pause_turn') break;
        // Turno pausado por herramientas del servidor: se continua con lo ya generado.
        historial.splice(mensajes.length, historial.length - mensajes.length, {
          role: 'assistant',
          content: [...contenido]
        });
      }
      finalizar(c, { estado: 'lista', contenido });
    } catch (error) {
      if (c.cancelada) return;
      finalizar(c, {
        estado: 'error',
        error: error.publico ? error.message : mensajeError(error)
      });
      logger.error?.(
        {
          event: 'ia_consulta_error',
          status: error?.status,
          tipo: error?.name,
          detalle: detalleApi(error)
        },
        'Fallo la consulta al asistente IA'
      );
    } finally {
      c.stream = null;
    }
  };

  // --- modo agente ------------------------------------------------------------
  const paraAgente = (c) => {
    c.tomadaEn = ahora();
    c.actualizada = ahora();
    if (c.pasos.length === 1 && c.pasos[0].startsWith('En cola')) c.pasos = [];
    c.pasos.push('El servidor IA tomó la consulta');
    return { id: c.id, prompt: c.prompt, canal: c.canal, marca: c.marca };
  };

  const siguienteLibre = () =>
    cola.find((c) => c.estado === 'en_curso' && !c.tomadaEn);

  const despertarAgente = () => {
    while (esperas.length) {
      const c = siguienteLibre();
      if (!c) return;
      const espera = esperas.shift();
      clearTimeout(espera.timer);
      espera.resolver(paraAgente(c));
    }
  };

  const tomada = (id) => {
    const c = consultas.get(id);
    return c && c.tomadaEn && c.estado === 'en_curso' ? c : null;
  };

  return {
    modo: () => modo(config),

    estadoAgente() {
      return {
        conectado:
          agenteVisto > 0 && ahora() - agenteVisto < AGENTE_CONECTADO_MS,
        vistoEn: agenteVisto || null
      };
    },

    iniciar({ usuarioId, entrada, canal = 'web', alTerminar = null }) {
      revisarVencidas();
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
        canal,
        marca: entrada.marca || null,
        estado: 'en_curso',
        texto: '',
        pasos: [],
        contenido: null,
        error: null,
        uso: null,
        cancelada: false,
        creada: ahora(),
        actualizada: ahora(),
        alTerminar
      };
      consultas.set(c.id, c);
      if (modo(config) === 'agente') {
        c.prompt = construirPromptAgente({
          marca: entrada.marca,
          mensajes: entrada.mensajes,
          canal
        });
        c.pasos.push('En cola: esperando al servidor IA de casa');
        cola.push(c);
        despertarAgente();
      } else {
        ejecutarApi(c, entrada);
      }
      return vista(c);
    },

    obtener({ usuarioId, id }) {
      revisarVencidas();
      const c = consultas.get(id);
      if (!c || c.usuarioId !== usuarioId) return null;
      return vista(c);
    },

    cancelar({ usuarioId, id }) {
      const c = consultas.get(id);
      if (!c || c.usuarioId !== usuarioId) return false;
      c.cancelada = true;
      c.stream?.abort();
      finalizar(c, { estado: 'cancelada', alTerminar: null });
      return true;
    },

    // --- API del agente ---
    /** Espera hasta esperaMs por una consulta; null si no hay. */
    tomarTrabajo({ esperaMs = 25000 } = {}) {
      agenteVisto = ahora();
      revisarVencidas();
      const c = siguienteLibre();
      if (c) return Promise.resolve(paraAgente(c));
      return new Promise((resolver) => {
        const espera = { resolver };
        espera.timer = setTimeout(() => {
          esperas = esperas.filter((e) => e !== espera);
          agenteVisto = ahora();
          resolver(null);
        }, esperaMs);
        esperas.push(espera);
      });
    },

    /** Avance parcial: texto acumulado y/o un paso nuevo. Devuelve false si ya no aplica (cancelada). */
    avanceAgente(id, { texto, paso } = {}) {
      agenteVisto = ahora();
      const c = tomada(id);
      if (!c) return false;
      if (typeof texto === 'string') c.texto = texto.slice(0, AGENTE_MAX_CHARS);
      if (paso) c.pasos.push(String(paso).slice(0, 160));
      c.actualizada = ahora();
      return true;
    },

    liberarTrabajo(id) {
      const c = tomada(id);
      if (!c) return false;
      c.tomadaEn = null;
      c.pasos = c.pasos.filter((p) => p !== 'El servidor IA tomó la consulta');
      despertarAgente();
      return true;
    },

    terminarAgente(id, { texto, error } = {}) {
      agenteVisto = ahora();
      const c = tomada(id);
      if (!c) return false;
      if (error) {
        finalizar(c, {
          estado: 'error',
          error: `El servidor IA no pudo responder: ${String(error).slice(0, 300)}`
        });
      } else {
        const final = String(texto || c.texto || '').slice(0, AGENTE_MAX_CHARS);
        finalizar(c, {
          estado: 'lista',
          texto: final,
          contenido: [{ type: 'text', text: final }]
        });
      }
      return true;
    }
  };
};

// Motivo que entrega la API (p. ej. "invalid x-api-key"); no contiene secretos.
const detalleApi = (error) => {
  const e = error?.error?.error || error?.error || {};
  const texto = [e.type, e.message].filter(Boolean).join(': ');
  return texto ? ` Detalle: ${String(texto).slice(0, 300)}` : '';
};

const mensajeError = (error) => {
  const status = error?.status;
  const detalle = detalleApi(error);
  if (status === 401)
    return `Anthropic rechazó la API key (401). Revisa ANTHROPIC_API_KEY.${detalle}`;
  if (status === 403)
    return `La API key no tiene permiso para este pedido (403).${detalle}`;
  if (status === 429)
    return `Se alcanzó el límite de uso de la API de Anthropic. Intenta en unos minutos.${detalle}`;
  if (status === 529 || status >= 500)
    return 'La API de Anthropic está saturada. Intenta en unos minutos.';
  if (status === 400) return `La API rechazó el pedido (400).${detalle}`;
  return 'No se pudo completar la consulta. Intenta de nuevo.';
};

module.exports = {
  MARCAS,
  modo,
  usuarioPermitido,
  textoDeContenido,
  construirPromptAgente,
  HERRAMIENTAS_MYQUOTE,
  leerConfig,
  faltantes,
  construirSistema,
  validarEntrada,
  construirParametros,
  describirHerramienta,
  crearGestorConsultas
};
