#!/usr/bin/env node
// Agente IA de MyQuote para el equipo de casa.
//
// Pide consultas al backend de MyQuote (solo conexiones salientes), las
// resuelve con Claude Code usando la sesion, las skills y el conector MyQuote
// de este equipo, y devuelve el avance y la respuesta. Una consulta a la vez.
//
// Uso: node agente.mjs   (configuracion en agente-ia/.env, ver .env.example)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MCP_CORREO_DEFECTO,
  PROMPT_PROBAR_CORREO,
  TIPOS_TAREA,
  argumentosClaudeCorreo,
  construirPromptTarea,
  extraerItems,
  validarResultado
} from './correo.mjs';
import { CODIGO_ACTUALIZADO, comprobarActualizacion, crearGit, instalarDependencias, versionActual } from './actualizador.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// --- Configuracion ------------------------------------------------------------

export const leerEnvArchivo = (archivo) => {
  if (!existsSync(archivo)) return {};
  const vars = {};
  for (const linea of readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (!m || linea.trim().startsWith('#')) continue;
    vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
};

export const leerConfig = (env) => ({
  apiUrl: String(env.MYQUOTE_API_URL || '').replace(/\/+$/, ''),
  token: String(env.IA_AGENTE_TOKEN || '').trim(),
  claude: env.CLAUDE_BIN || 'claude',
  modelo: env.CLAUDE_MODEL || '',
  mcp: env.MCP_NOMBRE || 'myquote',
  timeoutMs: (Number(env.TIMEOUT_MIN) > 0 ? Number(env.TIMEOUT_MIN) : 10) * 60 * 1000,
  carpetaTrabajo: env.CARPETA_TRABAJO || path.join(AQUI, 'trabajo'),
  // Seguimiento por correo (tareas de Outlook). SEGUIMIENTO_CORREO=0 lo apaga.
  mcpCorreo: env.MCP_CORREO || MCP_CORREO_DEFECTO,
  seguimiento: !/^(0|false|no|off)$/i.test(String(env.SEGUIMIENTO_CORREO ?? '1').trim()),
  // Menor que los 15 min tras los que el backend reencola una tarea tomada.
  timeoutTareaMs: (Number(env.TIMEOUT_TAREA_MIN) > 0 ? Number(env.TIMEOUT_TAREA_MIN) : 12) * 60 * 1000,
  autoActualizar: !/^(0|false|no|off)$/i.test(String(env.AUTO_ACTUALIZAR ?? '1').trim()),
  autoActualizarMs: (Number(env.AUTO_ACTUALIZAR_MIN) > 0 ? Number(env.AUTO_ACTUALIZAR_MIN) : 10) * 60 * 1000
});

// Solo lectura: catalogo MyQuote, fichas web y las skills. Nada de comandos ni escritura.
export const herramientasPermitidas = (mcp) => [
  `mcp__${mcp}__cotizar_rapido`,
  `mcp__${mcp}__buscar_productos`,
  `mcp__${mcp}__consultar_producto`,
  `mcp__${mcp}__simular_cotizacion`,
  `mcp__${mcp}__calcular_precios`,
  'Skill',
  'Read',
  'WebSearch',
  'WebFetch'
];
const HERRAMIENTAS_BLOQUEADAS = ['Bash', 'Edit', 'Write', 'NotebookEdit'];

export const argumentosClaude = (config) => {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--allowedTools',
    herramientasPermitidas(config.mcp).join(','),
    '--disallowedTools',
    HERRAMIENTAS_BLOQUEADAS.join(','),
    '--max-turns',
    '40'
  ];
  if (config.modelo) args.push('--model', config.modelo);
  return args;
};

// --- Lectura de la salida de Claude Code --------------------------------------

