// SQL del adaptador CRM y del repositorio contra un pool falso: parámetros y reglas.
const crm = require('../src/seguimiento/crmAdaptador');
const { crearRepositorio, ESQUEMA } = require('../src/seguimiento/repositorio');

const pool = (rows = []) => ({ query: jest.fn(async () => ({ rows, rowCount: rows.length })) });
const sqlDe = (db, i = 0) => db.query.mock.calls[i][0].replace(/\s+/g, ' ');

describe('adaptador CRM', () => {
  test('alta automática: solo nueva/cotizada, cotización desde la fecha y sin seguimiento previo', async () => {
    const db = pool([{ oportunidad_id: 1, cotizacion_id: 5 }]);
    expect(await crm.altaAutomatica(db, { desde: '2026-10-12T00:00:00.000Z' })).toEqual([{ oportunidad_id: 1, cotizacion_id: 5 }]);
    const sql = sqlDe(db);
    expect(sql).toMatch(/INSERT INTO crm_seguimientos/);
    expect(sql).toMatch(/c\.created_at >= \$2/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM crm_seguimientos/);
    expect(sql).toMatch(/ON CONFLICT \(oportunidad_id\) DO NOTHING/);
    expect(db.query.mock.calls[0][1]).toEqual([['nueva', 'cotizada'], '2026-10-12T00:00:00.000Z']);
  });

  test('cambiarEtapa sigue el contrato CRM y exige motivo para perdida', async () => {
    const db = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
    expect(await crm.cambiarEtapa(db, '7', 'perdida', 'Sin respuesta')).toBe(true);
    const sql = sqlDe(db);
    expect(sql).toMatch(/etapa_desde = NOW\(\)/);
    expect(sql).toMatch(/cerrada_en = CASE WHEN \$2::text IN \('ganada', 'perdida'\)/);
    expect(sql).toMatch(/WHERE id = \$1 AND etapa <> \$2::text/);
    expect(db.query.mock.calls[0][1]).toEqual([7, 'perdida', 'Sin respuesta']);
    await expect(crm.cambiarEtapa(db, 7, 'perdida')).rejects.toThrow(/motivo/);
  });

  test('oportunidadesParaSeguimiento filtra por estados, oportunidades o cotizaciones y calcula el monto del contrato', async () => {
    const db = pool([{ id: 1, monto: '1500.50', total: '1500.50' }]);
    const [fila] = await crm.oportunidadesParaSeguimiento(db, { estados: ['esperando'], oportunidadIds: ['3'] });
    expect(fila.monto).toBe(1500.5);
    const sql = sqlDe(db);
    expect(sql).toMatch(/COALESCE\(o\.monto_manual, \( SELECT c2\.total FROM cotizaciones c2/);
    expect(sql).toMatch(/WHERE s\.estado = ANY\(\$1::text\[\]\) AND s\.oportunidad_id = ANY\(\$2::int\[\]\)/);
    expect(db.query.mock.calls[0][1]).toEqual([['esperando'], [3]]);
    await crm.oportunidadesParaSeguimiento(db, { cotizacionIds: [9] });
    expect(sqlDe(db, 1)).toMatch(/WHERE s\.cotizacion_id = ANY\(\$1::int\[\]\)/);
  });
});

describe('repositorio', () => {
  test('el esquema es idempotente (IF NOT EXISTS) e incluye las tablas del contrato', async () => {
    for (const sql of ESQUEMA) expect(sql).toMatch(/IF NOT EXISTS/);
    const texto = ESQUEMA.join('\n');
    for (const t of ['crm_seguimientos', 'crm_seguimiento_eventos', 'crm_seguimiento_tareas', 'crm_seguimiento_estado']) expect(texto).toContain(t);
    for (const col of ['oportunidad_id', 'cotizacion_id', 'estado', 'paso', 'conversation_id', 'message_id', 'enviado_en', 'ultimo_envio_mio_en', 'proxima_accion', 'proxima_accion_en', 'borrador_id', 'borrador_creado_en', 'respuesta_en', 'respuesta_resumen VARCHAR(400)', 'intentos_busqueda']) {
      expect(texto).toContain(col);
    }
    const db = pool();
    await crearRepositorio(db).crearEsquema({ warn: jest.fn() });
    expect(db.query).toHaveBeenCalledTimes(ESQUEMA.length + 1); // + claves foráneas condicionales
    expect(sqlDe(db, ESQUEMA.length)).toMatch(/to_regclass\('public\.crm_oportunidades'\)/);
  });

  test('si las claves foráneas fallan, el esquema igual queda y se registra', async () => {
    const db = { query: jest.fn(async (sql) => { if (sql.includes('DO $$')) throw new Error('sin permiso'); return { rows: [] }; }) };
    const logger = { warn: jest.fn() };
    await crearRepositorio(db).crearEsquema(logger);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('actualizar solo toca columnas permitidas y exige el estado esperado', async () => {
    const db = pool([{ id: 1, estado: 'respondida' }]);
    await crearRepositorio(db).actualizar(1, 'esperando', { estado: 'respondida', respuesta_resumen: 'ok', oportunidad_id: 99, 'x; DROP': 1 });
    expect(sqlDe(db)).toBe('UPDATE crm_seguimientos SET estado = $3, respuesta_resumen = $4, updated_at = NOW() WHERE id = $1 AND estado = $2 RETURNING *');
    expect(db.query.mock.calls[0][1]).toEqual([1, 'esperando', 'respondida', 'ok']);
  });

  test('líneas con la entrega vigente del catálogo y margen solo si hay costo', async () => {
    const db = pool([{ cotizacion_id: 5, margen: '300', con_costo: '2' }, { cotizacion_id: 6, margen: null, con_costo: '0' }]);
    const repo = crearRepositorio(db);
    const m = await repo.margenCotizaciones([5, 6]);
    expect(m.get(5)).toBe(300);
    expect(m.get(6)).toBeNull();
    await repo.lineasCotizacion(5);
    expect(sqlDe(db, 1)).toMatch(/COALESCE\(NULLIF\(p\.tiempo_entrega, ''\), ci\.tiempo_entrega\) AS entrega/);
  });
});
