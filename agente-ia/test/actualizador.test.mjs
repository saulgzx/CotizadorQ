import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comprobarActualizacion, crearGit, CODIGO_ACTUALIZADO } from '../actualizador.mjs';
import { leerConfig, principal } from '../agente.mjs';
import { siguienteEspera, supervisar } from '../iniciar.mjs';
import { EventEmitter } from 'node:events';

const ok = (salida = '') => ({ codigo: 0, salida, error: '' });
const mal = (error = 'fallo', codigo = 1) => ({ codigo, salida: '', error });

// git falso: responde segun el subcomando y registra lo ejecutado.
const gitFalso = (respuestas = {}) => {
  const llamadas = [];
  const git = async (args) => {
    llamadas.push(args);
    const clave = args.join(' ');
    for (const [prefijo, r] of Object.entries(respuestas)) if (clave.startsWith(prefijo)) return r;
    return ok();
  };
  git.llamadas = llamadas;
  return git;
};

const base = {
  'rev-parse --abbrev-ref HEAD': ok('main'),
  'fetch origin main': ok(),
  'rev-parse HEAD': ok('aaa1111'),
  'rev-parse origin/main': ok('bbb2222'),
  'merge-base --is-ancestor': ok(),
  'status --porcelain': ok(''),
  'diff --name-only': ok('agente.mjs'),
  'pull --ff-only origin main': ok()
};
const correr = (cambios = {}, extra = {}) => {
  const git = gitFalso({ ...base, ...cambios });
  const instalaciones = [];
  const logs = [];
  const instalar = async () => (instalaciones.push(1), extra.npm || { ok: true });
  return comprobarActualizacion({ git, instalar, log: (m) => logs.push(m), ...extra.opts }).then((r) => ({ r, git, instalaciones, logs }));
};
const hizoPull = (git) => git.llamadas.some((a) => a[0] === 'pull');

test('atrasado y limpio en main: hace pull --ff-only y pide reiniciar', async () => {
  const { r, git, instalaciones } = await correr();
  assert.equal(r.estado, 'actualizado');
  assert.deepEqual(git.llamadas.find((a) => a[0] === 'pull'), ['pull', '--ff-only', 'origin', 'main']);
  assert.equal(instalaciones.length, 0);
});

test('al dia: no hace pull', async () => {
  const { r, git } = await correr({ 'rev-parse origin/main': ok('aaa1111') });
  assert.equal(r.estado, 'al-dia');
  assert.equal(hizoPull(git), false);
});

test('arbol sucio: no hace pull y avisa', async () => {
  const { r, git, logs } = await correr({ 'status --porcelain': ok(' M agente-ia/agente.mjs') });
  assert.equal(r.estado, 'sucio');
  assert.equal(hizoPull(git), false);
  assert.match(logs.join('\n'), /cambios locales/);
});

test('otra rama: no hace fetch ni pull', async () => {
  const { r, git } = await correr({ 'rev-parse --abbrev-ref HEAD': ok('feature/x') });
  assert.equal(r.estado, 'otra-rama');
  assert.equal(git.llamadas.some((a) => a[0] === 'fetch' || a[0] === 'pull'), false);
});

test('fetch falla: no hace pull y sigue funcionando', async () => {
  const { r, git } = await correr({ 'fetch origin main': mal('sin red') });
  assert.equal(r.estado, 'fetch-fallo');
  assert.equal(hizoPull(git), false);
});

test('sin git: avisa y no hace nada', async () => {
  const { r, git } = await correr({ 'rev-parse --abbrev-ref HEAD': mal('not a git repository', 128) });
  assert.equal(r.estado, 'sin-git');
  assert.equal(git.llamadas.length, 1);
});

test('commits locales (divergido): no hace pull', async () => {
  const { r, git } = await correr({ 'merge-base --is-ancestor': mal('', 1) });
  assert.equal(r.estado, 'divergido');
  assert.equal(hizoPull(git), false);
});

test('pull falla: estado pull-fallo, no pide reiniciar', async () => {
  const { r } = await correr({ 'pull --ff-only origin main': mal('Not possible to fast-forward') });
  assert.equal(r.estado, 'pull-fallo');
});

test('instala dependencias solo si cambio package.json o el lockfile', async () => {
  const a = await correr({ 'diff --name-only': ok('package-lock.json\nagente.mjs') });
  assert.equal(a.instalaciones.length, 1);
  const b = await correr({ 'diff --name-only': ok('package.json') });
  assert.equal(b.instalaciones.length, 1);
  const c = await correr({ 'diff --name-only': ok('README.md') });
  assert.equal(c.instalaciones.length, 0);
});

test('nunca usa reset, stash ni fuerza', async () => {
  const { git } = await correr();
  const todo = git.llamadas.flat().join(' ');
  assert.doesNotMatch(todo, /reset|stash|--force|-f\b|clean|checkout/);
});

test('npm falla: no reinicia y reintenta en la pasada siguiente', async () => {
  const fallo = await correr({ 'diff --name-only': ok('package.json') }, { npm: { ok: false, error: 'E404' } });
  assert.equal(fallo.r.estado, 'npm-fallo');
  // Ya con el codigo nuevo (HEAD == origin/main) pero con npm pendiente.
  const reintento = await correr({ 'rev-parse origin/main': ok('aaa1111') }, { opts: { npmPendiente: true } });
  assert.equal(reintento.r.estado, 'actualizado');
  assert.equal(reintento.instalaciones.length, 1);
});

