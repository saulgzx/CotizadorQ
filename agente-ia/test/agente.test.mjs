import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { argumentosClaude, describirHerramienta, leerConfig, principal, procesarEvento } from '../agente.mjs';

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
  assert.ok(!permitidas.includes('mcp__myquote__generar_cotizacion'));
  assert.ok(!permitidas.includes('Bash'));
  assert.match(args[args.indexOf('--disallowedTools') + 1], /Bash/);
});

test('describe los pasos y omite las lecturas de la skill', () => {
  assert.equal(describirHerramienta({ name: 'mcp__myquote__consultar_producto', input: { sku: 'TS-464' } }), 'Consultando precio y stock: TS-464');
  assert.equal(describirHerramienta({ name: 'Read', input: {} }), null);
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
  assert.deepEqual(api.llamadas.fin, [{ id: 'abc12345', texto: r.texto }]);
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
  assert.deepEqual(api.llamadas.fin, [{ id: 'def', error: 'límite de uso alcanzado' }]);
});
