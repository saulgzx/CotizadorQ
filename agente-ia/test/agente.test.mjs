import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ARCHIVO_IMAGEN,
  argumentosClaude,
  cerrarMetricas,
  crearMetricas,
  describirHerramienta,
  leerConfig,
  principal,
  procesarEvento,
  resumenMetricas
} from '../agente.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const apiFalsa = (trabajos) => {
  const llamadas = { avances: [], fin: [] };
  return {
    llamadas,
    tomar: async () => trabajos.shift() || null,
    avance: async (id, cuerpo) => (llamadas.avances.push(cuerpo), true),
    fin: async (id, cuerpo) => llamadas.fin.push({ id, ...cuerpo })
  };
};

// Ejecuta el Claude Code falso con node, sin shell.
const config = {
  ...leerConfig({ MYQUOTE_API_URL: 'https://x', IA_AGENTE_TOKEN: 't', CARPETA_TRABAJO: path.join(os.tmpdir(), 'agente-ia-test') }),
  claude: process.execPath
};
const conClaudeFalso = (c) => ({ ...c, claude: process.execPath });
const argsOriginal = argumentosClaude;

test('solo permite herramientas de lectura y bloquea comandos', () => {
  const args = argsOriginal(config);
  const permitidas = args[args.indexOf('--allowedTools') + 1].split(',');
  assert.ok(permitidas.includes('mcp__myquote__consultar_producto'));
  assert.ok(permitidas.includes('mcp__myquote__cotizar_rapido'));
  assert.ok(!permitidas.includes('mcp__myquote__generar_cotizacion'));
  assert.ok(!permitidas.includes('Bash'));
  assert.match(args[args.indexOf('--disallowedTools') + 1], /Bash/);
});

test('describe los pasos y omite las lecturas de la skill', () => {
  assert.equal(describirHerramienta({ name: 'mcp__myquote__consultar_producto', input: { sku: 'TS-464' } }), 'Consultando precio y stock: TS-464');
  assert.equal(describirHerramienta({ name: 'Read', input: {} }), null);
  assert.equal(
    describirHerramienta({ name: 'mcp__myquote__cotizar_rapido', input: { items: [{ sku: 'P1475-LE' }, { sku: 'Q6355' }] } }),
    'Cotizando (precio, stock y entrega): P1475-LE, Q6355'
  );
  const estado = { texto: '' };
  procesarEvento(estado, JSON.stringify({ type: 'result', is_error: false, result: 'ok' }));
  assert.equal(estado.final, 'ok');
  assert.deepEqual(procesarEvento(estado, 'no es json'), []);
});

test('resuelve una consulta de punta a punta con Claude Code simulado', async () => {
  const api = apiFalsa([{ id: 'abc12345', canal: 'web', marca: 'AXIS', prompt: 'cotizar P1475-LE' }]);
  // spawn de "node claude-falso.mjs": se antepone el script a los argumentos.
  const { spawn } = await import('node:child_process');
  const original = spawn;
  const r = await principal({
    config: { ...conClaudeFalso(config) },
    api,
    log: () => {},
    unaVez: true,
    spawnImpl: (cmd, args, opts) => original(cmd, [path.join(AQUI, 'claude-falso.mjs'), ...args], opts)
  });
  assert.equal(r.error, null);
  assert.match(r.texto, /^Respuesta final/);
  assert.equal(api.llamadas.fin.length, 1);
  const { metricas, ...resto } = api.llamadas.fin[0];
  assert.deepEqual(resto, { id: 'abc12345', texto: r.texto });
  assert.equal(metricas.turnos, 3);
  assert.deepEqual(metricas.herramientas.map((h) => h.nombre), ['consultar_producto', 'Read']);
  assert.ok(metricas.total_ms >= 0 && metricas.arranque_ms >= 0);
  assert.ok(!JSON.stringify(metricas).includes('P1475'), 'las metricas no llevan contenido');
  assert.ok(api.llamadas.avances.some((a) => a.paso === 'Consultando precio y stock: P1475-LE'));
  assert.ok(!api.llamadas.avances.some((a) => a.paso && a.paso.startsWith('Usando Read')));
});

