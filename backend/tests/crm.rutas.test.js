/**
 * Rutas del CRM (/api/crm) con el repositorio en memoria: validacion, codigos de
 * respuesta, reglas de etapa, fusion y embudo. La autenticacion se prueba aparte
 * (crm.permisos.test.js) contra la app real.
 */
const express = require('express');
const request = require('supertest');
const { crearCrmMemoria } = require('./helpers/crmMemoria');
const { crearRutasCrm } = require('../src/crm/rutas');

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

let mem;
let app;
beforeEach(() => {
  mem = crearCrmMemoria();
  app = express();
  app.use(express.json());
  app.use('/api/crm', crearRutasCrm({ pool: mem.pool, repo: mem.repo, log }));
});

const post = (url, body) => request(app).post(`/api/crm${url}`).send(body);
const patch = (url, body) => request(app).patch(`/api/crm${url}`).send(body);
const get = (url) => request(app).get(`/api/crm${url}`);

const crearEmpresa = async (nombre, extra = {}) => (await post('/empresas', { nombre, ...extra })).body;

describe('empresas', () => {
  test('POST crea (201) y normaliza; 409 con empresa_id si el nombre normalizado ya existe', async () => {
    const res = await post('/empresas', { nombre: '  SONDA   S.A. ', rut: '', sitio: 'https://sonda.cl' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 1, nombre: 'SONDA S.A.', nombre_normalizado: 'sonda', rut: null, sitio: 'https://sonda.cl', archivada: false });

    const dup = await post('/empresas', { nombre: 'Sonda SA' });
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: 'Ya existe una empresa con ese nombre', empresa_id: 1 });
  });

  test('POST valida la entrada (400 con { error })', async () => {
    for (const body of [{}, { nombre: '' }, { nombre: '   ' }, { nombre: 123 }, { nombre: 'x'.repeat(500) }, { nombre: '...' }]) {
      const res = await post('/empresas', body);
      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
    }
  });

  test('GET lista con busqueda, paginacion y archivadas', async () => {
    const a = await crearEmpresa('Sonda S.A.');
    await crearEmpresa('Globex');
    const c = await crearEmpresa('Ingeniería Ltda.');
    await post('/contactos', { empresa_id: a.id, nombre: 'Ana', email: 'ana@sonda.cl' });
    await patch(`/empresas/${c.id}`, { archivada: true });

    const todas = await get('/empresas');
    expect(todas.status).toBe(200);
    expect(todas.body.total).toBe(2);
    expect(todas.body.items[0]).toEqual(expect.objectContaining({
      id: expect.any(Number), nombre: expect.any(String), rut: null, contactos: expect.any(Number),
      oportunidades_abiertas: 0, monto_abierto: 0, ultima_cotizacion_en: null
    }));
    expect((await get('/empresas?archivadas=1')).body.total).toBe(3);
    expect((await get('/empresas?q=ana@sonda')).body.items.map((e) => e.id)).toEqual([a.id]);
    expect((await get('/empresas?q=ingenieria&archivadas=1')).body.items.map((e) => e.id)).toEqual([c.id]); // sin tilde
    const pagina = await get('/empresas?limite=1&offset=1');
    expect(pagina.body).toMatchObject({ total: 2 });
    expect(pagina.body.items).toHaveLength(1);
    expect((await get('/empresas?limite=0')).status).toBe(400);
    expect((await get('/empresas?limite=999')).status).toBe(400);
    expect((await get('/empresas?offset=-1')).status).toBe(400);
  });

  test('GET /:id: detalle con contactos, oportunidades, cotizaciones y resumen; 404 y 400', async () => {
    const empresa = await crearEmpresa('Sonda');
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Sonda', total: 1000 });
    await mem.repo.vincularCotizacion(null, cot.id, { empresa_id: empresa.id, contacto_id: null, oportunidad_id: null });
    const ganada = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'G', monto_manual: 700 })).body;
    await patch(`/oportunidades/${ganada.id}`, { etapa: 'ganada' });
    const perdida = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'P' })).body;
    await patch(`/oportunidades/${perdida.id}`, { etapa: 'perdida', motivo_perdida: 'Precio' });

    const res = await get(`/empresas/${empresa.id}`);
    expect(res.status).toBe(200);
    // + archivadas: conteos de lo archivado, que no sale en la ficha.
    expect(Object.keys(res.body).sort()).toEqual(['archivadas', 'contactos', 'cotizaciones', 'empresa', 'oportunidades', 'resumen']);
    expect(res.body.archivadas).toEqual({ oportunidades: 0, cotizaciones: 0 });
    expect(res.body.cotizaciones[0]).toEqual({
      id: cot.id, numero: cot.numero, total: 1000, estado: 'revision', created_at: expect.any(String), contacto_id: null, oportunidad_id: null
    });
    expect(res.body.resumen).toEqual({ cotizaciones: 1, monto_cotizado: 1000, ganadas: 1, perdidas: 1, monto_ganado: 700, tasa_cierre: 0.5 });

    expect((await get('/empresas/999')).status).toBe(404);
    expect((await get('/empresas/abc')).status).toBe(400);
  });

  test('PATCH: edita, 409 si el nuevo nombre choca con otra, y el nombre viejo queda como alias', async () => {
    const sonda = await crearEmpresa('Sonda');
    await crearEmpresa('Globex');
    const choque = await patch(`/empresas/${sonda.id}`, { nombre: 'GLOBEX S.A.' });
    expect(choque.status).toBe(409);
    expect(choque.body.empresa_id).toBe(2);

    const ok = await patch(`/empresas/${sonda.id}`, { nombre: 'Sonda Chile', notas: 'Cliente grande', rut: null });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ nombre: 'Sonda Chile', nombre_normalizado: 'sonda chile', notas: 'Cliente grande' });
    expect(mem.estado.alias).toEqual({ sonda: sonda.id });
    // Crear "Sonda" de nuevo choca con el alias.
    expect((await post('/empresas', { nombre: 'SONDA' })).body).toMatchObject({ empresa_id: sonda.id });

    expect((await patch('/empresas/77', { notas: 'x' })).status).toBe(404);
    expect((await patch(`/empresas/${sonda.id}`, { archivada: 'si' })).status).toBe(400);
  });

  test('GET /duplicados agrupa nombres parecidos con la cantidad de cotizaciones', async () => {
    const a = await crearEmpresa('Sonda S.A.');
    const b = await crearEmpresa('Sonda Chile');
    await crearEmpresa('Globex');
    const cot = mem.agregarCotizacion({ cliente_empresa: 'x' });
    await mem.repo.vincularCotizacion(null, cot.id, { empresa_id: b.id, contacto_id: null, oportunidad_id: null });

    const res = await get('/empresas/duplicados');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      grupos: [{
        empresas: [{ id: a.id, nombre: 'Sonda S.A.', cotizaciones: 0 }, { id: b.id, nombre: 'Sonda Chile', cotizaciones: 1 }],
        motivo: 'Un nombre contiene al otro'
      }]
    });
  });
});

