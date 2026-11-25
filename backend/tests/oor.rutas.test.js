/**
 * Rutas del OOR (/api/oor) con el repositorio en memoria: contrato, validacion y la lectura de
 * la planilla inyectada (solo POST /actualizar). Los permisos se prueban aparte
 * (crm.permisos.test.js) contra la app real.
 */
const express = require('express');
const request = require('supertest');
const { crearOorMemoria } = require('./helpers/oorMemoria');
const { crearRutasOor } = require('../src/oor/rutas');
const servicio = require('../src/oor/servicio');

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const CABECERA = ['Order Confirmation', 'Del No', 'Order No', 'Line No', 'Customer PO No', 'Created', 'Order Status', 'Status',
  'Sales Part', 'Sales Part Description', 'Sales Qty', 'Planned Ship Date', 'Planned Delivery Date', 'Days changed',
  'Previous Planned Deliver Date', 'Project Description'];
const hoja = (despacho, po = 575740) => [
  [...CABECERA],
  ['Confirmed', 1, 9001, 1, po, '09-04-2026', 'Released', 'Released', '02317-004', 'AXIS Q6225-LE', 1, despacho, '', 0, '', '']
];

const BO_SICE = {
  bo: 'BO-100', po_axis: '575740', customer_name: 'SICE', project_name: 'Metro', customer_po: 'OC-77',
  estimated_invoice_month: '2026-02', estimated_invoice_date: null, estimated_invoice_week: 2, deleted: false, invoiced: false
};

let mem;
let reloj;
let planilla; // lo que devuelve leerPestanaOor
let leerPestanaOor;
let app;

const avanzar = (seg) => { reloj = new Date(reloj.getTime() + seg * 1000); };

beforeEach(() => {
  jest.clearAllMocks();
  mem = crearOorMemoria({ bos: [BO_SICE] });
  reloj = new Date('2026-05-01T10:00:00Z');
  planilla = hoja('15-1-2026');
  leerPestanaOor = jest.fn(async () => planilla);
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
  app.use('/api/oor', crearRutasOor({ pool: mem.pool, repo: mem.repo, leerPestanaOor, ahora: () => reloj, log }));
});

const pendiente = () => request(app).get('/api/oor/cambios/pendiente');
const actualizar = () => request(app).post('/api/oor/actualizar');
const visto = (body) => request(app).post('/api/oor/cambios/visto').send(body);
// Registra "de pasada" la planilla actual, como hace GET /api/oso/orders.
const registrarDePasada = () => servicio.registrarLectura(mem.pool, planilla, { ahora: reloj, repo: mem.repo });

// Deja la base inicial y un atraso listo para anunciarse (estable).
const conAtrasoEstable = async () => {
  await registrarDePasada(); // version 15-1
  expect((await pendiente()).body).toEqual({ hay: false, motivo: 'primera_vez' });
  avanzar(400);
  planilla = hoja('10-6-2026');
  await registrarDePasada(); // version nueva, recien tomada
  expect((await pendiente()).body.motivo).toBe('estabilizando');
  avanzar(100);
};

