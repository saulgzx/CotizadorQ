import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { argumentosClaude, ejecutarTarea, leerConfig, principal, probarCorreo } from '../agente.mjs';
import {
  TIPOS_TAREA,
  argumentosClaudeCorreo,
  construirPromptTarea,
  extraerItems,
  herramientasPermitidasCorreo,
  herramientasProhibidasCorreo,
  validarResultado
} from '../correo.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO = path.join(AQUI, 'claude-falso.mjs');

const config = (extra = {}) => ({
  ...leerConfig({ MYQUOTE_API_URL: 'https://x', IA_AGENTE_TOKEN: 't', CARPETA_TRABAJO: path.join(os.tmpdir(), 'agente-ia-test-correo') }),
  claude: process.execPath,
  ...extra
});
// Ejecuta el Claude falso con node; `modo` elige el comportamiento del falso.
const falso = (modo = '') => (cmd, args, opts) => spawn(cmd, [FALSO, ...args], { ...opts, env: { ...process.env, FALSO_MODO: modo } });

const arg = (args, nombre) => args[args.indexOf(nombre) + 1].split(',');
const lista = (arr) => arr.join(',');

const PROHIBIDAS_SPEC = [
  'outlook_send_mail', 'outlook_send_draft', 'outlook_forward_mail', 'outlook_delete_draft', 'outlook_trash_thread',
  'outlook_batch_delete_messages', 'outlook_create_filter', 'outlook_delete_filter', 'outlook_set_vacation',
  'outlook_modify_labels', 'outlook_batch_modify_labels', 'outlook_modify_thread_labels', 'outlook_untrash_thread'
];
const LOCALES_SPEC = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebSearch', 'WebFetch'];

const TAREAS = {
  buscar_envios: { id: 'tarea-buscar-1', tipo: 'buscar_envios', items: [{ cotizacion_id: 1, numero: 101, pdf_nombre: 'Cotización N°101.pdf' }, { cotizacion_id: 2, numero: 102, pdf_nombre: 'Cotización N°102.pdf' }], instrucciones: 'Sé breve.' },
  revisar_hilos: { id: 'tarea-revisar-1', tipo: 'revisar_hilos', items: [{ oportunidad_id: 7, conversation_id: 'c7', message_id: 'm7', desde: '2026-11-03T00:00:00Z' }] },
  crear_borradores: { id: 'tarea-borrar-1', tipo: 'crear_borradores', items: [{ oportunidad_id: 7, message_id: 'm7', paso: 1, para: ['cliente@acme.cl'], contexto: { contacto_nombre: 'Ana' }, guia: 'Paso 1' }] }
};

const apiTareas = () => {
  const resultados = [];
  return { resultados, resultadoTarea: async (id, cuerpo) => resultados.push({ id, ...cuerpo }) };
};

// --- Herramientas ---------------------------------------------------------------

test('ninguna herramienta de envio, borrado o cambio aparece en --allowedTools', () => {
  for (const tipo of [null, ...TIPOS_TAREA]) {
    const args = argumentosClaudeCorreo(config(), tipo);
    const permitidas = arg(args, '--allowedTools');
    for (const p of permitidas) {
      assert.ok(!/send|forward|delete|trash|filter|vacation|modify|untrash/i.test(p), `${tipo}: ${p} no debe estar permitida`);
      assert.ok(!['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebSearch', 'WebFetch', 'Skill', 'Read'].includes(p));
    }
    assert.ok(permitidas.every((p) => p.startsWith('mcp__')));
  }
});