describe('fusion de empresas', () => {
  test('mueve contactos, oportunidades y cotizaciones; funde contactos con el mismo email; borra el origen', async () => {
    const destino = await crearEmpresa('Sonda S.A.');
    const origen = await crearEmpresa('Sonda Chile', { rut: '76.000.000-1' });
    const anaD = (await post('/contactos', { empresa_id: destino.id, nombre: 'Ana', email: 'ana@sonda.cl' })).body;
    const anaO = (await post('/contactos', { empresa_id: origen.id, nombre: 'Ana S.', email: 'ANA@sonda.cl', telefono: '22', cargo: 'Jefa' })).body;
    await post('/contactos', { empresa_id: origen.id, nombre: 'Pedro' });
    const op = (await post('/oportunidades', { empresa_id: origen.id, titulo: 'X', contacto_id: anaO.id })).body;
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Sonda Chile' });
    await mem.repo.vincularCotizacion(null, cot.id, { empresa_id: origen.id, contacto_id: anaO.id, oportunidad_id: op.id });

    const res = await post(`/empresas/${destino.id}/fusionar`, { origen_id: origen.id });

    expect(res.status).toBe(200);
    expect(res.body.movidos).toEqual({ contactos: 2, oportunidades: 1, cotizaciones: 1 });
    expect(res.body.empresa).toMatchObject({ id: destino.id, rut: '76.000.000-1' }); // completa lo que faltaba
    expect(mem.estado.empresas.map((e) => e.id)).toEqual([destino.id]);
    expect(mem.estado.contactos.map((c) => [c.nombre, c.empresa_id])).toEqual([['Ana', destino.id], ['Pedro', destino.id]]);
    expect(mem.estado.contactos[0]).toMatchObject({ telefono: '22', cargo: 'Jefa' });
    expect(mem.estado.oportunidades[0]).toMatchObject({ empresa_id: destino.id, contacto_id: anaD.id });
    expect(mem.estado.cotizaciones[0]).toMatchObject({ empresa_id: destino.id, contacto_id: anaD.id });
    expect(mem.estado.alias).toEqual({ 'sonda chile': destino.id });
  });

  test('400 consigo misma, 404 si falta alguna, y si algo falla no queda a medias', async () => {
    const a = await crearEmpresa('Alfa');
    const b = await crearEmpresa('Beta');
    await post('/contactos', { empresa_id: b.id, nombre: 'Pedro' });
    expect((await post(`/empresas/${a.id}/fusionar`, { origen_id: a.id })).status).toBe(400);
    expect((await post(`/empresas/${a.id}/fusionar`, {})).status).toBe(400);
    expect((await post(`/empresas/${a.id}/fusionar`, { origen_id: 99 })).status).toBe(404);
    expect((await post(`/empresas/99/fusionar`, { origen_id: a.id })).status).toBe(404);

    mem.fallarEn('moverCotizaciones');
    const res = await post(`/empresas/${a.id}/fusionar`, { origen_id: b.id });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error del servidor' });
    expect(mem.estado.empresas).toHaveLength(2);
    expect(mem.estado.contactos[0].empresa_id).toBe(b.id); // ROLLBACK de la transaccion
  });
});