test('informa el error de Claude Code a MyQuote', async () => {
  const api = apiFalsa([{ id: 'def', canal: 'whatsapp', marca: null, prompt: 'FALLAR' }]);
  const { spawn } = await import('node:child_process');
  const r = await principal({
    config: conClaudeFalso(config),
    api,
    log: () => {},
    unaVez: true,
    spawnImpl: (cmd, args, opts) => spawn(cmd, [path.join(AQUI, 'claude-falso.mjs'), ...args], opts)
  });
  assert.equal(r.error, 'límite de uso alcanzado');
  assert.equal(api.llamadas.fin[0].error, 'límite de uso alcanzado');
  assert.ok(api.llamadas.fin[0].metricas);
});

test('mide arranque, herramientas (incluso en paralelo), turnos y total', () => {
  const m = crearMetricas(1000);
  const estado = { texto: '', metricas: m };
  const ev = (o) => JSON.stringify(o);
  procesarEvento(estado, ev({ type: 'system', subtype: 'init' }), 3200);
  // Dos herramientas pedidas en el mismo turno (dos bloques, un mismo mensaje).
  procesarEvento(estado, ev({ type: 'assistant', message: { id: 'a', content: [{ type: 'tool_use', id: 'x', name: 'mcp__myquote__buscar_productos', input: { texto: 'secreto' } }] } }), 4000);
  procesarEvento(estado, ev({ type: 'assistant', message: { id: 'a', content: [{ type: 'tool_use', id: 'y', name: 'Skill', input: {} }] } }), 4001);
  procesarEvento(estado, ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'y', content: 'x' }] } }), 4500);
  procesarEvento(estado, ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', is_error: true, content: 'x' }] } }), 6000);
  procesarEvento(estado, ev({ type: 'assistant', message: { id: 'b', content: [{ type: 'text', text: 'listo' }] } }), 7000);
  procesarEvento(estado, ev({ type: 'result', is_error: false, result: 'listo' }), 7100);
  const met = cerrarMetricas(m, 7200);
  assert.equal(met.arranque_ms, 2200);
  assert.equal(met.total_ms, 6200);
  assert.equal(met.turnos, 2);
  assert.deepEqual(met.herramientas, [
    { nombre: 'Skill', ms: 499 },
    { nombre: 'buscar_productos', ms: 2000, error: true }
  ]);
  assert.ok(!JSON.stringify(met).includes('secreto'));
  assert.match(resumenMetricas(met), /total 6\.2 s · arranque 2\.2 s · 2 turnos · herramientas: Skill 0\.5 s, buscar_productos 2\.0 s/);
});

test('una herramienta sin respuesta se cierra al terminar y num_turns manda', () => {
  const m = crearMetricas(0);
  const estado = { texto: '', metricas: m };
  procesarEvento(estado, JSON.stringify({ type: 'assistant', message: { id: 'a', content: [{ type: 'tool_use', id: 'x', name: 'WebFetch', input: {} }] } }), 10);
  procesarEvento(estado, JSON.stringify({ type: 'result', result: 'ok', num_turns: 5, duration_api_ms: 900 }), 50);
  const met = cerrarMetricas(m, 100);
  assert.equal(met.turnos, 5);
  assert.equal(met.api_ms, 900);
  assert.deepEqual(met.herramientas, [{ nombre: 'WebFetch', ms: 90, sin_respuesta: true }]);
});

// --- Consultas con imagen (pantallazo) -------------------------------------------