const NOMBRES = {
  cotizar_rapido: 'Cotizando (precio, stock y entrega)',
  buscar_productos: 'Buscando en MyQuote',
  consultar_producto: 'Consultando precio y stock',
  simular_cotizacion: 'Simulando la cotización',
  calcular_precios: 'Calculando precio por partner y margen',
  WebSearch: 'Buscando fichas técnicas',
  WebFetch: 'Leyendo ficha técnica',
  Skill: 'Cargando skill'
};

// cotizar_rapido / calcular_precios / simular_cotizacion: muestra los primeros SKUs de la lista.
const detalleItems = (items) =>
  Array.isArray(items) && items.length
    ? `${items.slice(0, 4).map((i) => i?.sku).filter(Boolean).join(', ')}${items.length > 4 ? ` y ${items.length - 4} más` : ''}`
    : '';

export const describirHerramienta = (bloque) => {
  const nombre = nombreCorto(bloque?.name);
  if (nombre === 'Read') return null; // lectura de referencias de la skill: no aporta al usuario
  const input = bloque?.input || {};
  const detalle = detalleItems(input.items) || input.sku || input.texto || input.query || input.url || input.skill || input.command || '';
  const base = NOMBRES[nombre] || `Usando ${nombre}`;
  return detalle ? `${base}: ${String(detalle).slice(0, 80)}` : base;
};

// --- Medicion de tiempos ---------------------------------------------------------
// Solo se guardan nombres de herramienta y duraciones: nunca el contenido de los
// mensajes, los argumentos de las herramientas ni datos de clientes.

const MAX_HERRAMIENTAS_MEDIDAS = 100;

const nombreCorto = (nombre) => String(nombre || '').replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');

export const crearMetricas = (inicio) => ({
  inicio,
  arranqueMs: null, // lanzar el proceso -> primer evento
  turnos: 0,
  idsTurno: new Set(),
  turnosCli: null, // num_turns que informa Claude Code al terminar
  apiMs: null,
  abiertas: new Map(), // tool_use_id -> { nombre, t }
  herramientas: [] // { nombre, ms, error }
});

/** Registra un evento ya parseado. `t` es la hora (ms) en que llego. */
export const medirEvento = (m, ev, t) => {
  if (!m) return;
  if (m.arranqueMs === null) m.arranqueMs = t - m.inicio;
  if (ev.type === 'assistant') {
    // Claude Code emite un evento por bloque: los bloques de un mismo mensaje comparten id.
    const id = ev.message?.id;
    if (id) {
      if (!m.idsTurno.has(id)) {
        m.idsTurno.add(id);
        m.turnos += 1;
      }
    } else if (Array.isArray(ev.message?.content)) {
      m.turnos += 1;
    }
    for (const b of ev.message?.content || []) {
      if (b.type === 'tool_use' && b.id) m.abiertas.set(b.id, { nombre: nombreCorto(b.name), t });
    }
  } else if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
    for (const b of ev.message.content) {
      if (b.type !== 'tool_result') continue;
      const abierta = m.abiertas.get(b.tool_use_id);
      if (!abierta) continue;
      m.abiertas.delete(b.tool_use_id);
      if (m.herramientas.length < MAX_HERRAMIENTAS_MEDIDAS) {
        m.herramientas.push({ nombre: abierta.nombre, ms: t - abierta.t, ...(b.is_error ? { error: true } : {}) });
      }
    }
  } else if (ev.type === 'result') {
    if (Number.isFinite(ev.num_turns)) m.turnosCli = ev.num_turns;
    if (Number.isFinite(ev.duration_api_ms)) m.apiMs = ev.duration_api_ms;
  }
};

/** Cierra la medicion y devuelve el objeto que se envia al backend. */
export const cerrarMetricas = (m, t) => {
  if (!m) return null;
  // Una herramienta que no llego a responder (cancelada, tiempo agotado) se cierra al terminar.
  for (const { nombre, t: desde } of m.abiertas.values()) {
    if (m.herramientas.length < MAX_HERRAMIENTAS_MEDIDAS) m.herramientas.push({ nombre, ms: t - desde, sin_respuesta: true });
  }
  m.abiertas.clear();
  return {
    total_ms: Math.max(0, t - m.inicio),
    arranque_ms: m.arranqueMs,
    turnos: m.turnosCli ?? m.turnos,
    ...(m.apiMs !== null ? { api_ms: m.apiMs } : {}),
    herramientas: m.herramientas
  };
};