describe('contactos', () => {
  test('POST 201, email en minusculas; 409 si el email ya existe en la empresa; 404 sin empresa', async () => {
    const empresa = await crearEmpresa('Sonda');
    const otra = await crearEmpresa('Globex');
    const res = await post('/contactos', { empresa_id: empresa.id, nombre: 'Ana', email: 'Ana@Sonda.cl', cargo: 'TI' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ empresa_id: empresa.id, nombre: 'Ana', email: 'ana@sonda.cl', cargo: 'TI', archivado: false });

    const dup = await post('/contactos', { empresa_id: empresa.id, nombre: 'Otra', email: 'ANA@sonda.cl' });
    expect(dup.status).toBe(409);
    expect(dup.body.contacto_id).toBe(res.body.id);
    expect((await post('/contactos', { empresa_id: otra.id, nombre: 'Ana', email: 'ana@sonda.cl' })).status).toBe(201); // otra empresa
    expect((await post('/contactos', { empresa_id: 99, nombre: 'X' })).status).toBe(404);
    expect((await post('/contactos', { empresa_id: empresa.id, nombre: 'X', email: 'no-es-email' })).status).toBe(400);
    expect((await post('/contactos', { empresa_id: empresa.id })).status).toBe(400);
  });

  test('PATCH edita, archiva, borra el email con null; 409 por email repetido; 404', async () => {
    const empresa = await crearEmpresa('Sonda');
    const ana = (await post('/contactos', { empresa_id: empresa.id, nombre: 'Ana', email: 'ana@sonda.cl' })).body;
    const pedro = (await post('/contactos', { empresa_id: empresa.id, nombre: 'Pedro' })).body;
    expect((await patch(`/contactos/${pedro.id}`, { email: 'ANA@SONDA.CL' })).status).toBe(409);
    const ok = await patch(`/contactos/${pedro.id}`, { telefono: '+56 2', archivado: true, email: 'pedro@sonda.cl' });
    expect(ok.body).toMatchObject({ telefono: '+56 2', archivado: true, email: 'pedro@sonda.cl' });
    expect((await patch(`/contactos/${ana.id}`, { email: null })).body.email).toBeNull();
    expect((await patch(`/contactos/${ana.id}`, { nombre: '' })).status).toBe(400);
    expect((await patch('/contactos/999', { nombre: 'X' })).status).toBe(404);
  });
});