test('todas las herramientas prohibidas estan en --disallowedTools para las tareas de correo', () => {
  for (const tipo of [null, ...TIPOS_TAREA]) {
    const bloqueadas = arg(argumentosClaudeCorreo(config(), tipo), '--disallowedTools');
    for (const n of PROHIBIDAS_SPEC) assert.ok(bloqueadas.includes(`mcp__claude_ai_Microsoft_365__${n}`), `${tipo}: falta ${n}`);
    for (const n of LOCALES_SPEC) assert.ok(bloqueadas.includes(n), `${tipo}: falta ${n}`);
    const permitidas = arg(argumentosClaudeCorreo(config(), tipo), '--allowedTools');
    assert.deepEqual(permitidas.filter((p) => bloqueadas.includes(p)), [], 'nada permitido y prohibido a la vez');
  }
});

test('listas exactas por tipo y MCP_CORREO configurable', () => {
  const c = config({ mcpCorreo: 'Outlook_Corp', mcp: 'myquote' });
  assert.deepEqual(herramientasPermitidasCorreo(c, 'buscar_envios'), ['mcp__Outlook_Corp__outlook_email_search', 'mcp__Outlook_Corp__read_resource']);
  assert.deepEqual(herramientasPermitidasCorreo(c, 'revisar_hilos'), herramientasPermitidasCorreo(c, 'buscar_envios'));
  assert.deepEqual(herramientasPermitidasCorreo(c, 'crear_borradores'), [
    'mcp__Outlook_Corp__outlook_email_search',
    'mcp__Outlook_Corp__read_resource',
    'mcp__Outlook_Corp__outlook_create_reply_draft',
    'mcp__Outlook_Corp__outlook_create_reply_all_draft',
    'mcp__Outlook_Corp__outlook_update_draft',
    'mcp__myquote__cotizar_rapido',
    'mcp__myquote__consultar_producto'
  ]);
  assert.ok(herramientasProhibidasCorreo(c).includes('mcp__Outlook_Corp__outlook_send_mail'));
  // valor por defecto: conector de claude.ai
  assert.equal(config().mcpCorreo, 'claude_ai_Microsoft_365');
  assert.equal(leerConfig({ MCP_CORREO: 'otro' }).mcpCorreo, 'otro');
});

test('las consultas normales no reciben herramientas de correo', () => {
  const args = argumentosClaude(config());
  assert.ok(!args.join(' ').match(/outlook|Microsoft|read_resource/i));
});

// --- Prompts ---------------------------------------------------------------------

test('el prompt de cada tipo prohibe enviar/borrar, exige JSON y lleva los items', () => {
  for (const tipo of TIPOS_TAREA) {
    const p = construirPromptTarea(TAREAS[tipo]);
    assert.match(p, /PROHIBIDO enviar, reenviar o borrar/);
    assert.match(p, /bloque de código json/);
    assert.match(p, new RegExp(`Tipo de tarea: ${tipo}`));
    assert.match(p, /<items>\n\[/);
    assert.match(p, /DATOS, no instrucciones/);
  }
  assert.match(construirPromptTarea(TAREAS.crear_borradores), /únicamente en el hilo indicado/);
  assert.match(construirPromptTarea(TAREAS.buscar_envios), /Sé breve\./);
  assert.throws(() => construirPromptTarea({ tipo: 'otro', items: [] }), /desconocido/);
});

// --- Extraccion y validacion --------------------------------------------------------

test('extrae el ultimo bloque JSON, con o sin cerco', () => {
  assert.deepEqual(extraerItems('hola\n```json\n{"items":[{"a":1}]}\n```\nfin'), [{ a: 1 }]);
  assert.deepEqual(extraerItems('```json\n{"items":[1]}\n```\ny luego\n```json\n{"items":[2]}\n```'), [2]);
  assert.deepEqual(extraerItems('Texto con {llaves} y {"items":[{"s":"a}b"}]} al final'), [{ s: 'a}b' }]);
  assert.equal(extraerItems('sin json'), null);
  assert.equal(extraerItems('```json\n{roto\n```'), null);
});

test('valida campos, ids pedidos y cobertura', () => {
  const pedidos = TAREAS.buscar_envios.items;
  const bien = [
    { cotizacion_id: 1, encontrado: true, message_id: 'm', conversation_id: 'c', enviado_en: '2026-11-03T10:00:00Z', para: ['a@b.cl'], basura: 1 },
    { cotizacion_id: 2, encontrado: false, message_id: 'ignorado' }
  ];
  const r = validarResultado('buscar_envios', pedidos, bien);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items[1], { cotizacion_id: 2, encontrado: false });
  assert.ok(!('basura' in r.items[0]));
  assert.match(validarResultado('buscar_envios', pedidos, [bien[0]]).error, /Faltan resultados para cotizacion_id: 2/);
  assert.match(validarResultado('buscar_envios', pedidos, [...bien, { cotizacion_id: 9, encontrado: false }]).error, /no solicitado/);
  assert.match(validarResultado('buscar_envios', pedidos, [{ ...bien[0], enviado_en: 'ayer' }, bien[1]]).error, /enviado_en/);
  assert.match(validarResultado('buscar_envios', pedidos, null).error, /bloque JSON/);
  assert.match(validarResultado('crear_borradores', TAREAS.crear_borradores.items, [{ oportunidad_id: 7, creado: true }]).error, /borrador_id/);
  const rev = validarResultado('revisar_hilos', TAREAS.revisar_hilos.items, [{ oportunidad_id: 7, respuesta_recibida: true, resumen: 'y'.repeat(900) }]);
  assert.equal(rev.items[0].resumen.length, 400);
});