const seg = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** Una linea para el log: total, arranque, turnos y tiempo por herramienta. */
export const resumenMetricas = (met) => {
  if (!met) return '';
  const porNombre = new Map();
  for (const h of met.herramientas) {
    const a = porNombre.get(h.nombre) || { n: 0, ms: 0 };
    a.n += 1;
    a.ms += h.ms;
    porNombre.set(h.nombre, a);
  }
  const herr = [...porNombre].map(([nombre, a]) => `${nombre}${a.n > 1 ? ` x${a.n}` : ''} ${seg(a.ms)}`).join(', ');
  return (
    `  ⏱ total ${seg(met.total_ms)} · arranque ${met.arranque_ms === null ? 'n/d' : seg(met.arranque_ms)} · ` +
    `${met.turnos} turnos · herramientas: ${herr || 'ninguna'}`
  );
};

/** Procesa una linea de stream-json y actualiza el estado. Devuelve los pasos nuevos. */
export const procesarEvento = (estado, linea, t = Date.now()) => {
  let ev;
  try {
    ev = JSON.parse(linea);
  } catch {
    return [];
  }
  medirEvento(estado.metricas, ev, t);
  const pasos = [];
  if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
    for (const b of ev.message.content) {
      if (b.type === 'text' && b.text) estado.texto = estado.texto ? `${estado.texto}\n\n${b.text}` : b.text;
      if (b.type === 'tool_use') {
        const paso = describirHerramienta(b);
        if (paso) pasos.push(paso);
      }
    }
  } else if (ev.type === 'result') {
    estado.terminado = true;
    estado.error = ev.is_error ? String(ev.result || ev.subtype || 'error de Claude Code') : null;
    if (!ev.is_error && typeof ev.result === 'string' && ev.result.trim()) estado.final = ev.result;
  }
  return pasos;
};

// --- Comunicacion con MyQuote -------------------------------------------------

const crearApi = (config, fetchImpl = fetch, version = null) => {
  const pedir = async (ruta, opciones = {}, timeoutMs = 20000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(`${config.apiUrl}${ruta}`, {
        ...opciones,
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', ...(opciones.headers || {}) }
      });
    } finally {
      clearTimeout(t);
    }
  };
  return {
    async tomar() {
      const cabeceras = version ? { 'X-Agente-Version': version } : {};
      const res = await pedir('/api/ia/agente/trabajo?espera=25', { headers: cabeceras }, 40000);
      if (res.status === 204) return null;
      if (res.status === 401) throw Object.assign(new Error('IA_AGENTE_TOKEN rechazado por MyQuote'), { fatal: true });
      if (!res.ok) throw new Error(`MyQuote respondió ${res.status}`);
      return res.json();
    },
    // Tareas de correo del seguimiento. 404 = backend sin esa ruta (version vieja).
    async tomarTarea() {
      const res = await pedir('/api/seguimiento/agente/tarea?espera=1', {}, 40000);
      if (res.status === 204) return null;
      if (res.status === 404) throw Object.assign(new Error('el backend no tiene la ruta de tareas'), { noSoportada: true });
      if (res.status === 401) throw Object.assign(new Error('IA_AGENTE_TOKEN rechazado por MyQuote'), { fatal: true });
      if (!res.ok) throw new Error(`MyQuote respondió ${res.status}`);
      return res.json();
    },
    async resultadoTarea(id, cuerpo) {
      const res = await pedir(`/api/seguimiento/agente/tarea/${encodeURIComponent(id)}/resultado`, { method: 'POST', body: JSON.stringify(cuerpo) });
      if (!res.ok) throw new Error(`MyQuote respondió ${res.status}`);
    },
    async avance(id, cuerpo) {
      const res = await pedir(`/api/ia/agente/trabajo/${id}/avance`, { method: 'POST', body: JSON.stringify(cuerpo) });
      return res.status !== 410; // false: la consulta se cancelo
    },
    async fin(id, cuerpo) {
      await pedir(`/api/ia/agente/trabajo/${id}/fin`, { method: 'POST', body: JSON.stringify(cuerpo) });
    }
  };
};

