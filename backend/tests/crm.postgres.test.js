/**
 * CRM contra un PostgreSQL real: prueba el SQL del modulo (esquema, migracion, enlace,
 * rutas y fusion) de punta a punta. Solo corre si se define CRM_TEST_DATABASE_URL:
 *
 *   CRM_TEST_DATABASE_URL=postgres://postgres@localhost:5432/crm_test npx jest crm.postgres
 *
 * Trabaja en un schema propio (crm_test_<aleatorio>) que crea y borra; no toca public.
 * En CI (sin BD) se salta; la logica se prueba igual en los otros crm.*.test.js.
 */
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const URL_BD = process.env.CRM_TEST_DATABASE_URL;
const describeBD = URL_BD ? describe : describe.skip;

const silencio = { info: () => {}, warn: () => {}, error: () => {} };

describeBD('CRM con PostgreSQL real', () => {
  const { Pool } = require('pg');
  const schema = `crm_test_${crypto.randomBytes(4).toString('hex')}`;
  let pool;
  let app;
  let esquema;
  let enlace;

  const q = async (sql, params) => (await pool.query(sql, params)).rows;

  const insertarCotizacion = async ({ empresa, nombre, email = null, telefono = null, estado = 'revision', total = 100, creada = '2026-03-10 12:00:00', origenes = [] }) => {
    const [cot] = await q(
      `INSERT INTO cotizaciones (cliente_nombre, cliente_empresa, cliente_email, cliente_telefono, total, estado, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [nombre, empresa, email, telefono, total, estado, creada]
    );
    for (const origen of origenes) {
      await q('INSERT INTO cotizacion_items (cotizacion_id, origen) VALUES ($1, $2)', [cot.id, origen]);
    }
    return cot;
  };

  beforeAll(async () => {
    const admin = new Pool({ connectionString: URL_BD });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: URL_BD, options: `-c search_path=${schema}` });
    // Tablas base minimas del cotizador (las columnas que usa el CRM).
    await pool.query(`
      CREATE SEQUENCE cotizacion_numero_seq START 65423;
      CREATE TABLE cotizaciones (
        id SERIAL PRIMARY KEY,
        numero INTEGER DEFAULT nextval('cotizacion_numero_seq'),
        cliente_nombre VARCHAR(100), cliente_empresa VARCHAR(100), cliente_email VARCHAR(100),
        cliente_telefono VARCHAR(50), total DECIMAL(12,2), estado VARCHAR(20) DEFAULT 'revision',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archivada_en TIMESTAMP
      );
      CREATE TABLE cotizacion_items (
        id SERIAL PRIMARY KEY,
        cotizacion_id INTEGER REFERENCES cotizaciones(id) ON DELETE CASCADE,
        origen VARCHAR(20)
      );
    `);
    esquema = require('../src/crm/esquema');
    enlace = require('../src/crm/enlace');
    const { crearRutasCrm } = require('../src/crm/rutas');
    app = express();
    app.use(express.json());
    app.use('/api/crm', crearRutasCrm({ pool, log: silencio }));
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  test('el esquema es idempotente (dos veces sin error)', async () => {
    expect(await esquema.prepararEsquema(pool, { log: silencio })).toBe(true);
    expect(await esquema.prepararEsquema(pool, { log: silencio })).toBe(true);
    const tablas = await q(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'crm_%' ORDER BY 1`,
      [schema]
    );
    expect(tablas.map((t) => t.table_name)).toEqual(['crm_contactos', 'crm_empresas', 'crm_empresas_alias', 'crm_oportunidades']);
  });

  test('migracion inicial: agrupa por nombre normalizado, mapea estados y es idempotente', async () => {
    await insertarCotizacion({ empresa: 'SONDA S.A.', nombre: 'Ana Soto', email: 'Ana@Sonda.cl', estado: 'aprobada', total: 1000, origenes: ['AXIS'] });
    await insertarCotizacion({ empresa: 'Sonda SA', nombre: 'Ana Soto', email: 'ana@sonda.cl', telefono: '+56 9 1111', estado: 'rechazada', total: 500, origenes: ['QNAP'] });
    await insertarCotizacion({ empresa: 'sonda', nombre: 'Pedro', estado: 'enviada', total: 300, origenes: ['AXIS', 'QNAP'] });
    await insertarCotizacion({ empresa: 'N/A', nombre: 'Juan Pérez', estado: 'pendiente', total: 50 });
    await insertarCotizacion({ empresa: '-', nombre: '', estado: 'revision', total: 10 });
    await insertarCotizacion({ empresa: 'Ingeniería Ltda.', nombre: 'N/A', estado: 'revision', total: 20 });
    await insertarCotizacion({ empresa: 'ingenieria', nombre: 'Luis', estado: 'revision', total: 30 });

    const primera = await esquema.migrarCotizaciones(pool, { log: silencio, tamanoLote: 2 });
    expect(primera).toMatchObject({ procesadas: 7, enlazadas: 6, omitidas: 1, errores: 0 });

    const empresas = await q('SELECT nombre, nombre_normalizado FROM crm_empresas ORDER BY id');
    expect(empresas).toEqual([
      { nombre: 'SONDA S.A.', nombre_normalizado: 'sonda' },
      { nombre: 'Juan Pérez', nombre_normalizado: 'juan perez' },
      { nombre: 'Ingeniería Ltda.', nombre_normalizado: 'ingenieria' }
    ]);
    const contactos = await q('SELECT nombre, email, telefono FROM crm_contactos ORDER BY id');
    expect(contactos).toEqual([
      { nombre: 'Ana Soto', email: 'ana@sonda.cl', telefono: '+56 9 1111' },
      { nombre: 'Pedro', email: null, telefono: null },
      { nombre: 'Juan Pérez', email: null, telefono: null },
      { nombre: 'Luis', email: null, telefono: null }
    ]);
    const ops = await q(
      `SELECT o.titulo, o.etapa, o.marca, o.motivo_perdida, o.etapa_desde = c.created_at AS desde_ok,
              o.cerrada_en = c.created_at AS cerrada_ok, o.cerrada_en IS NULL AS abierta
         FROM crm_oportunidades o JOIN cotizaciones c ON c.oportunidad_id = o.id ORDER BY c.id`
    );
    // revision/pendiente => nueva; enviada => cotizada (tabla de equivalencias).
    expect(ops.map((o) => [o.etapa, o.marca, o.motivo_perdida])).toEqual([
      ['ganada', 'AXIS', null],
      ['perdida', 'QNAP', 'Rechazada (migrado)'],
      ['cotizada', 'MIXTA', null],
      ['nueva', null, null],
      ['nueva', null, null],
      ['nueva', null, null]
    ]);
    expect(ops.every((o) => o.desde_ok)).toBe(true);
    expect(ops.slice(0, 2).every((o) => o.cerrada_ok)).toBe(true);
    expect(ops.slice(2).every((o) => o.abierta)).toBe(true);
    expect(ops[0].titulo).toMatch(/^Cotización #\d+$/);

    const segunda = await esquema.migrarCotizaciones(pool, { log: silencio });
    expect(segunda).toMatchObject({ procesadas: 1, enlazadas: 0, omitidas: 1 });
    expect(await q('SELECT COUNT(*)::int AS n FROM crm_oportunidades')).toEqual([{ n: 6 }]);
    expect(await q('SELECT COUNT(*)::int AS n FROM crm_empresas')).toEqual([{ n: 3 }]);
  });

  test('enlace automatico: reutiliza empresa y contacto, respeta oportunidad_id y bloquea el doble enlace', async () => {
    const client = await pool.connect();
    try {
      const nueva = await insertarCotizacion({ empresa: 'Sonda S.A.', nombre: 'ana soto', email: 'ANA@SONDA.CL', total: 777 });
      const v1 = await enlace.enlazarCotizacionNueva(client, { cotizacionId: nueva.id, marca: 'QNAP', log: silencio });
      const [sonda] = await q(`SELECT id FROM crm_empresas WHERE nombre_normalizado = 'sonda'`);
      const [ana] = await q(`SELECT id FROM crm_contactos WHERE email = 'ana@sonda.cl'`);
      expect(v1).toMatchObject({ empresa_id: sonda.id, contacto_id: ana.id, oportunidad_creada: true });
      const [op] = await q('SELECT etapa, marca, titulo FROM crm_oportunidades WHERE id = $1', [v1.oportunidad_id]);
      expect(op).toEqual({ etapa: 'nueva', marca: 'QNAP', titulo: `Cotización #${nueva.numero}` });

      // Segunda vez: ya esta enlazada, no hace nada.
      expect(await enlace.enlazarCotizacionNueva(client, { cotizacionId: nueva.id, log: silencio })).toBeNull();

      const otra = await insertarCotizacion({ empresa: 'Otra Empresa', nombre: 'Ana Soto', total: 10 });
      const v2 = await enlace.enlazarCotizacionNueva(client, { cotizacionId: otra.id, marca: 'AXIS', oportunidadId: String(v1.oportunidad_id), log: silencio });
      expect(v2).toMatchObject({ empresa_id: sonda.id, oportunidad_id: v1.oportunidad_id, oportunidad_creada: false });
      const [op2] = await q('SELECT marca FROM crm_oportunidades WHERE id = $1', [v1.oportunidad_id]);
      expect(op2.marca).toBe('MIXTA');
      expect(await q(`SELECT COUNT(*)::int AS n FROM crm_empresas WHERE nombre_normalizado = 'otra empresa'`)).toEqual([{ n: 0 }]);

      const tercera = await insertarCotizacion({ empresa: 'Otra Empresa', nombre: 'Eva', total: 10 });
      const v3 = await enlace.enlazarCotizacionNueva(client, { cotizacionId: tercera.id, oportunidadId: 999999, log: silencio });
      expect(v3.oportunidad_creada).toBe(true);
      expect(v3.empresa_id).not.toBe(sonda.id);
    } finally {
      client.release();
    }
  });

  test('cambio de etapa desde la cotizacion: cierra, reabre y deriva el estado de todas sus cotizaciones', async () => {
    const cot = await insertarCotizacion({ empresa: 'Estado SpA', nombre: 'X Y', total: 5 });
    const client = await pool.connect();
    const v = await enlace.enlazarCotizacionNueva(client, { cotizacionId: cot.id, log: silencio });
    const otra = await insertarCotizacion({ empresa: 'Estado SpA', nombre: 'X Y', total: 6 });
    await enlace.enlazarCotizacionNueva(client, { cotizacionId: otra.id, oportunidadId: v.oportunidad_id, log: silencio });
    client.release();
    const estados = async () => (await q('SELECT estado FROM cotizaciones WHERE oportunidad_id = $1 ORDER BY id', [v.oportunidad_id])).map((r) => r.estado);
    // Al entrar la segunda a la oportunidad (nueva -> cotizada) ambas quedan 'enviada'.
    expect(await estados()).toEqual(['enviada', 'enviada']);

    const perdida = await enlace.cambiarEtapaDeCotizacion(pool, {
      cotizacionId: cot.id, etapa: 'perdida', estadoHeredado: 'rechazada', motivoPorDefecto: 'Rechazada en el cotizador', log: silencio
    });
    expect(perdida).toMatchObject({ id: cot.id, estado: 'rechazada', etapa: 'perdida', motivo_perdida: 'Rechazada en el cotizador' });
    expect(await estados()).toEqual(['rechazada', 'rechazada']);
    const [op] = await q('SELECT cerrada_en IS NOT NULL AS cerrada FROM crm_oportunidades WHERE id = $1', [v.oportunidad_id]);
    expect(op.cerrada).toBe(true);

    const reabierta = await enlace.cambiarEtapaDeCotizacion(pool, { cotizacionId: otra.id, etapa: 'negociacion', log: silencio });
    expect(reabierta).toMatchObject({ estado: 'enviada', etapa: 'negociacion', motivo_perdida: null });
    expect(await estados()).toEqual(['enviada', 'enviada']);
    const [op2] = await q('SELECT cerrada_en, motivo_perdida FROM crm_oportunidades WHERE id = $1', [v.oportunidad_id]);
    expect(op2).toEqual({ cerrada_en: null, motivo_perdida: null });

    // PATCH del CRM: tambien deriva.
    await request(app).patch(`/api/crm/oportunidades/${v.oportunidad_id}`).send({ etapa: 'ganada' });
    expect(await estados()).toEqual(['aprobada', 'aprobada']);
    await request(app).patch(`/api/crm/oportunidades/${v.oportunidad_id}`).send({ etapa: 'perdida', motivo_perdida: 'Precio' });
    expect(await estados()).toEqual(['rechazada', 'rechazada']);
  });

  test('rutas: empresas, busqueda, detalle, 409 por nombre y alias', async () => {
    const lista = await request(app).get('/api/crm/empresas?q=ana@sonda');
    expect(lista.status).toBe(200);
    expect(lista.body.total).toBe(1);
    expect(lista.body.items[0]).toMatchObject({ nombre: 'SONDA S.A.', contactos: 2 });
    expect(typeof lista.body.items[0].monto_abierto).toBe('number');

    const porTilde = await request(app).get('/api/crm/empresas?q=ingenieria');
    expect(porTilde.body.items.map((e) => e.nombre)).toEqual(['Ingeniería Ltda.']);

    const pct = await request(app).get('/api/crm/empresas?q=%25');
    expect(pct.body.total).toBe(0); // el % del usuario es literal, no comodin

    const dup = await request(app).post('/api/crm/empresas').send({ nombre: 'Sonda Ltda.' });
    expect(dup.status).toBe(409);
    const [sonda] = await q(`SELECT id FROM crm_empresas WHERE nombre_normalizado = 'sonda'`);
    expect(dup.body.empresa_id).toBe(sonda.id);

    const detalle = await request(app).get(`/api/crm/empresas/${sonda.id}`);
    expect(detalle.status).toBe(200);
    expect(detalle.body.resumen).toMatchObject({ ganadas: 1, perdidas: 1, tasa_cierre: 0.5, monto_ganado: 1000 });
    expect(detalle.body.cotizaciones.length).toBe(detalle.body.resumen.cotizaciones);
    expect(detalle.body.oportunidades[0]).toHaveProperty('dias_en_etapa');

    // Renombrar deja el nombre viejo como alias: una cotizacion "Sonda" sigue llegando aca.
    const renombrada = await request(app).patch(`/api/crm/empresas/${sonda.id}`).send({ nombre: 'Sonda Chile', rut: '76.000.000-1' });
    expect(renombrada.status).toBe(200);
    expect(renombrada.body.nombre_normalizado).toBe('sonda chile');
    const cot = await insertarCotizacion({ empresa: 'SONDA', nombre: 'Ana Soto', email: 'ana@sonda.cl' });
    const client = await pool.connect();
    const v = await enlace.enlazarCotizacionNueva(client, { cotizacionId: cot.id, log: silencio });
    client.release();
    expect(v.empresa_id).toBe(sonda.id);
  });

  test('rutas: contactos con email unico por empresa', async () => {
    const [sonda] = await q(`SELECT id FROM crm_empresas WHERE nombre_normalizado = 'sonda chile'`);
    const creado = await request(app).post('/api/crm/contactos').send({ empresa_id: sonda.id, nombre: 'Carla', email: 'Carla@Sonda.cl' });
    expect(creado.status).toBe(201);
    expect(creado.body.email).toBe('carla@sonda.cl');
    const repetido = await request(app).post('/api/crm/contactos').send({ empresa_id: sonda.id, nombre: 'Otra', email: 'CARLA@sonda.cl' });
    expect(repetido.status).toBe(409);
    const editado = await request(app).patch(`/api/crm/contactos/${creado.body.id}`).send({ cargo: 'Gerente', email: 'ana@sonda.cl' });
    expect(editado.status).toBe(409);
    const ok = await request(app).patch(`/api/crm/contactos/${creado.body.id}`).send({ cargo: 'Gerente' });
    expect(ok.body.cargo).toBe('Gerente');
  });

  test('rutas: oportunidades, reglas de etapa, vincular cotizacion y embudo', async () => {
    const [sonda] = await q(`SELECT id FROM crm_empresas WHERE nombre_normalizado = 'sonda chile'`);
    const creada = await request(app).post('/api/crm/oportunidades').send({
      empresa_id: sonda.id, titulo: 'Proyecto CCTV', es_proyecto: true, monto_manual: '1500.5', fecha_cierre_estimada: '2026-12-31'
    });
    expect(creada.status).toBe(201);
    expect(creada.body).toMatchObject({ etapa: 'nueva', monto: 1500.5, fecha_cierre_estimada: '2026-12-31', cotizaciones: 0, dias_en_etapa: 0, empresa_nombre: 'Sonda Chile' });

    const sinMotivo = await request(app).patch(`/api/crm/oportunidades/${creada.body.id}`).send({ etapa: 'perdida' });
    expect(sinMotivo.status).toBe(400);
    const perdida = await request(app).patch(`/api/crm/oportunidades/${creada.body.id}`).send({ etapa: 'perdida', motivo_perdida: 'Precio' });
    expect(perdida.body).toMatchObject({ etapa: 'perdida', motivo_perdida: 'Precio' });
    expect(perdida.body.cerrada_en).toBeTruthy();
    const reabierta = await request(app).patch(`/api/crm/oportunidades/${creada.body.id}`).send({ etapa: 'negociacion' });
    expect(reabierta.body).toMatchObject({ etapa: 'negociacion', motivo_perdida: null, cerrada_en: null });

    const cot = await insertarCotizacion({ empresa: 'Cualquiera', nombre: 'Z', total: 42 });
    const vinc = await request(app).post(`/api/crm/oportunidades/${creada.body.id}/cotizaciones`).send({ cotizacion_id: cot.id });
    expect(vinc.status).toBe(200);
    expect(vinc.body.cotizaciones).toBe(1);
    expect(vinc.body.monto).toBe(1500.5); // monto_manual manda
    const [enlazada] = await q('SELECT empresa_id, oportunidad_id FROM cotizaciones WHERE id = $1', [cot.id]);
    expect(enlazada).toEqual({ empresa_id: sonda.id, oportunidad_id: creada.body.id });
    const sinManual = await request(app).patch(`/api/crm/oportunidades/${creada.body.id}`).send({ monto_manual: null });
    expect(sinManual.body.monto).toBe(42);

    const filtradas = await request(app).get(`/api/crm/oportunidades?abiertas=1&empresa_id=${sonda.id}&q=cctv`);
    expect(filtradas.body.items.map((o) => o.id)).toEqual([creada.body.id]);
    const malas = await request(app).get('/api/crm/oportunidades?etapa=cualquiera');
    expect(malas.status).toBe(400);

    const embudo = await request(app).get('/api/crm/embudo');
    expect(embudo.status).toBe(200);
    expect(embudo.body.etapas.map((e) => e.etapa)).toEqual(['nueva', 'cotizada', 'negociacion', 'ganada', 'perdida']);
    const total = await q('SELECT COUNT(*)::int AS n FROM crm_oportunidades');
    expect(embudo.body.etapas.reduce((s, e) => s + e.cantidad, 0)).toBe(total[0].n);
    expect(embudo.body.perdidas_mes.cantidad).toBeGreaterThanOrEqual(1); // la rechazada hoy en el cotizador
  });

  test('duplicados y fusion: mueve todo, funde contactos por email y deja alias', async () => {
    const a = await request(app).post('/api/crm/empresas').send({ nombre: 'Intersistemas SpA', sitio: 'https://inter.cl' });
    const b = await request(app).post('/api/crm/empresas').send({ nombre: 'Inter Sistemas Ltda' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    await request(app).post('/api/crm/contactos').send({ empresa_id: a.body.id, nombre: 'Rosa', email: 'rosa@inter.cl' });
    const rosaB = await request(app).post('/api/crm/contactos').send({ empresa_id: b.body.id, nombre: 'Rosa M', email: 'ROSA@inter.cl', telefono: '22' });
    await request(app).post('/api/crm/contactos').send({ empresa_id: b.body.id, nombre: 'Tomas' });
    const opB = await request(app).post('/api/crm/oportunidades').send({ empresa_id: b.body.id, titulo: 'X', contacto_id: rosaB.body.id });
    const cot = await insertarCotizacion({ empresa: 'Inter Sistemas', nombre: 'Rosa M', email: 'rosa@inter.cl' });
    const client = await pool.connect();
    await enlace.enlazarCotizacionNueva(client, { cotizacionId: cot.id, log: silencio });
    client.release();

    const dups = await request(app).get('/api/crm/empresas/duplicados');
    const grupo = dups.body.grupos.find((g) => g.empresas.some((e) => e.id === a.body.id));
    expect(grupo.empresas.map((e) => e.id).sort()).toEqual([a.body.id, b.body.id].sort());

    const fus = await request(app).post(`/api/crm/empresas/${a.body.id}/fusionar`).send({ origen_id: b.body.id });
    expect(fus.status).toBe(200);
    // Oportunidades: la creada a mano y la del enlace automatico de la cotizacion.
    expect(fus.body.movidos).toEqual({ contactos: 2, oportunidades: 2, cotizaciones: 1 });
    expect(await q('SELECT id FROM crm_empresas WHERE id = $1', [b.body.id])).toEqual([]);
    const contactos = await q('SELECT nombre, email, telefono FROM crm_contactos WHERE empresa_id = $1 ORDER BY nombre', [a.body.id]);
    expect(contactos).toEqual([
      { nombre: 'Rosa', email: 'rosa@inter.cl', telefono: '22' },
      { nombre: 'Tomas', email: null, telefono: null }
    ]);
    const [op] = await q('SELECT empresa_id, contacto_id FROM crm_oportunidades WHERE id = $1', [opB.body.id]);
    const [rosa] = await q(`SELECT id FROM crm_contactos WHERE email = 'rosa@inter.cl'`);
    expect(op).toEqual({ empresa_id: a.body.id, contacto_id: rosa.id });

    // El nombre de la empresa fusionada lleva a la que quedo.
    const cot2 = await insertarCotizacion({ empresa: 'INTER SISTEMAS', nombre: 'Rosa' });
    const c2 = await pool.connect();
    const v = await enlace.enlazarCotizacionNueva(c2, { cotizacionId: cot2.id, log: silencio });
    c2.release();
    expect(v.empresa_id).toBe(a.body.id);

    expect((await request(app).post(`/api/crm/empresas/${a.body.id}/fusionar`).send({ origen_id: a.body.id })).status).toBe(400);
    expect((await request(app).post(`/api/crm/empresas/${a.body.id}/fusionar`).send({ origen_id: b.body.id })).status).toBe(404);
  });

  test('archivado: previa, por fecha, por ids, exclusiones y restaurar', async () => {
    const repo = require('../src/crm/repositorio');
    const seguimientoCrm = require('../src/seguimiento/crmAdaptador');
    const enlazar = async (cot, oportunidadId) => {
      const c = await pool.connect();
      try {
        return await enlace.enlazarCotizacionNueva(c, { cotizacionId: cot.id, oportunidadId, log: silencio });
      } finally {
        c.release();
      }
    };
    const a = await insertarCotizacion({ empresa: 'Archivo SA', nombre: 'Ana', total: 10, creada: '2025-06-01 10:00:00' });
    const b = await insertarCotizacion({ empresa: 'Archivo SA', nombre: 'Ana', total: 20, creada: '2025-07-01 10:00:00' });
    const c = await insertarCotizacion({ empresa: 'Archivo SA', nombre: 'Ana', total: 30, creada: '2026-03-01 10:00:00' });
    const va = await enlazar(a);
    await enlazar(b, va.oportunidad_id);
    const vc = await enlazar(c);
    const vacia = await repo.insertarOportunidad(pool, { empresa_id: va.empresa_id, titulo: 'Vacia', created_at: '2025-01-01 00:00:00' });
    const ids = async (url) => (await request(app).get(url)).body.items.map((o) => o.id);

    expect(await repo.previaArchivado(pool, { antesDe: '2026-01-01' })).toEqual({ cotizaciones: 2, oportunidades: 2 });
    const porFecha = await repo.conTransaccion(pool, (cl) => repo.archivarCotizaciones(cl, { antesDe: '2026-01-01' }));
    expect(porFecha).toEqual({ cotizaciones: 2, oportunidades: 2 });
    expect(await repo.previaArchivado(pool, { antesDe: '2026-01-01' })).toEqual({ cotizaciones: 0, oportunidades: 0 });

    const visibles = await ids(`/api/crm/oportunidades?empresa_id=${va.empresa_id}`);
    expect(visibles).toEqual([vc.oportunidad_id]);
    const ficha = (await request(app).get(`/api/crm/empresas/${va.empresa_id}`)).body;
    expect(ficha.archivadas).toEqual({ oportunidades: 2, cotizaciones: 2 });
    expect(ficha.cotizaciones.map((x) => x.id)).toEqual([c.id]);
    expect(ficha.resumen).toMatchObject({ cotizaciones: 1, monto_cotizado: 30 });
    const [lista] = (await request(app).get('/api/crm/empresas?q=archivo')).body.items;
    expect(lista).toMatchObject({ oportunidades_abiertas: 1, monto_abierto: 30 });
    const [vigente] = (await request(app).get(`/api/crm/oportunidades?empresa_id=${va.empresa_id}`)).body.items;
    expect(vigente).toMatchObject({ cotizacion_id: c.id, cotizacion_numero: c.numero, archivada_en: null });
    const masGrandes = await seguimientoCrm.abiertasMasGrandes(pool, 100);
    expect(masGrandes.map((o) => o.id)).not.toContain(va.oportunidad_id);
    expect(masGrandes.map((o) => o.id)).not.toContain(vacia.id);

    const totalVivas = await q('SELECT COUNT(*)::int AS n FROM crm_oportunidades WHERE archivada_en IS NULL');
    const embudo = (await request(app).get('/api/crm/embudo')).body;
    expect(embudo.etapas.reduce((s2, e) => s2 + e.cantidad, 0)).toBe(totalVivas[0].n);

    const porIds = await repo.conTransaccion(pool, (cl) => repo.archivarCotizaciones(cl, { ids: [c.id, a.id] }));
    expect(porIds).toEqual({ cotizaciones: 1, oportunidades: 1 }); // a ya estaba archivada
    expect(await ids(`/api/crm/oportunidades?empresa_id=${va.empresa_id}`)).toEqual([]);

    const restaurado = await repo.conTransaccion(pool, (cl) => repo.restaurarCotizaciones(cl, { ids: [a.id] }));
    expect(restaurado).toEqual({ cotizaciones: 1, oportunidades: 1 });
    expect(await ids(`/api/crm/oportunidades?empresa_id=${va.empresa_id}`)).toEqual([va.oportunidad_id]);
    const [opA] = (await request(app).get(`/api/crm/oportunidades?empresa_id=${va.empresa_id}`)).body.items;
    expect(opA.cotizacion_id).toBe(a.id); // b sigue archivada
  });
});
