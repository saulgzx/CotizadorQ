import { strict as assert } from 'node:assert';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, before, test } from 'node:test';

process.env.COTIZADOR_API_URL = 'http://cotizador.test';
process.env.COTIZADOR_USER = 'mcp_bot';
process.env.COTIZADOR_PASS = 'super-secreta';
process.env.COTIZADOR_MAX_RETRIES = '0';
process.env.STOCK_FALLO_TTL_SEG = '0';
process.env.STOCK_TTL_MIN = '0';
process.env.CATALOGO_TTL_MIN = '0';
process.env.LOGIN_ENFRIAMIENTO_SEG = '0';

type Rapido = typeof import('../rapido.js');
type Tools = typeof import('../tools.js');
let rp: Rapido;
let tools: Tools;

const fetchOriginal = globalThis.fetch;
const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

before(async () => {
  process.env.STOCK_SNAPSHOT_PATH = join(await mkdtemp(join(tmpdir(), 'mcp-rapido-')), 'snap.json');
  rp = await import('../rapido.js');
  tools = await import('../tools.js');
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const CATALOGO = [
  { id: 1, origen: 'QNAP', marca: 'QNAP', sku: 'NW001QNA07', mpn: 'TS-435XeU-4G-US', descripcion: 'NAS 4 bahias', tiempo_entrega: '8 - 10 semanas tras OC', precio_cliente: 971.36 },
  { id: 2, origen: 'AXIS', marca: 'AXIS', sku: 'CA0123AXI01', mpn: '02345-001', descripcion: 'Camara P1475-LE', tiempo_entrega: '4 semanas', precio_cliente: 500 },
  { id: 3, origen: 'AXIS', marca: 'AXIS', sku: 'CA0124AXI01', mpn: '02346-001', descripcion: 'Camara P1465-LE', tiempo_entrega: '4 semanas', precio_cliente: 400 },
  { id: 4, origen: 'AXIS', marca: 'AXIS', sku: 'CA0125AXI01', mpn: '02346-002', descripcion: 'Camara P1465-LE-3', tiempo_entrega: '4 semanas', precio_cliente: 420 }
];

const precios = (cuerpo: { items: Array<{ producto_id: number; cantidad: number; gp?: number }>; partner_category?: string }) => ({
  partner_category: cuerpo.partner_category ?? 'todos',
  gp_por_defecto: { AXIS: 0.13, QNAP: 0.15 },
  costo_chile_disponible: true,
  no_encontrados: [],
  lineas: cuerpo.items.map((i) => {
    const p = CATALOGO.find((c) => c.id === i.producto_id)!;
    const base = { producto_id: p.id, sku: p.sku, mpn: p.mpn, descripcion: p.descripcion, cantidad: i.cantidad, gp: i.gp ?? 0.13, costo_base: 100, costo_base_fuente: 'disty' };
    return p.origen === 'AXIS'
      ? {
          ...base,
          origen: 'AXIS',
          niveles: [
            { nivel: cuerpo.partner_category ?? 'Gold', rebate: 10, costo_unitario: 90, precio_unitario: 100, margen_unitario: 10, precio_total: 100 * i.cantidad, margen_total: 10 * i.cantidad }
          ]
        }
      : { ...base, origen: 'QNAP', costo_unitario: 800, precio_unitario: 900, margen_unitario: 100, precio_total: 900 * i.cantidad, margen_total: 100 * i.cantidad };
  })
});

interface Opts {
  precios?: 'ok' | 403 | 500;
  stockFalla?: boolean;
}
const backend = (opts: Opts = {}) => {
  const llamadas: Array<{ metodo: string; ruta: string; cuerpo?: any }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const ruta = new URL(String(url)).pathname;
    const metodo = init?.method || 'GET';
    const cuerpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    llamadas.push({ metodo, ruta, cuerpo });
    if (ruta === '/api/login') return json(200, { token: 'jwt' });
    if (ruta === '/api/productos') return json(200, CATALOGO);
    if (ruta === '/api/stock') {
      if (opts.stockFalla) return json(500, { error: 'stock caido' });
      return json(200, { items: [{ mpn: 'TS-435XeU-4G-US', quantity: 12 }] });
    }
    if (ruta === '/api/precios/calcular') {
      if (opts.precios === 403) return json(403, { error: 'Sin permiso para ver costos' });
      if (opts.precios === 500) return json(500, { error: 'boom' });
      return json(200, precios(cuerpo));
    }
    return json(404, {});
  }) as typeof fetch;
  return { llamadas, cuenta: (ruta: string) => llamadas.filter((l) => l.ruta === ruta).length };
};