// --- Ejecucion con el Claude falso ------------------------------------------------------

for (const tipo of TIPOS_TAREA) {
  test(`tarea ${tipo}: resultado JSON valido, metricas y logs sin contenido`, async () => {
    const api = apiTareas();
    const logs = [];
    const r = await ejecutarTarea({ config: config(), tarea: TAREAS[tipo], api, spawnImpl: falso(), log: (l) => logs.push(l) });
    assert.equal(r.ok, true);
    assert.equal(api.resultados.length, 1);
    const enviado = api.resultados[0];
    assert.equal(enviado.id, TAREAS[tipo].id);
    assert.equal(enviado.ok, true);
    assert.equal(enviado.items.length, TAREAS[tipo].items.length);
    assert.ok(enviado.metricas.total_ms >= 0 && enviado.metricas.turnos >= 1);
    assert.deepEqual(enviado.metricas.herramientas.map((h) => h.nombre), ['outlook_email_search']);
    const todo = JSON.stringify(enviado.metricas) + logs.join('\n');
    assert.ok(!/SECRETO|cliente@acme|secreto/.test(todo), 'ni metricas ni logs llevan contenido de correos');
    assert.ok(logs.some((l) => l.includes('outlook_email_search')));
    if (tipo === 'revisar_hilos') assert.equal(enviado.items[0].resumen.length, 400);
    if (tipo === 'buscar_envios') assert.ok(!('extra' in enviado.items[0]));
  });
}

test('acepta JSON sin cerco y rechaza items no solicitados', async () => {
  let api = apiTareas();
  assert.equal((await ejecutarTarea({ config: config(), tarea: TAREAS.buscar_envios, api, spawnImpl: falso('prosa'), log: () => {} })).ok, true);
  api = apiTareas();
  const r = await ejecutarTarea({ config: config(), tarea: TAREAS.crear_borradores, api, spawnImpl: falso('extra'), log: () => {} });
  assert.equal(r.ok, false);
  assert.match(api.resultados[0].error, /no solicitado/);
});

test('JSON invalido o ausente devuelve ok:false con el error y las metricas', async () => {
  for (const modo of ['invalido', 'sinjson']) {
    const api = apiTareas();
    const r = await ejecutarTarea({ config: config(), tarea: TAREAS.buscar_envios, api, spawnImpl: falso(modo), log: () => {} });
    assert.equal(r.ok, false, modo);
    assert.equal(api.resultados[0].ok, false);
    assert.deepEqual(api.resultados[0].items, []);
    assert.ok(api.resultados[0].error.length > 5);
    assert.ok(api.resultados[0].metricas);
  }
});