// --- Resolver una consulta ------------------------------------------------------

// Archivo de una consulta de lectura: un pantallazo (imagen) o el PDF de la OC completa.
// Claude Code decide como leer un archivo por su extension, asi que el nombre sigue al
// mime: un PDF guardado como .png no se lee. MISMA REGLA que archivoPantallazo en
// backend/src/services/asistenteIA.js, que es quien nombra el archivo en el prompt.
const ARCHIVO_PDF = 'pantallazo.pdf';
const ARCHIVO_PNG = 'pantallazo.png';

/** Todos los nombres con que puede quedar el archivo: la limpieza los barre siempre. */
export const ARCHIVOS_IMAGEN = [ARCHIVO_PNG, ARCHIVO_PDF];

/** Nombre del archivo segun su mime: PDF -> pantallazo.pdf; cualquier otro (las imagenes) -> pantallazo.png. */
export const archivoDeImagen = (mime) => (mime === 'application/pdf' ? ARCHIVO_PDF : ARCHIVO_PNG);

/**
 * Borra el archivo de la consulta, con TODOS sus nombres posibles y no solo el de esta:
 * si quedara un pantallazo.pdf de una consulta anterior y la siguiente trae un PNG,
 * Claude Code podria leer el PDF viejo y devolver los montos de otro cliente.
 * No falla si no existe: se llama desde varios lados.
 */
const borrarImagen = (config, log = () => {}) => {
  for (const nombre of ARCHIVOS_IMAGEN) {
    try {
      rmSync(path.join(config.carpetaTrabajo, nombre), { force: true });
    } catch (error) {
      log(`No se pudo borrar ${nombre} de la consulta: ${error.message}`);
    }
  }
};