test('una llamada resuelve ficha, stock y entrega de todos los items, y lista los no resueltos', async () => {
  const b = backend();
  const r = await rp.cotizarRapido([
    { sku: 'TS-435XeU-4G-US', cantidad: 2 },
    { sku: '02345-001', cantidad: 3 },
    { sku: 'NO-EXISTE', cantidad: 1 },
    { sku: '02346', cantidad: 1 } // ambiguo: 02346-001 y 02346-002
  ]);
  assert.equal(r.lineas.length, 2);
  const nas = r.lineas[0];
  assert.equal(nas.ficha.sku, 'NW001QNA07');
  assert.equal(nas.ficha.marca, 'QNAP');
  assert.equal(nas.ficha.stock, 12);
  assert.match(String(nas.ficha.entrega), /12 unidades disponible en entrega inmediata/);
  assert.equal(nas.precio_total_lista, 1942.72);
  const cam = r.lineas[1];
  assert.equal(cam.ficha.entrega, '4 semanas'); // verificado y sin stock: plazo de catalogo
  assert.equal(r.no_resueltos.length, 2);
  assert.match(r.no_resueltos.find((n) => n.sku === '02346')!.motivo, /Ambiguo, 2 coincidencias/);
  assert.equal(r.totales.total_lista, 3442.72);
  assert.equal(r.totales.unidades, 5);
  assert.equal(r.calculo_pedido, false);
  // Una sola lectura de catalogo y de stock; sin calculo no se toca /api/precios.
  assert.equal(b.cuenta('/api/productos'), 1);
  assert.equal(b.cuenta('/api/stock'), 1);
  assert.equal(b.cuenta('/api/login'), 1);
  assert.equal(b.cuenta('/api/precios/calcular'), 0);
});

test('es de solo lectura: nunca hace POST a cotizaciones', async () => {
  const b = backend();
  await rp.cotizarRapido([{ sku: '02345-001', cantidad: 1 }], { partner_category: 'Gold' });
  const escrituras = b.llamadas.filter((l) => l.metodo !== 'GET' && l.ruta !== '/api/login' && l.ruta !== '/api/precios/calcular');
  assert.deepEqual(escrituras, []);
});

test('con partner y GP por linea calcula el precio y los totales en una sola llamada al backend', async () => {
  const b = backend();
  const r = await rp.cotizarRapido(
    [
      { sku: '02345-001', cantidad: 2, gp: 8 },
      { sku: 'TS-435XeU-4G-US', cantidad: 1 },
      { sku: '02345-001', cantidad: 1 } // repetido: se suma y conserva el gp de la primera
    ],
    { partner_category: 'Gold', gp_qnap: 15 }
  );
  assert.equal(b.cuenta('/api/precios/calcular'), 1);
  const cuerpo = b.llamadas.find((l) => l.ruta === '/api/precios/calcular')!.cuerpo;
  assert.equal(cuerpo.partner_category, 'Gold');
  assert.equal(cuerpo.gp_qnap, 15);
  assert.deepEqual(cuerpo.items, [
    { producto_id: 2, cantidad: 3, gp: 8 },
    { producto_id: 1, cantidad: 1 }
  ]);
  assert.equal(r.calculo_disponible, true);
  assert.equal(r.lineas[0].calculo?.niveles?.[0].precio_total, 300);
  assert.equal(r.lineas[1].calculo?.precio_total, 900);
  assert.equal(r.totales.total_calculado, 1200);
  assert.equal(r.totales.margen_total, 130);
});