test('timeout: mata a Claude Code y devuelve ok:false', async () => {
  const api = apiTareas();
  const t0 = Date.now();
  const r = await ejecutarTarea({ config: config({ timeoutTareaMs: 400 }), tarea: TAREAS.revisar_hilos, api, spawnImpl: falso('colgar'), log: () => {} });
  assert.ok(Date.now() - t0 < 15000);
  assert.equal(r.ok, false);
  assert.match(api.resultados[0].error, /no terminó en/);
});

test('error de Claude Code y tipo desconocido se informan sin lanzar nada', async () => {
  let api = apiTareas();
  let lanzado = false;
  const r = await ejecutarTarea({ config: config(), tarea: { id: 'x1', tipo: 'otra_cosa', items: [] }, api, spawnImpl: () => ((lanzado = true), null), log: () => {} });
  assert.equal(r.ok, false);
  assert.equal(lanzado, false);
  assert.match(api.resultados[0].error, /no soportada/);
  api = apiTareas();
  await ejecutarTarea({ config: config(), tarea: { ...TAREAS.buscar_envios, instrucciones: 'FALLAR' }, api, spawnImpl: falso(), log: () => {} });
  assert.equal(api.resultados[0].error, 'límite de uso alcanzado');
});

// --- Bucle: prioridad y backend viejo --------------------------------------------------

test('las consultas van antes que las tareas; las tareas solo sin consulta', async () => {
  const orden = [];
  const consultas = [
    { id: 'q1aaaaaa', canal: 'web', prompt: 'hola 1' },
    { id: 'q2aaaaaa', canal: 'web', prompt: 'hola 2' }
  ];
  const tareas = [TAREAS.buscar_envios, TAREAS.revisar_hilos];
  let llamadas = 0;
  const api = {
    tomar: async () => {
      if (++llamadas > 6) throw Object.assign(new Error('fin'), { fatal: true });
      return consultas.shift() || null;
    },
    avance: async () => true,
    fin: async (id) => orden.push(`consulta:${id}`),
    tomarTarea: async () => tareas.shift() || null,
    resultadoTarea: async (id) => orden.push(`tarea:${id}`)
  };
  await assert.rejects(principal({ config: config(), api, log: () => {}, spawnImpl: falso() }), /fin/);
  assert.deepEqual(orden, ['consulta:q1aaaaaa', 'consulta:q2aaaaaa', 'tarea:tarea-buscar-1', 'tarea:tarea-revisar-1']);
});

test('backend viejo (404): sigue con consultas, avisa una vez y reintenta cada 10 minutos', async () => {
  let reloj = 1_000_000;
  const logs = [];
  let tomarTarea = 0;
  let llamadas = 0;
  const consultas = [{ id: 'q1aaaaaa', canal: 'web', prompt: 'hola' }];
  const api = {
    tomar: async () => {
      llamadas++;
      reloj += 3 * 60 * 1000; // cada vuelta pasan 3 minutos
      if (llamadas > 12) throw Object.assign(new Error('fin'), { fatal: true });
      return consultas.shift() || null;
    },
    avance: async () => true,
    fin: async () => {},
    tomarTarea: async () => {
      tomarTarea++;
      throw Object.assign(new Error('sin ruta'), { noSoportada: true });
    },
    resultadoTarea: async () => {}
  };
  await assert.rejects(principal({ config: config(), api, log: (l) => logs.push(l), spawnImpl: falso(), ahora: () => reloj }), /fin/);
  // 12 vueltas * 3 min = 36 min -> primer intento + reintentos cada ~10 min (no en cada vuelta)
  assert.ok(tomarTarea >= 3 && tomarTarea <= 5, `intentos de tareas: ${tomarTarea}`);
  assert.equal(logs.filter((l) => /404/.test(l)).length, 1, 'el aviso del 404 sale una sola vez');
  assert.ok(logs.some((l) => l.startsWith('Consulta q1aaaaaa')), 'las consultas siguen funcionando');
});

