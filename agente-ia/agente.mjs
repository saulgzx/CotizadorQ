#!/usr/bin/env node
// Agente IA de MyQuote para el equipo de casa.
//
// Pide consultas al backend de MyQuote (solo conexiones salientes), las
// resuelve con Claude Code usando la sesion, las skills y el conector MyQuote
// de este equipo, y devuelve el avance y la respuesta. Una consulta a la vez.
//
// Uso: node agente.mjs   (configuracion en agente-ia/.env, ver .env.example)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  carpetaTrabajo: env.CARPETA_TRABAJO || path.join(AQUI, 'trabajo')
});

// Solo lectura: catalogo MyQuote, fichas web y las skills. Nada de comandos ni escritura.
export const herramientasPermitidas = (mcp) => [
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
  buscar_productos: 'Buscando en MyQuote',
  consultar_producto: 'Consultando precio y stock',
  simular_cotizacion: 'Simulando la cotización',
  WebSearch: 'Buscando fichas técnicas',
  WebFetch: 'Leyendo ficha técnica',
  Skill: 'Cargando skill'
};

export const describirHerramienta = (bloque) => {
  const nombre = String(bloque?.name || '').replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');
  if (nombre === 'Read') return null; // lectura de referencias de la skill: no aporta al usuario
  const input = bloque?.input || {};
  const detalle = input.sku || input.texto || input.query || input.url || input.skill || input.command || '';
  const base = NOMBRES[nombre] || `Usando ${nombre}`;
  return detalle ? `${base}: ${String(detalle).slice(0, 80)}` : base;
};

/** Procesa una linea de stream-json y actualiza el estado. Devuelve los pasos nuevos. */
export const procesarEvento = (estado, linea) => {
  let ev;
  try {
    ev = JSON.parse(linea);
  } catch {
    return [];
  }
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

const crearApi = (config, fetchImpl = fetch) => {
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
      const res = await pedir('/api/ia/agente/trabajo?espera=25', {}, 40000);
      if (res.status === 204) return null;
      if (res.status === 401) throw Object.assign(new Error('IA_AGENTE_TOKEN rechazado por MyQuote'), { fatal: true });
      if (!res.ok) throw new Error(`MyQuote respondió ${res.status}`);
      return res.json();
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

export const resolver = ({ config, trabajo, api, spawnImpl = spawn, log = console.log }) =>
  new Promise((resolve) => {
    mkdirSync(config.carpetaTrabajo, { recursive: true });
    const hijo = spawnImpl(config.claude, argumentosClaude(config), {
      cwd: config.carpetaTrabajo,
      // En Windows, "claude" sin ruta necesita el shell para resolverse; un .exe con ruta completa no.
      shell: process.platform === 'win32' && !/\.exe$/i.test(config.claude),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const estado = { texto: '', final: null, error: null, terminado: false };
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
      hijo.kill();
    }, config.timeoutMs);

    hijo.stdout.setEncoding('utf8');
    hijo.stdout.on('data', (trozo) => {
      buffer += trozo;
      const lineas = buffer.split('\n');
      buffer = lineas.pop();
      for (const linea of lineas) {
        if (!linea.trim()) continue;
        const nuevos = procesarEvento(estado, linea);
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
    });
    hijo.on('close', async (codigo) => {
      clearInterval(latido);
      clearTimeout(limite);
      if (buffer.trim()) procesarEvento(estado, buffer);
      if (cancelada) return resolve({ cancelada: true });
      await enviarAvance(true);
      const texto = (estado.final || estado.texto || '').trim();
      let error = estado.error;
      if (!error && !texto) error = `Claude Code terminó sin respuesta (código ${codigo}). ${errStd.trim().slice(-300)}`;
      try {
        await api.fin(trabajo.id, error ? { error } : { texto });
      } catch (e) {
        log(`No se pudo entregar el resultado: ${e.message}`);
      }
      resolve({ texto, error });
    });

    hijo.stdin.on('error', () => {});
    hijo.stdin.end(trabajo.prompt);
  });

// --- Bucle principal ------------------------------------------------------------

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export const principal = async ({ config, api = crearApi(config), log = console.log, unaVez = false, spawnImpl = spawn }) => {
  if (!config.apiUrl || !config.token) {
    throw new Error('Falta MYQUOTE_API_URL o IA_AGENTE_TOKEN en agente-ia/.env');
  }
  log(`Agente IA conectado a ${config.apiUrl}. Esperando consultas…`);
  let pausa = 2000;
  for (;;) {
    try {
      const trabajo = await api.tomar();
      pausa = 2000;
      if (trabajo) {
        log(`Consulta ${trabajo.id.slice(0, 8)} (${trabajo.canal}${trabajo.marca ? ` · ${trabajo.marca}` : ''})`);
        const r = await resolver({ config, trabajo, api, log, spawnImpl });
        log(r.cancelada ? '  cancelada' : r.error ? `  error: ${r.error}` : `  lista (${r.texto.length} caracteres)`);
        if (unaVez) return r;
      }
    } catch (error) {
      if (error.fatal) throw error;
      log(`Sin conexión con MyQuote (${error.message}). Reintento en ${Math.round(pausa / 1000)} s`);
      await esperar(pausa);
      pausa = Math.min(pausa * 2, 60000);
    }
  }
};

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const config = leerConfig({ ...leerEnvArchivo(path.join(AQUI, '.env')), ...process.env });
  principal({ config }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