describe('GET /cambios/pendiente (solo base de datos)', () => {
  test('sin versiones: sin_datos, y jamas lee la planilla', async () => {
    const res = await pendiente();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hay: false, motivo: 'sin_datos' });
    expect(leerPestanaOor).not.toHaveBeenCalled();
  });

  test('primera vez: no hay pop-up y deja la base; luego sin_cambios', async () => {
    await registrarDePasada();
    expect((await pendiente()).body).toEqual({ hay: false, motivo: 'primera_vez' });
    expect(mem.estado.revisiones).toEqual([expect.objectContaining({ automatica: true, desde_snapshot_id: null })]);
    expect((await pendiente()).body).toEqual({ hay: false, motivo: 'sin_cambios' });
    expect(leerPestanaOor).not.toHaveBeenCalled();
  });

  test('atraso cruzado con la BO: contrato completo', async () => {
    await conAtrasoEstable();
    const res = await pendiente();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hay: true,
      desde: { id: 1, tomado_en: '2026-05-01T10:00:00.000Z' },
      hasta: { id: 2, tomado_en: '2026-05-01T10:06:40.000Z' },
      resumen: { cambios: 1, atraso: 1, bos: 1, bosConFacturacionAfectada: 1 },
      sinBo: [],
      avisos: []
    });
    expect(res.body.grupos[0]).toMatchObject({
      bo: 'BO-100',
      cliente: 'SICE',
      proyecto: 'Metro',
      poAxis: '575740',
      poCliente: 'OC-77',
      compartida: false,
      ultimoDespacho: { antes: '2026-01-15', ahora: '2026-06-10' },
      eta: { antes: '2026-01-30', ahora: '2026-06-25' },
      mes: { antes: '2026-01', ahora: '2026-06' },
      dias: 146,
      facturacion: { mes: '2026-02', semana: 2, afectada: true }
    });
    expect(res.body.grupos[0].lineas[0]).toMatchObject({
      tipo: 'atraso',
      dias: 146,
      linea: { po: '575740', despacho: '2026-06-10', eta: '2026-06-25' },
      antes: { despacho: '2026-01-15' }
    });
    expect(leerPestanaOor).not.toHaveBeenCalled();
  });

  test('estabilizando: devuelve cuanto falta y despues de 90 s anuncia', async () => {
    await registrarDePasada();
    await pendiente();
    avanzar(400);
    planilla = hoja('10-6-2026');
    await registrarDePasada();
    avanzar(30);
    expect((await pendiente()).body).toEqual({ hay: false, motivo: 'estabilizando', revisar_en_seg: 60 });
    avanzar(60);
    expect((await pendiente()).body.hay).toBe(true);
  });

  test('un error del repositorio responde 500 generico', async () => {
    jest.spyOn(mem.repo, 'ultimoSnapshot').mockRejectedValue(new Error('boom'));
    const res = await pendiente();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error del servidor' });
  });
});

describe('POST /actualizar', () => {
  test('primera vez: lee la planilla, guarda la base y no hay pop-up (con la cantidad de lineas)', async () => {
    const res = await actualizar();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hay: false, motivo: 'primera_vez', lineas: 1 });
    expect(leerPestanaOor).toHaveBeenCalledTimes(1);
    expect(mem.estado.snapshots).toHaveLength(1);
  });

  test('sin cambios: misma planilla', async () => {
    await actualizar();
    avanzar(10);
    const res = await actualizar();
    expect(res.body).toEqual({ hay: false, motivo: 'sin_cambios', lineas: 1 });
    expect(mem.estado.snapshots).toHaveLength(1);
  });

  test('cambio detectado al apretar, SIN esperar los 90 s, con el contrato de pendiente', async () => {
    await actualizar();
    avanzar(5);
    planilla = hoja('10-6-2026');
    const res = await actualizar(); // la version se tomo hace 0 s
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hay: true,
      lineas: 1,
      desde: { id: 1 },
      hasta: { id: 2 },
      resumen: { cambios: 1, atraso: 1, bosConFacturacionAfectada: 1 },
    });
    expect(res.body.grupos[0]).toMatchObject({ bo: 'BO-100', dias: 146, mes: { antes: '2026-01', ahora: '2026-06' } });
    expect(res.body.sinBo).toEqual([]);
    expect(res.body.avisos).toEqual([]);
    // GET en cambio sigue esperando la estabilidad cuando la version es reciente.
    expect((await pendiente()).body).toMatchObject({ hay: false, motivo: 'estabilizando' });
  });

  test('pestana vacia o sin Order No: 200 sin_datos con los avisos, y no toca lo guardado', async () => {
    await actualizar();
    planilla = [];
    let res = await actualizar();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hay: false, motivo: 'sin_datos', lineas: 0, avisos: [] });
    planilla = [['Otra', 'Cosa'], [1, 2]];
    res = await actualizar();
    expect(res.body).toMatchObject({ hay: false, motivo: 'sin_datos', lineas: 0 });
    expect(res.body.avisos[0]).toMatch(/Order No/);
    expect(mem.estado.snapshots).toHaveLength(1);
  });

  test('planilla sin configurar (sin lector o con el codigo de la app): 400', async () => {
    leerPestanaOor.mockRejectedValue(Object.assign(new Error('x'), { code: 'PLANILLA_NO_CONFIGURADA' }));
    let res = await actualizar();
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'La planilla maestra no está configurada' });

    const sola = express();
    sola.use('/api/oor', crearRutasOor({ pool: mem.pool, repo: mem.repo, ahora: () => reloj, log }));
    res = await request(sola).post('/api/oor/actualizar');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'La planilla maestra no está configurada' });
  });

  test('Google falla: 502 con mensaje y queda en el log; lo guardado no cambia', async () => {
    await actualizar();
    leerPestanaOor.mockRejectedValue(new Error('Google caido'));
    const res = await actualizar();
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'No se pudo leer la pestaña OOR de la planilla' });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'oor_actualizar_planilla_fallo' }), expect.any(String));
    expect(mem.estado.snapshots).toHaveLength(1);
  });

  test('sin throttle: cada pulsacion lee la planilla', async () => {
    await actualizar();
    await actualizar();
    await actualizar();
    expect(leerPestanaOor).toHaveBeenCalledTimes(3);
  });
});