test('un 403 en el calculo devuelve lista y stock con un aviso claro', async () => {
  backend({ precios: 403 });
  const r = await rp.cotizarRapido([{ sku: 'TS-435XeU-4G-US', cantidad: 1 }], { partner_category: 'Gold' });
  assert.equal(r.calculo_pedido, true);
  assert.equal(r.calculo_disponible, false);
  assert.match(r.calculo_aviso ?? '', /403/);
  assert.match(r.calculo_aviso ?? '', /no inventes/);
  assert.equal(r.lineas[0].calculo, null);
  assert.equal(r.lineas[0].ficha.stock, 12);
  assert.equal(r.totales.total_lista, 971.36);
  assert.equal(r.totales.total_calculado, null);
});

test('otro error del calculo tambien degrada a precio de lista', async () => {
  backend({ precios: 500 });
  const r = await rp.cotizarRapido([{ sku: '02345-001', cantidad: 1 }], { gp_axis: 10 });
  assert.equal(r.calculo_disponible, false);
  assert.match(r.calculo_aviso ?? '', /No se pudo calcular/);
  assert.equal(r.totales.total_lista, 500);
});

test('con el stock caido la entrega no se afirma (stock no verificado)', async () => {
  backend({ stockFalla: true });
  const r = await rp.cotizarRapido([{ sku: '02345-001', cantidad: 1 }]);
  assert.equal(r.lineas[0].ficha.stock_verificado, false);
  assert.equal(r.lineas[0].ficha.entrega, null);
  assert.equal(r.lineas[0].ficha.entrega_catalogo, '4 semanas');
});

type Handler = (args: unknown) => Promise<{ content: Array<{ text: string }> }>;
const registrar = () => {
  const handlers = new Map<string, Handler>();
  tools.registrarTools({
    registerTool: (nombre: string, _def: unknown, h: Handler) => handlers.set(nombre, h)
  } as never);
  return handlers;
};

test('la tool cotizar_rapido esta registrada y entrega texto + JSON con el aviso del 403', async () => {
  backend({ precios: 403 });
  const handlers = registrar();
  assert.ok(handlers.has('cotizar_rapido'));
  const res = await handlers.get('cotizar_rapido')!({
    items: [{ sku: 'TS-435XeU-4G-US', cantidad: 1 }, { sku: 'XXX', cantidad: 1 }],
    partner_category: 'Gold'
  });
  assert.match(res.content[0].text, /Cotizacion rapida \(NO guardada\)/);
  assert.match(res.content[0].text, /Precio por partner\/GP no disponible/);
  assert.match(res.content[0].text, /SKUs no encontrados \(1\)/);
  const datos = JSON.parse(res.content[1].text.replace(/^```json\n/, '').replace(/\n```$/, ''));
  assert.equal(datos.guardado, false);
  assert.equal(datos.lineas[0].sku, 'NW001QNA07');
  assert.equal(datos.lineas[0].precio_cliente, 971.36);
  assert.equal(datos.lineas[0].precio_calculado, null);
  assert.equal(datos.calculo.disponible, false);
  assert.equal(datos.no_resueltos[0].sku, 'XXX');
});

test('consultar_producto mantiene la misma ficha que cotizar_rapido', async () => {
  backend();
  const handlers = registrar();
  const uno = await handlers.get('consultar_producto')!({ sku: 'TS-435XeU-4G-US' });
  const datos = JSON.parse(uno.content[1].text.replace(/^```json\n/, '').replace(/\n```$/, ''));
  const r = await rp.cotizarRapido([{ sku: 'TS-435XeU-4G-US', cantidad: 1 }]);
  const { diagnostico_stock: _d, ...sinDiag } = datos;
  const { encontrado, stock_leido_en: _t1, ...ficha } = sinDiag;
  const { stock_leido_en: _t2, ...fichaRapida } = r.lineas[0].ficha;
  assert.equal(encontrado, true);
  assert.deepEqual(fichaRapida, ficha);
});
