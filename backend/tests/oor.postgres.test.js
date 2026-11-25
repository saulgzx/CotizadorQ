/**
 * OOR contra un PostgreSQL real: esquema, ciclo completo (registrar -> pendiente -> visto ->
 * historial -> detalle con el JSONB real) y limpieza. Solo corre si se define
 * CRM_TEST_DATABASE_URL (mismo patron que crm.postgres.test.js):
 *
 *   CRM_TEST_DATABASE_URL=postgres://prueba:prueba@localhost:5432/crm_prueba npx jest oor.postgres --runInBand
 *
 * Trabaja en un schema propio (oor_test_<aleatorio>) que crea y borra; no toca public.
 */
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const URL_BD = process.env.CRM_TEST_DATABASE_URL;
const describeBD = URL_BD ? describe : describe.skip;

const silencio = { info: () => {}, warn: () => {}, error: () => {} };

const CABECERA = ['Order Confirmation', 'Del No', 'Order No', 'Line No', 'Customer PO No', 'Created', 'Order Status', 'Status',
  'Sales Part', 'Sales Part Description', 'Sales Qty', 'Planned Ship Date', 'Planned Delivery Date', 'Days changed',
  'Previous Planned Deliver Date', 'Project Description'];
const fila = ({ orden = 9001, linea = 1, po = 575740, cant = 1, despacho, estado = 'Released' }) =>
  ['Confirmed', 1, orden, linea, po, '09-04-2026', estado, estado, '02317-004', 'AXIS Q6225-LE', cant, despacho, '', 0, '', ''];
const hoja = (...filas) => [[...CABECERA], ...filas.map(fila)];