// PNG de 1x1: lo que importa es que los bytes lleguen intactos al disco.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Corre una consulta en una carpeta propia y anota que habia en disco al lanzar Claude Code.
const correrConImagen = async (trabajo, { preparar } = {}) => {
  const carpeta = mkdtempSync(path.join(os.tmpdir(), 'agente-ia-img-'));
  const archivo = path.join(carpeta, ARCHIVO_IMAGEN);
  if (preparar) preparar(archivo);
  const api = apiFalsa([trabajo]);
  const alLanzar = { veces: 0, existia: null, bytes: null };
  try {
    const r = await principal({
      config: { ...conClaudeFalso(config), carpetaTrabajo: carpeta },
      api,
      log: () => {},
      unaVez: true,
      spawnImpl: (cmd, args, opts) => {
        alLanzar.veces += 1;
        alLanzar.existia = existsSync(archivo);
        if (alLanzar.existia) alLanzar.bytes = readFileSync(archivo);
        alLanzar.cwd = opts.cwd;
        return spawn(cmd, [path.join(AQUI, 'claude-falso.mjs'), ...args], opts);
      }
    });
    return { r, api, alLanzar, carpeta, quedo: existsSync(archivo) };
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
};

test('un trabajo con imagen la deja en la carpeta de trabajo antes de lanzar Claude Code', async () => {
  const { r, alLanzar, carpeta } = await correrConImagen({
    id: 'img1',
    canal: 'web',
    marca: null,
    prompt: 'lee ./pantallazo.png',
    imagen: { datos: PNG_B64, mime: 'image/jpeg' }
  });
  assert.equal(r.error, null);
  assert.equal(alLanzar.veces, 1);
  assert.equal(alLanzar.existia, true, 'la imagen tiene que estar antes de lanzar el proceso');
  assert.equal(alLanzar.cwd, carpeta, 'Claude Code corre en la carpeta donde quedó la imagen');
  // Nombre fijo aunque el mime sea otro, y los bytes tal cual venian.
  assert.equal(ARCHIVO_IMAGEN, 'pantallazo.png');
  assert.deepEqual(alLanzar.bytes, Buffer.from(PNG_B64, 'base64'));
});

test('la imagen se borra cuando la consulta termina bien', async () => {
  const { r, api, quedo } = await correrConImagen({ id: 'img2', canal: 'web', marca: null, prompt: 'lee ./pantallazo.png', imagen: { datos: PNG_B64, mime: 'image/png' } });
  assert.equal(r.error, null);
  assert.match(api.llamadas.fin[0].texto, /^Respuesta final/);
  assert.equal(quedo, false);
});

test('la imagen se borra también si Claude Code falla', async () => {
  const { r, alLanzar, quedo } = await correrConImagen({ id: 'img3', canal: 'web', marca: null, prompt: 'FALLAR', imagen: { datos: PNG_B64, mime: 'image/png' } });
  assert.equal(r.error, 'límite de uso alcanzado');
  assert.equal(alLanzar.existia, true);
  assert.equal(quedo, false);
});

test('un trabajo sin imagen no crea ningún archivo', async () => {
  const { r, alLanzar, quedo } = await correrConImagen({ id: 'img4', canal: 'web', marca: 'AXIS', prompt: 'cotizar P1475-LE' });
  assert.equal(r.error, null);
  assert.equal(alLanzar.existia, false);
  assert.equal(quedo, false);
});

test('un trabajo sin imagen limpia la que haya quedado de una consulta anterior', async () => {
  const { alLanzar } = await correrConImagen(
    { id: 'img5', canal: 'web', marca: 'AXIS', prompt: 'cotizar P1475-LE', imagen: null },
    { preparar: (archivo) => writeFileSync(archivo, 'vieja') }
  );
  assert.equal(alLanzar.existia, false);
});

test('si no se puede guardar la imagen, la consulta termina con error y no se lanza Claude Code', async () => {
  // Una carpeta con el nombre del archivo: escribir encima falla.
  const { r, api, alLanzar } = await correrConImagen(
    { id: 'img6', canal: 'web', marca: null, prompt: 'lee ./pantallazo.png', imagen: { datos: PNG_B64, mime: 'image/png' } },
    { preparar: (archivo) => mkdirSync(archivo) }
  );
  assert.equal(alLanzar.veces, 0);
  assert.match(r.error, /no pudo guardar la imagen/);
  assert.equal(api.llamadas.fin.length, 1);
  assert.match(api.llamadas.fin[0].error, /no pudo guardar la imagen/);
});