export const resolver = ({ config, trabajo, api, spawnImpl = spawn, log = console.log, ahora = () => Date.now() }) =>
  new Promise((resolve) => {
    mkdirSync(config.carpetaTrabajo, { recursive: true });
    // Nada de una consulta anterior (por ejemplo, si el agente se cayo a medias).
    borrarImagen(config, log);
    if (trabajo.imagen) {
      try {
        if (typeof trabajo.imagen.datos !== 'string' || !trabajo.imagen.datos) throw new Error('la imagen llegó vacía');
        // Si la limpieza no pudo con un sobrante, no se sigue: Claude Code podria leer el archivo de otra consulta.
        const sobrante = ARCHIVOS_IMAGEN.find((nombre) => existsSync(path.join(config.carpetaTrabajo, nombre)));
        if (sobrante) throw new Error(`no se pudo borrar ${sobrante} de una consulta anterior`);
        writeFileSync(path.join(config.carpetaTrabajo, archivoDeImagen(trabajo.imagen.mime)), Buffer.from(trabajo.imagen.datos, 'base64'));
      } catch (e) {
        // Sin la imagen en disco no tiene sentido lanzar Claude Code: diria que no la encuentra.
        borrarImagen(config, log);
        const error = `El servidor IA no pudo guardar la imagen para leerla: ${e.message}`;
        api
          .fin(trabajo.id, { error })
          .catch((err) => log(`No se pudo entregar el resultado: ${err.message}`))
          .then(() => resolve({ texto: '', error }));
        return;
      }
    }
    const metricas = crearMetricas(ahora());
    const hijo = spawnImpl(config.claude, argumentosClaude(config), {
      cwd: config.carpetaTrabajo,
      // En Windows, "claude" sin ruta necesita el shell para resolverse; un .exe con ruta completa no.
      shell: process.platform === 'win32' && !/\.exe$/i.test(config.claude),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const estado = { texto: '', final: null, error: null, terminado: false, metricas };
    let pendientes = [];
    let ultimoEnvio = 0;
    let cancelada = false;
    let errStd = '';
    let buffer = '';

    const enviarAvance = async (forzar = false) => {
      if (!forzar && Date.now() - ultimoEnvio < 2000 && pendientes.length === 0) return;
      ultimoEnvio = Date.now();
      const pasos = pendientes;
      pendientes = [];
      try {
        // Un paso por llamada para conservar el orden; el texto va en la ultima.
        for (const paso of pasos.slice(0, -1)) await api.avance(trabajo.id, { paso });
        const sigue = await api.avance(trabajo.id, { texto: estado.texto, paso: pasos[pasos.length - 1] });
        if (!sigue && !cancelada) {
          cancelada = true;
          log('Consulta cancelada desde MyQuote');
          hijo.kill();
        }
      } catch (error) {
        log(`No se pudo enviar el avance: ${error.message}`);
      }
    };

    const latido = setInterval(() => enviarAvance(true), 30000);
    const limite = setTimeout(() => {
      estado.error = `Claude Code no terminó en ${Math.round(config.timeoutMs / 60000)} minutos`;
      borrarImagen(config, log);
      hijo.kill();
    }, config.timeoutMs);

    hijo.stdout.setEncoding('utf8');
    hijo.stdout.on('data', (trozo) => {
      buffer += trozo;
      const lineas = buffer.split('\n');
      buffer = lineas.pop();
      for (const linea of lineas) {
        if (!linea.trim()) continue;
        const nuevos = procesarEvento(estado, linea, ahora());
        if (nuevos.length) {
          pendientes.push(...nuevos);
          nuevos.forEach((p) => log(`  · ${p}`));
        }
      }
      enviarAvance();
    });
    hijo.stderr.setEncoding('utf8');
    hijo.stderr.on('data', (t) => {
      errStd = (errStd + t).slice(-2000);
    });
    hijo.on('error', (error) => {
      estado.error = error.code === 'ENOENT' ? `No se encontró "${config.claude}". ¿Está instalado Claude Code?` : error.message;
      borrarImagen(config, log);
    });
    hijo.on('close', async (codigo) => {
      clearInterval(latido);
      clearTimeout(limite);
      borrarImagen(config, log);
      if (buffer.trim()) procesarEvento(estado, buffer, ahora());
      if (cancelada) return resolve({ cancelada: true });
      await enviarAvance(true);
      const texto = (estado.final || estado.texto || '').trim();
      let error = estado.error;
      if (!error && !texto) error = `Claude Code terminó sin respuesta (código ${codigo}). ${errStd.trim().slice(-300)}`;
      const met = cerrarMetricas(metricas, ahora());
      log(resumenMetricas(met));
      try {
        // "metricas" es opcional: un backend que no lo conoce lo ignora.
        await api.fin(trabajo.id, error ? { error, metricas: met } : { texto, metricas: met });
      } catch (e) {
        log(`No se pudo entregar el resultado: ${e.message}`);
      }
      resolve({ texto, error, metricas: met });
    });

    hijo.stdin.on('error', () => {});
    hijo.stdin.end(trabajo.prompt);
  });

// --- Tareas de correo -----------------------------------------------------------

/**
 * Lanza Claude Code una vez con `prompt` y espera a que termine. No imprime ni guarda
 * contenido: `onEvento(ev)` recibe cada evento ya parseado para quien lo necesite.
 */
export const correrClaude = ({ config, args, prompt, timeoutMs, spawnImpl = spawn, ahora = () => Date.now(), onEvento = null }) =>
  new Promise((resolve) => {
    mkdirSync(config.carpetaTrabajo, { recursive: true });
    const metricas = crearMetricas(ahora());
    const estado = { texto: '', final: null, error: null, terminado: false, metricas };
    let errStd = '';
    let buffer = '';
    const hijo = spawnImpl(config.claude, args, {
      cwd: config.carpetaTrabajo,
      shell: process.platform === 'win32' && !/\.exe$/i.test(config.claude),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const limite = setTimeout(() => {
      estado.error = `Claude Code no terminó en ${Math.max(1, Math.round(timeoutMs / 60000))} minutos`;
      hijo.kill();
    }, timeoutMs);
    const linea = (l) => {
      if (!l.trim()) return;
      procesarEvento(estado, l, ahora());
      if (onEvento) {
        try {
          onEvento(JSON.parse(l));
        } catch {
          /* linea que no es JSON */
        }
      }
    };
    hijo.stdout.setEncoding('utf8');
    hijo.stdout.on('data', (trozo) => {
      buffer += trozo;
      const lineas = buffer.split('\n');
      buffer = lineas.pop();
      lineas.forEach(linea);
    });
    hijo.stderr.setEncoding('utf8');
    hijo.stderr.on('data', (t) => {
      errStd = (errStd + t).slice(-2000);
    });
    hijo.on('error', (error) => {
      estado.error = error.code === 'ENOENT' ? `No se encontró "${config.claude}". ¿Está instalado Claude Code?` : error.message;
    });
    hijo.on('close', (codigo) => {
      clearTimeout(limite);
      linea(buffer);
      resolve({ estado, codigo, errStd, metricas: cerrarMetricas(metricas, ahora()) });
    });
    hijo.stdin.on('error', () => {});
    hijo.stdin.end(prompt);
  });

// En el log de las tareas de correo solo van nombres de herramienta, nunca sus argumentos.
const logHerramientas = (log) => (ev) => {
  if (ev.type !== 'assistant') return;
  for (const b of ev.message?.content || []) if (b.type === 'tool_use') log(`  · ${nombreCorto(b.name)}`);
};

/** Ejecuta una tarea de correo y devuelve su resultado al backend. */
export const ejecutarTarea = async ({ config, tarea, api, spawnImpl = spawn, log = console.log, ahora = () => Date.now() }) => {
  const corto = String(tarea.id).slice(0, 8);
  const n = Array.isArray(tarea.items) ? tarea.items.length : 0;
  log(`Tarea ${corto} (${tarea.tipo}, ${n} ítems)`);
  let cuerpo;
  let metricas = null;
  if (!TIPOS_TAREA.includes(tarea.tipo) || !Array.isArray(tarea.items)) {
    cuerpo = { ok: false, items: [], error: `Tarea no soportada por este agente: ${String(tarea.tipo).slice(0, 40)}` };
  } else {
    const r = await correrClaude({
      config,
      args: argumentosClaudeCorreo(config, tarea.tipo),
      prompt: construirPromptTarea(tarea),
      timeoutMs: config.timeoutTareaMs,
      spawnImpl,
      ahora,
      onEvento: logHerramientas(log)
    });
    metricas = r.metricas;
    log(resumenMetricas(metricas));
    let error = r.estado.error;
    let items = [];
    if (!error) {
      const texto = r.estado.final || r.estado.texto || '';
      if (!texto.trim()) error = `Claude Code terminó sin respuesta (código ${r.codigo}). ${r.errStd.trim().slice(-300)}`;
      else {
        const valido = validarResultado(tarea.tipo, tarea.items, extraerItems(r.estado.final) ?? extraerItems(r.estado.texto));
        if (valido.ok) items = valido.items;
        else error = valido.error;
      }
    }
    cuerpo = error ? { ok: false, items: [], error, metricas } : { ok: true, items, metricas };
  }
  try {
    await api.resultadoTarea(tarea.id, cuerpo);
  } catch (e) {
    log(`No se pudo entregar el resultado de la tarea ${corto}: ${e.message}`);
  }
  log(cuerpo.ok ? `  lista (${cuerpo.items.length} ítems)` : `  error: ${cuerpo.error}`);
  return cuerpo;
};

// --- Diagnostico del conector de correo ----------------------------------------------

/** `node agente.mjs --probar-correo`: una sola consulta de solo lectura a Enviados. */
export const probarCorreo = async ({ config, spawnImpl = spawn, log = console.log, ahora = () => Date.now() }) => {
  const esperadas = [`mcp__${config.mcpCorreo}__outlook_email_search`];
  let init = null;
  log(`Probando el conector de correo (MCP_CORREO=${config.mcpCorreo})…`);
  const r = await correrClaude({
    config,
    args: argumentosClaudeCorreo(config, null),
    prompt: PROMPT_PROBAR_CORREO,
    timeoutMs: Math.min(config.timeoutMs, 5 * 60 * 1000),
    spawnImpl,
    ahora,
    onEvento: (ev) => {
      if (ev.type === 'system' && ev.subtype === 'init') init = ev;
      logHerramientas(log)(ev);
    }
  });
  const herramientas = Array.isArray(init?.tools) ? init.tools.map(String) : [];
  const outlook = herramientas.filter((t) => /outlook/i.test(t));
  const servidores = Array.isArray(init?.mcp_servers) ? init.mcp_servers : [];
  const prefijos = [...new Set(outlook.map((t) => /^mcp__(.+?)__outlook_/.exec(t)?.[1]).filter(Boolean))];
  const encontrada = esperadas.every((t) => herramientas.includes(t));
  const texto = (r.estado.final || r.estado.texto || '').trim();

  log('');
  log('--- Diagnóstico del conector de correo ---');
  log(init ? `Herramientas disponibles según Claude Code: ${herramientas.length}` : 'Claude Code no reportó el evento init (no se conocen las herramientas disponibles).');
  if (servidores.length) log(`Servidores MCP: ${servidores.map((s) => `${s.name} (${s.status})`).join(', ')}`);
  log(
    outlook.length
      ? `Herramientas de Outlook encontradas (${outlook.length}):\n${outlook.map((t) => `  - ${t}`).join('\n')}`
      : 'Herramientas de Outlook encontradas: ninguna'
  );
  let ok = true;
  if (init && !encontrada) {
    ok = false;
    log(`PROBLEMA: falta ${esperadas.join(', ')}.`);
    if (prefijos.length) log(`  Prueba con MCP_CORREO=${prefijos.join(' o MCP_CORREO=')} en agente-ia/.env`);
    else log('  No hay ningún conector de Outlook en este equipo: agrégalo en Claude Code (conector Microsoft 365) e inicia sesión.');
  }
  if (r.estado.error) {
    ok = false;
    log(`Error de Claude Code: ${r.estado.error}`);
  } else if (!texto) {
    ok = false;
    log('Claude Code terminó sin respuesta.');
  } else {
    log(`Resultado (3 correos más recientes de Enviados):\n${texto}`);
  }
  log(resumenMetricas(r.metricas));
  log(ok ? 'RESULTADO: el conector de correo funciona.' : 'RESULTADO: revisar los problemas indicados arriba.');
  return { ok, outlook, texto, error: r.estado.error };
};

// --- Bucle principal ------------------------------------------------------------

const REINTENTO_TAREAS_MS = 10 * 60 * 1000;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export const principal = async ({
  config,
  version = null,
  api = crearApi(config, fetch, version),
  log = console.log,
  unaVez = false,
  spawnImpl = spawn,
  actualizador = null, // async () => { estado }; solo se invoca con el agente ocioso
  ahora = () => Date.now()
}) => {
  if (!config.apiUrl || !config.token) {
    throw new Error('Falta MYQUOTE_API_URL o IA_AGENTE_TOKEN en agente-ia/.env');
  }
  const conTareas = config.seguimiento !== false && typeof api.tomarTarea === 'function';
  log(`Agente IA conectado a ${config.apiUrl}. Esperando consultas${conTareas ? ' y tareas de correo' : ''}…`);
  if (version) log(`Versión ${version}`);
  let pausa = 2000;
  let ultimaRevision = ahora(); // la primera revision ocurre a los N minutos (acabamos de arrancar)
  // Ruta de tareas: un 404 (backend viejo) la apaga y se reintenta cada 10 minutos sin llenar el log.
  const tareas = { proximo: 0, sinSoporte: false, ultimoError: 0 };
  for (;;) {
    // Ocioso: entre consulta y consulta, nunca mientras Claude Code trabaja.
    if (actualizador && ahora() - ultimaRevision >= config.autoActualizarMs) {
      ultimaRevision = ahora();
      try {
        const r = await actualizador();
        if (r?.estado === 'actualizado') return { actualizado: true };
      } catch (error) {
        log(`Auto-actualización: error inesperado (${error.message})`);
      }
    }
    // 1. Las consultas del usuario son interactivas: siempre primero.
    try {
      const trabajo = await api.tomar();
      pausa = 2000;
      if (trabajo) {
        log(`Consulta ${trabajo.id.slice(0, 8)} (${trabajo.canal}${trabajo.marca ? ` · ${trabajo.marca}` : ''})`);
        const r = await resolver({ config, trabajo, api, log, spawnImpl });
        log(r.cancelada ? '  cancelada' : r.error ? `  error: ${r.error}` : `  lista (${r.texto.length} caracteres)`);
        if (unaVez) return r;
        continue; // tras una consulta, volver a mirar consultas antes que tareas
      }
    } catch (error) {
      if (error.fatal) throw error;
      log(`Sin conexión con MyQuote (${error.message}). Reintento en ${Math.round(pausa / 1000)} s`);
      await esperar(pausa);
      pausa = Math.min(pausa * 2, 60000);
      continue;
    }
    // 2. Sin consultas: una tarea de correo (una cosa a la vez).
    if (!conTareas || ahora() < tareas.proximo) continue;
    try {
      const tarea = await api.tomarTarea();
      if (tareas.sinSoporte) {
        tareas.sinSoporte = false;
        log('Tareas de seguimiento por correo disponibles en el backend.');
      }
      if (tarea) {
        const r = await ejecutarTarea({ config, tarea, api, spawnImpl, log, ahora });
        if (unaVez) return r;
      }
    } catch (error) {
      if (error.fatal) throw error;
      if (error.noSoportada) {
        tareas.proximo = ahora() + REINTENTO_TAREAS_MS;
        if (!tareas.sinSoporte) {
          tareas.sinSoporte = true;
          log('El backend no tiene todavía las tareas de seguimiento por correo (404): solo consultas. Reintento cada 10 minutos.');
        }
      } else if (ahora() - tareas.ultimoError >= 60000) {
        tareas.ultimoError = ahora();
        log(`Tareas de correo: error (${error.message})`);
      }
    }
  }
};

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const config = leerConfig({ ...leerEnvArchivo(path.join(AQUI, '.env')), ...process.env });
  if (process.argv.includes('--probar-correo')) {
    probarCorreo({ config })
      .then((r) => process.exit(r.ok ? 0 : 1))
      .catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
  } else {
    const git = crearGit(AQUI);
    let npmPendiente = false;
    const actualizador = config.autoActualizar
      ? async () => {
          const r = await comprobarActualizacion({ git, instalar: () => instalarDependencias(AQUI), npmPendiente });
          npmPendiente = r.estado === 'npm-fallo';
          return r;
        }
      : null;
    versionActual(git)
      .then((version) => principal({ config, version, actualizador }))
      .then((r) => {
        if (r?.actualizado) process.exit(CODIGO_ACTUALIZADO);
      })
      .catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
  }
}