describe('POST /visto', () => {
  test('marca visto, devuelve revision_id y ya no hay pendiente', async () => {
    await conAtrasoEstable();
    const p = await pendiente();
    const res = await visto({ hasta_id: p.body.hasta.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, revision_id: 2 });
    expect(mem.estado.revisiones[1]).toMatchObject({ usuario_id: 1, automatica: false, desde_snapshot_id: 1, hasta_snapshot_id: 2 });
    expect((await pendiente()).body).toEqual({ hay: false, motivo: 'sin_cambios' });
  });

  test('es idempotente', async () => {
    await conAtrasoEstable();
    const a = await visto({ hasta_id: 2 });
    const b = await visto({ hasta_id: '2' });
    expect(b.body).toEqual(a.body);
    expect(mem.estado.revisiones).toHaveLength(2);
  });

  test('400: cuerpo invalido, version inexistente o anterior a la base', async () => {
    await conAtrasoEstable();
    for (const cuerpo of [{}, { hasta_id: 'x' }, { hasta_id: 0 }, { hasta_id: -3 }, { hasta_id: 1.5 }, { hasta_id: null }]) {
      const res = await visto(cuerpo);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/^Datos invalidos: hasta_id/);
    }
    const inexistente = await visto({ hasta_id: 99 });
    expect(inexistente.status).toBe(400);
    expect(inexistente.body.error).toMatch(/no existe/);
    await visto({ hasta_id: 2 });
    const anterior = await visto({ hasta_id: 1 });
    expect(anterior.status).toBe(400);
    expect(anterior.body.error).toMatch(/anterior/);
  });
});

describe('historial y detalle', () => {
  test('historial: items de la mas reciente a la mas antigua; detalle recalcula', async () => {
    await conAtrasoEstable();
    await visto({ hasta_id: 2 });
    avanzar(400);
    planilla = hoja('10-7-2026');
    await registrarDePasada();
    avanzar(100);
    await visto({ hasta_id: 3 });

    const h = await request(app).get('/api/oor/cambios/historial');
    expect(h.status).toBe(200);
    expect(h.body.items.map((i) => i.id)).toEqual([3, 2]);
    expect(h.body.items[1]).toMatchObject({
      desde: { id: 1, tomado_en: '2026-05-01T10:00:00.000Z' },
      hasta: { id: 2 },
      resumen: { cambios: 1, atraso: 1 }
    });
    expect((await request(app).get('/api/oor/cambios/historial?limite=1')).body.items).toHaveLength(1);
    expect((await request(app).get('/api/oor/cambios/historial?limite=0')).status).toBe(400);

    const d = await request(app).get('/api/oor/cambios/revisiones/2');
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ hay: true, desde: { id: 1 }, hasta: { id: 2 }, resumen: { atraso: 1 } });
    expect(d.body.visto_en).toEqual(expect.any(String));
    expect(d.body.grupos[0]).toMatchObject({ bo: 'BO-100', dias: 146 });
  });

  test('detalle: 404 si no existe, 400 si el id no es valido', async () => {
    const no = await request(app).get('/api/oor/cambios/revisiones/55');
    expect(no.status).toBe(404);
    expect(no.body.error).toMatch(/no encontrada/i);
    expect((await request(app).get('/api/oor/cambios/revisiones/abc')).status).toBe(400);
  });
});
