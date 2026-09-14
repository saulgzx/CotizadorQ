import { strict as assert } from 'node:assert';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, before, test } from 'node:test';

// El cliente lee la configuracion al importarse: se fija antes del import.
process.env.COTIZADOR_API_URL = 'http://cotizador.test';
process.env.COTIZADOR_USER = 'mcp_bot';
process.env.COTIZADOR_PASS = 'super-secreta';
process.env.COTIZADOR_MAX_RETRIES = '0';
process.env.STOCK_FALLO_TTL_SEG = '0';
process.env.STOCK_TTL_MIN = '0';
process.env.CATALOGO_TTL_MIN = '0';
process.env.LOGIN_ENFRIAMIENTO_SEG = '0';

type Cotizador = typeof import('../cotizador.js');
type Snapshot = typeof import('../snapshot.js');
let cz: Cotizador;
let snap: Snapshot;

const fetchOriginal = globalThis.fetch;
const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

before(async () => {
  process.env.STOCK_SNAPSHOT_PATH = join(await mkdtemp(join(tmpdir(), 'mcp-test-')), 'snap.json');
  cz = await import('../cotizador.js');
  snap = await import('../snapshot.js');
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/**
 * Simula el backend real: el INSERT de sesion tiene indice unico
 * (user_id, session_id), asi que un segundo login concurrente con el mismo
 * X-Session-Id responde 500.
 */
const backendConCarrera = (opts: { stockFalla?: () => boolean; loginFalla?: () => boolean } = {}) => {
  let loginsEnVuelo = 0;
  let loginsTotales = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const ruta = new URL(String(url)).pathname;
    if (ruta === '/api/login') {
      loginsTotales += 1;
      loginsEnVuelo += 1;
      await new Promise((r) => setTimeout(r, 20));
      loginsEnVuelo -= 1;
      if (opts.loginFalla?.()) return json(500, { error: 'Error del servidor' });
      if (loginsEnVuelo > 0) return json(500, { error: 'Error del servidor' });
      assert.match(String(init?.body), /mcp_bot/);
      return json(200, { token: 'jwt-de-prueba' });
    }
    if (ruta === '/api/productos') {
      return json(200, [
        { id: 1, origen: 'QNAP', marca: 'QNAP', sku: 'NW001QNA07', mpn: 'TS-435XeU-4G-US', descripcion: 'NAS', tiempo_entrega: '8 - 10 semanas tras OC', precio_cliente: 971.36 }
      ]);
    }
    if (ruta === '/api/stock') {
      if (opts.stockFalla?.()) return json(500, { error: 'Error leyendo stock' });
      return json(200, { items: [{ mpn: 'TS-435XeU-4G-US', quantity: 12 }] });
    }
    return json(404, {});
  }) as typeof fetch;
  return { logins: () => loginsTotales };
};

test('T0.1 · catalogo y stock en paralelo disparan un solo login', async () => {
  const backend = backendConCarrera();
  const [catalogo, stock] = await Promise.all([cz.getCatalogo(), cz.getStock()]);
  assert.equal(backend.logins(), 1);
  assert.equal(catalogo.length, 1);
  assert.equal(stock.verificado, true);
  assert.equal(stock.mapa.get('TS-435XEU-4G-US'), 12);
});

test('T0.1 · el error de login lleva el mensaje del backend y nunca la contraseña', async () => {
  // Se parte sin token: un 401 en /api/productos obliga a re-loguear.
  let primera = true;
  globalThis.fetch = (async (url: string | URL) => {
    const ruta = new URL(String(url)).pathname;
    if (ruta === '/api/login') return json(500, { error: 'Error del servidor', eco: 'super-secreta' });
    if (primera) {
      primera = false;
      return json(401, { error: 'Token invalido' });
    }
    return json(200, []);
  }) as typeof fetch;

  const errores: string[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => errores.push(args.map(String).join(' '));
  try {
    await assert.rejects(
      () => cz.loginForzado(),
      (error: Error) => {
        assert.match(error.message, /HTTP 500: Error del servidor/);
        assert.match(error.message, /lado de CotizadorQ/);
        assert.doesNotMatch(error.message, /super-secreta/);
        return true;
      }
    );
  } finally {
    console.error = consoleError;
  }
  const log = errores.join('\n');
  assert.match(log, /"status":500/);
  assert.doesNotMatch(log, /super-secreta/);
  assert.equal(cz.getUltimoFalloLogin()?.error_backend, 'Error del servidor');
});

test('T0.3 · con el stock caido se sirve la ultima lectura buena, fechada y no verificada', async () => {
  let caido = false;
  backendConCarrera({ stockFalla: () => caido });
  await cz.loginForzado();

  // Lectura buena: queda como snapshot (STOCK_TTL_MIN=0, la cache vence al tiro).
  const buena = await cz.getStock();
  assert.equal(buena.verificado, true);
  snap._reiniciarSnapshot(); // obliga a releerlo desde disco, como tras un reinicio

  caido = true;
  await new Promise((r) => setTimeout(r, 5));
  const lectura = await cz.getStock();
  assert.equal(lectura.verificado, false);
  assert.equal(lectura.origen, 'snapshot');
  assert.equal(lectura.leido_en, buena.leido_en);
  assert.equal(lectura.mapa.get('TS-435XEU-4G-US'), 12);
  assert.match(lectura.error || '', /HTTP 500/);
});