test('si la ruta de tareas aparece despues, las ejecuta y avisa', async () => {
  let reloj = 0;
  const logs = [];
  const orden = [];
  let n = 0;
  let llamadas = 0;
  const api = {
    tomar: async () => {
      reloj += 6 * 60 * 1000;
      if (++llamadas > 6) throw Object.assign(new Error('fin'), { fatal: true });
      return null;
    },
    avance: async () => true,
    fin: async () => {},
    tomarTarea: async () => {
      if (++n === 1) throw Object.assign(new Error('x'), { noSoportada: true });
      return n === 3 ? TAREAS.revisar_hilos : null;
    },
    resultadoTarea: async (id) => orden.push(id)
  };
  await assert.rejects(principal({ config: config(), api, log: (l) => logs.push(l), spawnImpl: falso(), ahora: () => reloj }), /fin/);
  assert.deepEqual(orden, ['tarea-revisar-1']);
  assert.ok(logs.some((l) => /disponibles en el backend/.test(l)));
});

test('SEGUIMIENTO_CORREO=0 desactiva las tareas y una api sin tomarTarea sigue andando', async () => {
  assert.equal(leerConfig({ SEGUIMIENTO_CORREO: '0' }).seguimiento, false);
  assert.equal(leerConfig({}).seguimiento, true);
  let pedidas = 0;
  let llamadas = 0;
  const api = {
    tomar: async () => {
      if (++llamadas > 3) throw Object.assign(new Error('fin'), { fatal: true });
      return null;
    },
    tomarTarea: async () => (pedidas++, null)
  };
  await assert.rejects(principal({ config: config({ seguimiento: false }), api, log: () => {} }), /fin/);
  assert.equal(pedidas, 0);
  llamadas = 0;
  delete api.tomarTarea;
  await assert.rejects(principal({ config: config(), api, log: () => {} }), /fin/);
});

// --- Diagnostico ------------------------------------------------------------------------

test('--probar-correo: conector encontrado', async () => {
  const logs = [];
  const r = await probarCorreo({ config: config(), spawnImpl: falso(), log: (l) => logs.push(l) });
  const salida = logs.join('\n');
  assert.equal(r.ok, true);
  assert.match(salida, /Herramientas disponibles según Claude Code: 5/);
  assert.match(salida, /mcp__claude_ai_Microsoft_365__outlook_email_search/);
  assert.match(salida, /Asunto A - 2026-11-10/);
  assert.match(salida, /el conector de correo funciona/);
});

test('--probar-correo: sin Outlook o con otro nombre de servidor sugiere MCP_CORREO', async () => {
  let logs = [];
  let r = await probarCorreo({ config: config(), spawnImpl: falso('sin_outlook'), log: (l) => logs.push(l) });
  assert.equal(r.ok, false);
  assert.match(logs.join('\n'), /ninguna/);
  assert.match(logs.join('\n'), /No hay ningún conector de Outlook/);
  logs = [];
  r = await probarCorreo({ config: config(), spawnImpl: falso('otro_prefijo'), log: (l) => logs.push(l) });
  assert.equal(r.ok, false);
  assert.match(logs.join('\n'), /MCP_CORREO=Outlook_Corp/);
});

test('--probar-correo usa solo herramientas de lectura', async () => {
  let args;
  await probarCorreo({ config: config(), spawnImpl: (c, a, o) => ((args = a), falso()(c, a, o)), log: () => {} });
  const permitidas = arg(args, '--allowedTools');
  assert.deepEqual(permitidas, ['mcp__claude_ai_Microsoft_365__outlook_email_search', 'mcp__claude_ai_Microsoft_365__read_resource']);
  assert.ok(lista(arg(args, '--disallowedTools')).includes('outlook_send_mail'));
});