test('crearGit lanza git sin shell y con timeout', async () => {
  let visto;
  const git = crearGit('/x', {
    execFileImpl: (cmd, args, opts, cb) => {
      visto = { cmd, args, opts };
      cb(null, 'abc\n', '');
    }
  });
  const r = await git(['rev-parse', 'HEAD'], { timeout: 1234 });
  assert.equal(r.salida, 'abc');
  assert.equal(visto.cmd, 'git');
  assert.equal(visto.opts.timeout, 1234);
  assert.ok(!visto.opts.shell);
});

test('crearGit nunca rechaza: devuelve el error', async () => {
  const git = crearGit('/x', { execFileImpl: (c, a, o, cb) => cb(Object.assign(new Error('boom'), { code: 128 }), '', 'fatal: x') });
  assert.deepEqual(await git(['status']), { codigo: 128, salida: '', error: 'fatal: x' });
});

// --- integracion con el bucle del agente ---------------------------------------

const configAct = { ...leerConfig({ MYQUOTE_API_URL: 'https://x', IA_AGENTE_TOKEN: 't' }), autoActualizarMs: 1000 };

test('leerConfig: AUTO_ACTUALIZAR y AUTO_ACTUALIZAR_MIN', () => {
  const d = leerConfig({});
  assert.equal(d.autoActualizar, true);
  assert.equal(d.autoActualizarMs, 10 * 60 * 1000);
  assert.equal(leerConfig({ AUTO_ACTUALIZAR: '0' }).autoActualizar, false);
  assert.equal(leerConfig({ AUTO_ACTUALIZAR: 'false' }).autoActualizar, false);
  assert.equal(leerConfig({ AUTO_ACTUALIZAR_MIN: '3' }).autoActualizarMs, 180000);
});

test('el agente revisa actualizaciones ocioso y sale cuando se actualizo', async () => {
  let t = 0;
  let revisiones = 0;
  const api = { tomar: async () => ((t += 600), null), avance: async () => true, fin: async () => {} };
  const r = await principal({
    config: configAct,
    api,
    log: () => {},
    ahora: () => t,
    actualizador: async () => (++revisiones, { estado: revisiones >= 2 ? 'actualizado' : 'al-dia' })
  });
  assert.deepEqual(r, { actualizado: true });
  assert.equal(revisiones, 2);
});

test('no revisa mientras resuelve una consulta (solo entre consultas)', async () => {
  let t = 0;
  const orden = [];
  const trabajos = [{ id: 'abc12345', canal: 'web', prompt: 'x' }];
  const api = {
    tomar: async () => {
      orden.push('tomar');
      t += 5000;
      return trabajos.shift() || null;
    },
    avance: async () => true,
    fin: async () => {}
  };
  const { EventEmitter: EE } = await import('node:events');
  const spawnImpl = () => {
    orden.push('claude');
    const h = new EE();
    h.stdout = Object.assign(new EE(), { setEncoding() {} });
    h.stderr = Object.assign(new EE(), { setEncoding() {} });
    h.stdin = Object.assign(new EE(), { end() {} });
    setImmediate(() => {
      h.stdout.emit('data', JSON.stringify({ type: 'result', is_error: false, result: 'ok' }) + '\n');
      h.emit('close', 0);
    });
    return h;
  };
  await principal({
    config: configAct,
    api,
    log: () => {},
    ahora: () => t,
    spawnImpl,
    actualizador: async () => (orden.push('revisar'), { estado: 'actualizado' })
  });
  // La revision llega despues de resolver la consulta, nunca en medio.
  assert.deepEqual(orden, ['tomar', 'claude', 'revisar']);
});

// --- supervisor ----------------------------------------------------------------

const hijoQueSale = (codigo) => () => {
  const h = new EventEmitter();
  setImmediate(() => h.emit('close', codigo, null));
  return h;
};

test('supervisor: relanza al instante tras actualizarse', async () => {
  const esperas = [];
  const codigos = [CODIGO_ACTUALIZADO, CODIGO_ACTUALIZADO, 0];
  let lanzados = 0;
  await supervisar({
    spawnImpl: () => hijoQueSale(codigos[lanzados++])(),
    esperar: async (ms) => esperas.push(ms),
    log: () => {},
    maxLanzamientos: 3
  });
  assert.equal(lanzados, 3);
  assert.deepEqual(esperas, [2000]); // solo la caida final espera
});

test('supervisor: espera creciente en caidas repetidas, con tope', async () => {
  const esperas = [];
  let t = 0;
  await supervisar({
    spawnImpl: hijoQueSale(1),
    esperar: async (ms) => esperas.push(ms),
    ahora: () => t++,
    log: () => {},
    maxLanzamientos: 12
  });
  assert.deepEqual(esperas.slice(0, 4), [2000, 4000, 8000, 16000]);
  assert.equal(Math.max(...esperas), 300000);
  assert.equal(siguienteEspera(300000), 300000);
});

test('supervisor: si el agente vivio estable, la espera vuelve a empezar', async () => {
  const esperas = [];
  let t = 0;
  await supervisar({
    spawnImpl: () => {
      t += 120000; // cada ejecucion dura 2 min
      return hijoQueSale(1)();
    },
    esperar: async (ms) => esperas.push(ms),
    ahora: () => t,
    log: () => {},
    maxLanzamientos: 3
  });
  assert.deepEqual(esperas, [2000, 2000, 2000]);
});

test('supervisor: se detiene cuando se pide parar', async () => {
  const detenido = { valor: false };
  let lanzados = 0;
  await supervisar({
    spawnImpl: () => (lanzados++, detenido.valor = true, hijoQueSale(1)()),
    esperar: async () => {},
    log: () => {},
    detenido
  });
  assert.equal(lanzados, 1);
});