describeBD('OOR con PostgreSQL real', () => {
  const { Pool } = require('pg');
  const schema = `oor_test_${crypto.randomBytes(4).toString('hex')}`;
  let pool;
  let esquema;
  let servicio;
  let app;
  let reloj;
  let planilla;

  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  const t = (seg) => new Date(new Date('2026-05-01T10:00:00Z').getTime() + seg * 1000);
  const registrar = (filas, seg) => servicio.registrarLectura(pool, filas, { ahora: t(seg) });
  const pendiente = (seg) => servicio.pendiente(pool, { ahora: t(seg) });

  beforeAll(async () => {
    const admin = new Pool({ connectionString: URL_BD });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: URL_BD, options: `-c search_path=${schema}` });
    // Tablas base minimas: usuarios (FK de las revisiones) y bo_meta (las columnas que lee el OOR).
    await pool.query(`
      CREATE TABLE usuarios (id SERIAL PRIMARY KEY, usuario VARCHAR(50));
      CREATE TABLE bo_meta (
        bo VARCHAR(100) PRIMARY KEY,
        project_name TEXT, po_axis TEXT, customer_name TEXT, customer_po TEXT,
        estimated_invoice_date DATE, estimated_invoice_month VARCHAR(7), estimated_invoice_week SMALLINT,
        invoiced BOOLEAN DEFAULT false, deleted BOOLEAN DEFAULT false
      );
      INSERT INTO usuarios (usuario) VALUES ('admin');
    `);
    esquema = require('../src/oor/esquema');
    servicio = require('../src/oor/servicio');
    const { crearRutasOor } = require('../src/oor/rutas');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); });
    app.use(
      '/api/oor',
      crearRutasOor({ pool, leerPestanaOor: async () => planilla, ahora: () => reloj, log: silencio })
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  const vaciar = async () => {
    await pool.query('DELETE FROM oor_revisiones');
    await pool.query('DELETE FROM oor_snapshots');
    await pool.query('DELETE FROM bo_meta');
  };

  test('el esquema es idempotente (dos veces sin error) y crea las dos tablas', async () => {
    expect(await esquema.prepararEsquema(pool, { log: silencio })).toBe(true);
    expect(await esquema.prepararEsquema(pool, { log: silencio })).toBe(true);
    const tablas = await q(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'oor_%' ORDER BY 1`,
      [schema]
    );
    expect(tablas.map((x) => x.table_name)).toEqual(['oor_revisiones', 'oor_snapshots']);
    const tipos = await q(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'oor_snapshots'`,
      [schema]
    );
    expect(Object.fromEntries(tipos.map((c) => [c.column_name, c.data_type]))).toMatchObject({ lineas: 'jsonb', avisos: 'jsonb' });
  });

  test('ciclo completo: registrar -> pendiente -> visto -> historial -> detalle', async () => {
    await vaciar();
    await pool.query(
      `INSERT INTO bo_meta (bo, po_axis, customer_name, project_name, customer_po, estimated_invoice_month, estimated_invoice_week)
       VALUES ('BO-100', '575740', 'SICE', 'Metro', 'OC-77', '2026-02', 2),
              ('BO-FECHA', '575741', 'ACME', NULL, NULL, NULL, NULL),
              ('BO-ELIM', '575740', 'X', NULL, NULL, '2026-02', NULL),
              ('BO-FACT', '575740', 'Y', NULL, NULL, '2026-02', NULL),
              ('BO-SINPO', '', 'Z', NULL, NULL, '2026-02', NULL)`
    );
    await pool.query(`UPDATE bo_meta SET estimated_invoice_date = '2026-03-20' WHERE bo = 'BO-FECHA'`);
    await pool.query(`UPDATE bo_meta SET deleted = true WHERE bo = 'BO-ELIM'`);
    await pool.query(`UPDATE bo_meta SET invoiced = true WHERE bo = 'BO-FACT'`);

    const v1 = [[...CABECERA], fila({ despacho: '15-1-2026' }), fila({ linea: 2, po: 575741, despacho: '1-2-2026' })];
    const v2 = [[...CABECERA], fila({ despacho: '10-6-2026' }), fila({ linea: 2, po: 575741, despacho: '1-2-2026' })];

    expect(await registrar([], 0)).toEqual({ motivo: 'sin_datos' });
    expect(await q('SELECT count(*)::int AS n FROM oor_snapshots')).toEqual([{ n: 0 }]);
    expect(await pendiente(0)).toEqual({ hay: false, motivo: 'sin_datos' });

    const s1 = await registrar(v1, 0);
    expect(s1).toMatchObject({ id: expect.any(Number), total: 2, nuevo: true });
    expect((await registrar(v1, 10)).nuevo).toBe(false);
    expect(await pendiente(20)).toEqual({ hay: false, motivo: 'primera_vez' });

    const s2 = await registrar(v2, 600);
    expect(s2.id).toBeGreaterThan(s1.id);
    expect(await pendiente(630)).toMatchObject({ hay: false, motivo: 'estabilizando', revisar_en_seg: 60 });

    const p = await pendiente(700);
    expect(p).toMatchObject({
      hay: true,
      desde: { id: s1.id, tomado_en: t(0).toISOString() },
      hasta: { id: s2.id, tomado_en: t(600).toISOString() },
      resumen: { cambios: 1, atraso: 1, bos: 1, bosAtrasadas: 1, bosConFacturacionAfectada: 1, lineasSinBo: 0 }
    });
    expect(p.grupos.map((g) => g.bo)).toEqual(['BO-100']); // eliminada, facturada y sin PO no cruzan
    expect(p.grupos[0]).toMatchObject({
      cliente: 'SICE',
      mes: { antes: '2026-01', ahora: '2026-06' },
      dias: 146,
      facturacion: { mes: '2026-02', semana: 2, afectada: true }
    });

    // Mes derivado de la fecha estimada cuando estimated_invoice_month esta vacio.
    const repo = require('../src/oor/repositorio');
    const listadas = servicio.prepararBos(await repo.listarBos(pool));
    expect(listadas.map((b) => [b.bo, b.estimated_invoice_month])).toEqual([['BO-100', '2026-02'], ['BO-FECHA', '2026-03']]);

    reloj = t(750);
    const res = await request(app).post('/api/oor/cambios/visto').send({ hasta_id: s2.id });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const otra = await request(app).post('/api/oor/cambios/visto').send({ hasta_id: s2.id });
    expect(otra.body.revision_id).toBe(res.body.revision_id);
    expect((await request(app).post('/api/oor/cambios/visto').send({ hasta_id: s1.id })).status).toBe(400);
    expect((await request(app).post('/api/oor/cambios/visto').send({ hasta_id: 999999 })).status).toBe(400);
    expect(await pendiente(800)).toEqual({ hay: false, motivo: 'sin_cambios' });

    const filas = await q('SELECT * FROM oor_revisiones ORDER BY id');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ automatica: true, desde_snapshot_id: null, hasta_snapshot_id: s1.id });
    expect(filas[1]).toMatchObject({ automatica: false, usuario_id: 1, desde_snapshot_id: s1.id, hasta_snapshot_id: s2.id });
    expect(filas[1].resumen).toMatchObject({ cambios: 1, atraso: 1 });

    const h = await request(app).get('/api/oor/cambios/historial');
    expect(h.body.items).toEqual([
      {
        id: res.body.revision_id,
        visto_en: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        desde: { id: s1.id, tomado_en: t(0).toISOString() },
        hasta: { id: s2.id, tomado_en: t(600).toISOString() },
        resumen: expect.objectContaining({ atraso: 1 })
      }
    ]);

    const d = await request(app).get(`/api/oor/cambios/revisiones/${res.body.revision_id}`);
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ hay: true, desde: { id: s1.id }, hasta: { id: s2.id } });
    expect(d.body.grupos[0].lineas[0]).toMatchObject({
      tipo: 'atraso',
      dias: 146,
      linea: { po: '575740', despacho: '2026-06-10', eta: '2026-06-25' },
      antes: { despacho: '2026-01-15' }
    });
    expect((await request(app).get('/api/oor/cambios/revisiones/999999')).status).toBe(404);
  });

  test('por la ruta: lee la planilla inyectada y la pasa por el servicio', async () => {
    await vaciar();
    reloj = t(0);
    planilla = hoja({ despacho: '15-1-2026' });
    // GET no lee la planilla; POST /actualizar si.
    expect((await request(app).get('/api/oor/cambios/pendiente')).body).toEqual({ hay: false, motivo: 'sin_datos' });
    expect((await request(app).post('/api/oor/actualizar')).body).toEqual({ hay: false, motivo: 'primera_vez', lineas: 1 });
    expect(await q('SELECT total FROM oor_snapshots')).toEqual([{ total: 1 }]);
    planilla = hoja({ despacho: '10-6-2026' });
    const cambio = (await request(app).post('/api/oor/actualizar')).body; // sin esperar los 90 s
    expect(cambio).toMatchObject({ hay: true, lineas: 1, resumen: { cambios: 1, atraso: 1 } });
  });

  test('limpieza: 10 snapshots recientes mas los referenciados; 60 revisiones', async () => {
    await vaciar();
    await registrar(hoja({ despacho: '15-1-2026' }), 0);
    await pendiente(10); // base: revision automatica sobre el snapshot 1
    for (let i = 2; i <= 15; i += 1) await registrar(hoja({ despacho: '15-1-2026', cant: i }), i * 1000);
    const ids = (await q('SELECT id FROM oor_snapshots ORDER BY id')).map((x) => x.id);
    expect(ids).toHaveLength(11);
    expect(ids.slice(1)).toEqual(ids.slice(-10)); // todos menos el primero son los 10 mas recientes

    // Revisiones: se acumulan 70 y la limpieza (al guardar otra version) deja 60.
    for (let i = 16; i <= 85; i += 1) {
      const s = await registrar(hoja({ despacho: '15-1-2026', cant: i }), i * 1000);
      await servicio.marcarVisto(pool, { hastaId: s.id, usuarioId: 1, ahora: t(i * 1000 + 1) });
    }
    await registrar(hoja({ despacho: '15-1-2026', cant: 999 }), 90000);
    const [{ n }] = await q('SELECT count(*)::int AS n FROM oor_revisiones');
    expect(n).toBe(60);
    // Todo snapshot referenciado por una revision sigue existiendo (la FK lo exige) y no sobra ninguno viejo.
    const huerfanos = await q(
      `SELECT count(*)::int AS n FROM oor_snapshots s
        WHERE s.id NOT IN (SELECT id FROM oor_snapshots ORDER BY id DESC LIMIT 10)
          AND s.id NOT IN (SELECT desde_snapshot_id FROM oor_revisiones WHERE desde_snapshot_id IS NOT NULL)
          AND s.id NOT IN (SELECT hasta_snapshot_id FROM oor_revisiones)`
    );
    expect(huerfanos[0].n).toBe(0);
    const [{ total }] = await q('SELECT count(*)::int AS total FROM oor_snapshots');
    expect(total).toBeLessThanOrEqual(71);
  });
});