describe('oportunidades', () => {
  const RESUMEN = [
    'id', 'titulo', 'etapa', 'empresa_id', 'empresa_nombre', 'contacto_id', 'contacto_nombre', 'marca', 'es_proyecto', 'monto',
    'fecha_cierre_estimada', 'motivo_perdida', 'cotizaciones', 'dias_en_etapa', 'created_at', 'updated_at',
    // Para que el tablero enlace a la cotizacion vigente mas reciente.
    'cotizacion_id', 'cotizacion_numero', 'archivada_en'
  ];

  test('POST 201 devuelve OportunidadResumen; valida empresa, contacto, etapa, marca, monto y fecha', async () => {
    const empresa = await crearEmpresa('Sonda');
    const otra = await crearEmpresa('Globex');
    const ana = (await post('/contactos', { empresa_id: empresa.id, nombre: 'Ana' })).body;
    const ajeno = (await post('/contactos', { empresa_id: otra.id, nombre: 'Eva' })).body;

    const res = await post('/oportunidades', {
      empresa_id: empresa.id, titulo: 'Proyecto CCTV', contacto_id: ana.id, marca: 'AXIS', es_proyecto: true,
      monto_manual: '1500.5', fecha_cierre_estimada: '2026-12-31'
    });
    expect(res.status).toBe(201);
    for (const campo of RESUMEN) expect(res.body).toHaveProperty(campo);
    expect(res.body).toMatchObject({
      etapa: 'nueva', empresa_nombre: 'Sonda', contacto_nombre: 'Ana', marca: 'AXIS', es_proyecto: true, monto: 1500.5,
      fecha_cierre_estimada: '2026-12-31', cotizaciones: 0, dias_en_etapa: 0
    });

    expect((await post('/oportunidades', { empresa_id: 99, titulo: 'X' })).status).toBe(404);
    expect((await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X', contacto_id: ajeno.id })).status).toBe(400);
    expect((await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X', etapa: 'cerrada' })).status).toBe(400);
    expect((await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X', marca: 'HIKVISION' })).status).toBe(400);
    expect((await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X', monto_manual: -1 })).status).toBe(400);
    expect((await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X', fecha_cierre_estimada: '2026-02-31' })).status).toBe(400);
    expect((await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X', etapa: 'perdida' })).status).toBe(400);
    expect((await post('/oportunidades', { empresa_id: empresa.id })).status).toBe(400);
  });

  test('PATCH aplica las reglas de etapa: perdida exige motivo, cerrada_en y etapa_desde', async () => {
    const empresa = await crearEmpresa('Sonda');
    const op = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X' })).body;
    mem.estado.oportunidades[0].etapa_desde = new Date(Date.now() - 5 * 86400000);
    expect((await patch(`/oportunidades/${op.id}`, { titulo: 'Y' })).body.dias_en_etapa).toBe(5);

    const sinMotivo = await patch(`/oportunidades/${op.id}`, { etapa: 'perdida' });
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.error).toMatch(/motivo_perdida/);
    expect(mem.estado.oportunidades[0].etapa).toBe('nueva');

    const perdida = await patch(`/oportunidades/${op.id}`, { etapa: 'perdida', motivo_perdida: 'Precio' });
    expect(perdida.status).toBe(200);
    expect(perdida.body).toMatchObject({ etapa: 'perdida', motivo_perdida: 'Precio', dias_en_etapa: 0 });
    expect(mem.estado.oportunidades[0].cerrada_en).toBeInstanceOf(Date);

    const reabierta = await patch(`/oportunidades/${op.id}`, { etapa: 'negociacion' });
    expect(reabierta.body).toMatchObject({ etapa: 'negociacion', motivo_perdida: null });
    expect(mem.estado.oportunidades[0].cerrada_en).toBeNull();

    expect((await patch('/oportunidades/999', { titulo: 'Z' })).status).toBe(404);
    expect((await patch(`/oportunidades/${op.id}`, { titulo: '' })).status).toBe(400);
  });

  test('POST /:id/cotizaciones vincula, fija la empresa, avanza "nueva" y el monto sale de la cotizacion', async () => {
    const empresa = await crearEmpresa('Sonda');
    const op = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X' })).body;
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Otra', total: 321.456 });

    const res = await post(`/oportunidades/${op.id}/cotizaciones`, { cotizacion_id: cot.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ etapa: 'cotizada', cotizaciones: 1, monto: 321.46, cotizacion_id: cot.id, cotizacion_numero: cot.numero });
    // La cotizacion vinculada toma el estado derivado de la etapa.
    expect(mem.estado.cotizaciones[0]).toMatchObject({ empresa_id: empresa.id, oportunidad_id: op.id, estado: 'enviada' });

    expect((await post(`/oportunidades/${op.id}/cotizaciones`, { cotizacion_id: 999 })).status).toBe(404);
    expect((await post('/oportunidades/999/cotizaciones', { cotizacion_id: cot.id })).status).toBe(404);
    expect((await post(`/oportunidades/${op.id}/cotizaciones`, { cotizacion_id: 'x' })).status).toBe(400);
  });

  test('GET filtra por etapa, empresa, texto y abiertas', async () => {
    const sonda = await crearEmpresa('Sonda');
    const globex = await crearEmpresa('Globex');
    const a = (await post('/oportunidades', { empresa_id: sonda.id, titulo: 'CCTV bodega' })).body;
    const b = (await post('/oportunidades', { empresa_id: sonda.id, titulo: 'NAS', etapa: 'ganada' })).body;
    const c = (await post('/oportunidades', { empresa_id: globex.id, titulo: 'Camaras' })).body;
    const ids = async (qs) => (await get(`/oportunidades${qs}`)).body.items.map((o) => o.id).sort();

    expect(await ids('')).toEqual([a.id, b.id, c.id].sort());
    expect(await ids('?abiertas=1')).toEqual([a.id, c.id].sort());
    expect(await ids('?etapa=ganada')).toEqual([b.id]);
    expect(await ids(`?empresa_id=${sonda.id}&abiertas=1`)).toEqual([a.id]);
    expect(await ids('?q=globex')).toEqual([c.id]);
    expect(await ids('?etapa=&q=')).toEqual([a.id, b.id, c.id].sort());
    expect((await get('/oportunidades?etapa=otra')).status).toBe(400);
    expect((await get('/oportunidades?empresa_id=abc')).status).toBe(400);
  });
});

describe('embudo', () => {
  test('sin datos: las 5 etapas presentes y en orden', async () => {
    const res = await get('/embudo');
    expect(res.status).toBe(200);
    expect(res.body.etapas).toEqual(['nueva', 'cotizada', 'negociacion', 'ganada', 'perdida'].map((etapa) => ({ etapa, cantidad: 0, monto: 0 })));
    expect(res.body).toMatchObject({ abiertas: { cantidad: 0, monto: 0 }, ganadas_mes: { cantidad: 0, monto: 0 }, perdidas_mes: { cantidad: 0, monto: 0 } });
  });

  test('cuenta por etapa, abiertas y cerradas del mes', async () => {
    const empresa = await crearEmpresa('Sonda');
    await post('/oportunidades', { empresa_id: empresa.id, titulo: 'A', monto_manual: 100 });
    await post('/oportunidades', { empresa_id: empresa.id, titulo: 'B', etapa: 'negociacion', monto_manual: 50 });
    const g = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'C', monto_manual: 200 })).body;
    await patch(`/oportunidades/${g.id}`, { etapa: 'ganada' });

    const res = await get('/embudo');
    expect(res.body.etapas.map((e) => [e.etapa, e.cantidad, e.monto])).toEqual([
      ['nueva', 1, 100], ['cotizada', 0, 0], ['negociacion', 1, 50], ['ganada', 1, 200], ['perdida', 0, 0]
    ]);
    expect(res.body.abiertas).toEqual({ cantidad: 2, monto: 150 });
    expect(res.body.ganadas_mes).toEqual({ cantidad: 1, monto: 200 });
  });

  test('un error inesperado da 500 generico y se registra', async () => {
    mem.fallarEn('totalesEmbudo');
    const res = await get('/embudo');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error del servidor' });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'crm_error' }), expect.any(String));
  });
});

describe('etapa -> estado de las cotizaciones', () => {
  test('PATCH /oportunidades/:id con etapa deriva el estado de todas sus cotizaciones (en la misma transaccion)', async () => {
    const empresa = await crearEmpresa('Sonda');
    const op = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X' })).body;
    const a = mem.agregarCotizacion({ cliente_empresa: 'Sonda' });
    const b = mem.agregarCotizacion({ cliente_empresa: 'Sonda' });
    await post(`/oportunidades/${op.id}/cotizaciones`, { cotizacion_id: a.id });
    await post(`/oportunidades/${op.id}/cotizaciones`, { cotizacion_id: b.id });

    const estados = () => mem.estado.cotizaciones.map((c) => c.estado);
    expect(estados()).toEqual(['enviada', 'enviada']);
    await patch(`/oportunidades/${op.id}`, { etapa: 'ganada' });
    expect(estados()).toEqual(['aprobada', 'aprobada']);
    await patch(`/oportunidades/${op.id}`, { etapa: 'perdida', motivo_perdida: 'Precio' });
    expect(estados()).toEqual(['rechazada', 'rechazada']);
    await patch(`/oportunidades/${op.id}`, { etapa: 'nueva' });
    expect(estados()).toEqual(['revision', 'revision']);
    await patch(`/oportunidades/${op.id}`, { etapa: 'negociacion' });
    expect(estados()).toEqual(['enviada', 'enviada']);
  });

  test('sin cambio de etapa no se deriva nada; si derivar falla, el PATCH no queda a medias', async () => {
    const empresa = await crearEmpresa('Sonda');
    const op = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'X' })).body;
    mem.llamadas.length = 0;
    await patch(`/oportunidades/${op.id}`, { titulo: 'Y' });
    expect(mem.llamadas).not.toContain('derivarEstadoCotizaciones');

    mem.fallarEn('derivarEstadoCotizaciones');
    const res = await patch(`/oportunidades/${op.id}`, { etapa: 'ganada' });
    expect(res.status).toBe(500);
    expect(mem.estado.oportunidades[0].etapa).toBe('nueva'); // ROLLBACK
  });
});

describe('archivadas', () => {
  const preparar = async () => {
    const empresa = await crearEmpresa('Sonda');
    const viva = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'Viva', monto_manual: 100 })).body;
    const archivada = (await post('/oportunidades', { empresa_id: empresa.id, titulo: 'Archivada', monto_manual: 900 })).body;
    const cotViva = mem.agregarCotizacion({ cliente_empresa: 'Sonda', total: 100 });
    const cotArch = mem.agregarCotizacion({ cliente_empresa: 'Sonda', total: 900 });
    await post(`/oportunidades/${viva.id}/cotizaciones`, { cotizacion_id: cotViva.id });
    await post(`/oportunidades/${archivada.id}/cotizaciones`, { cotizacion_id: cotArch.id });
    await mem.repo.archivarCotizaciones(null, { ids: [cotArch.id] });
    return { empresa, viva, archivada, cotViva, cotArch };
  };

  test('archivar por ids archiva la oportunidad que se queda sin cotizaciones vigentes', async () => {
    const { archivada, cotArch } = await preparar();
    expect(mem.estado.cotizaciones.find((c) => c.id === cotArch.id).archivada_en).toBeInstanceOf(Date);
    expect(mem.estado.oportunidades.find((o) => o.id === archivada.id).archivada_en).toBeInstanceOf(Date);
  });

  test('no salen en GET /oportunidades, el embudo ni los agregados de empresas', async () => {
    const { viva } = await preparar();
    expect((await get('/oportunidades')).body.items.map((o) => o.id)).toEqual([viva.id]);
    const embudo = (await get('/embudo')).body;
    expect(embudo.abiertas).toEqual({ cantidad: 1, monto: 100 });
    const [empresa] = (await get('/empresas')).body.items;
    expect(empresa).toMatchObject({ oportunidades_abiertas: 1, monto_abierto: 100 });
  });

  test('la ficha de la empresa las excluye y las cuenta en `archivadas`', async () => {
    const { empresa, viva, cotViva } = await preparar();
    const ficha = (await get(`/empresas/${empresa.id}`)).body;
    expect(ficha.oportunidades.map((o) => o.id)).toEqual([viva.id]);
    expect(ficha.cotizaciones.map((c) => c.id)).toEqual([cotViva.id]);
    expect(ficha.resumen).toMatchObject({ cotizaciones: 1, monto_cotizado: 100 });
    expect(ficha.archivadas).toEqual({ oportunidades: 1, cotizaciones: 1 });
  });

  test('restaurar las devuelve a los listados', async () => {
    const { cotArch, archivada } = await preparar();
    expect(await mem.repo.restaurarCotizaciones(null, { ids: [cotArch.id] })).toEqual({ cotizaciones: 1, oportunidades: 1 });
    expect((await get('/oportunidades')).body.items.map((o) => o.id)).toContain(archivada.id);
  });
});
