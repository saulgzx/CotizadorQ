const { crearCola, trozos } = require('../src/seguimiento/cola');
const { validarResultado } = require('../src/seguimiento/esquemas');
const { crearDbTareas } = require('./helpers/seguimientoFalso');

const MIN = 60 * 1000;
const silencio = { info: () => {}, warn: jest.fn(), error: () => {} };

const armar = () => {
  const reloj = { t: Date.parse('2026-11-11T15:00:00Z') };
  const db = crearDbTareas();
  const cola = crearCola({ db, ahora: () => reloj.t, logger: silencio, esperar: async (ms) => { reloj.t += ms; } });
  return { reloj, db, cola };
};

const valido = { ok: true, items: [{ cotizacion_id: 1, encontrado: false }] };

describe('cola de tareas del agente', () => {
  test('trozos de hasta 20', () => {
    expect(trozos([...Array(41).keys()], 20).map((x) => x.length)).toEqual([20, 20, 1]);
  });

  test('toma la tarea con id, tipo, creada_en, items e instrucciones; 204 al devolver', async () => {
    const { cola, db } = armar();
    await cola.encolar('buscar_envios', [{ cotizacion_id: 1 }]);
    const tarea = await cola.tomar();
    expect(Object.keys(tarea).sort()).toEqual(['creada_en', 'id', 'instrucciones', 'items', 'tipo']);
    expect(await cola.tomar()).toBeNull();
    const aplicar = jest.fn();
    expect(await cola.registrarResultado(tarea.id, valido, aplicar)).toEqual({ status: 204 });
    expect(aplicar).toHaveBeenCalledWith({ id: tarea.id, tipo: 'buscar_envios' }, [{ resultado: { cotizacion_id: 1, encontrado: false }, pedido: { cotizacion_id: 1 } }]);
    expect(db.tareas[0].estado).toBe('hecha');
    // Un segundo POST no se aplica dos veces.
    expect((await cola.registrarResultado(tarea.id, valido, aplicar)).status).toBe(409);
    expect(aplicar).toHaveBeenCalledTimes(1);
    expect((await cola.registrarResultado(999, valido, aplicar)).status).toBe(404);
  });

  test('un resultado malformado no toca el estado: se registra y vuelve a la cola a los 15 min', async () => {
    const { cola, db, reloj } = armar();
    await cola.encolar('buscar_envios', [{ cotizacion_id: 1 }]);
    const tarea = await cola.tomar();
    const aplicar = jest.fn();
    const r = await cola.registrarResultado(tarea.id, { ok: true, items: [{ cotizacion_id: 1, encontrado: 'si' }] }, aplicar);
    expect(r.status).toBe(400);
    expect(aplicar).not.toHaveBeenCalled();
    expect(db.tareas[0]).toMatchObject({ estado: 'pendiente', error: expect.stringMatching(/malformado/) });
    expect(await cola.tomar()).toBeNull(); // todavía no
    reloj.t += 15 * MIN;
    expect((await cola.tomar()).id).toBe(tarea.id);
  });

  test('máximo 3 intentos: después la tarea queda fallida', async () => {
    const { cola, db, reloj } = armar();
    await cola.encolar('revisar_hilos', [{ oportunidad_id: 1 }]);
    for (let i = 1; i <= 3; i += 1) {
      const tarea = await cola.tomar();
      expect(tarea).not.toBeNull();
      await cola.registrarResultado(tarea.id, { ok: false, error: 'Outlook no respondió' }, jest.fn());
      reloj.t += 15 * MIN;
    }
    expect(db.tareas[0].estado).toBe('fallida');
    expect(db.tareas[0].intentos).toBe(3);
    expect(await cola.tomar()).toBeNull();
  });

  test('una tarea tomada y no devuelta en 15 minutos vuelve a la cola', async () => {
    const { cola, db, reloj } = armar();
    await cola.encolar('buscar_envios', [{ cotizacion_id: 1 }]);
    const t1 = await cola.tomar();
    reloj.t += 14 * MIN;
    expect(await cola.tomar()).toBeNull();
    reloj.t += 2 * MIN;
    const t2 = await cola.tomar();
    expect(t2.id).toBe(t1.id);
    expect(db.tareas[0].intentos).toBe(2);
    reloj.t += 16 * MIN;
    await cola.tomar(); // tercer intento
    reloj.t += 16 * MIN;
    await cola.vencerTomadas();
    expect(db.tareas[0].estado).toBe('fallida');
  });

  test('liberar devuelve la tarea sin gastar intento', async () => {
    const { cola, db } = armar();
    await cola.encolar('buscar_envios', [{ cotizacion_id: 1 }]);
    const tarea = await cola.tomar();
    await cola.liberar(tarea.id);
    expect(db.tareas[0]).toMatchObject({ estado: 'pendiente', intentos: 0 });
  });

  test('solo se aplican los ítems que pertenecen a la tarea', async () => {
    const { cola } = armar();
    await cola.encolar('buscar_envios', [{ cotizacion_id: 1 }]);
    const tarea = await cola.tomar();
    const aplicar = jest.fn();
    await cola.registrarResultado(tarea.id, { ok: true, items: [{ cotizacion_id: 1, encontrado: false }, { cotizacion_id: 2, encontrado: false }] }, aplicar);
    expect(aplicar.mock.calls[0][1]).toHaveLength(1);
  });

  test('idsEnCurso ve los ítems de tareas pendientes y tomadas', async () => {
    const { cola } = armar();
    await cola.encolar('revisar_hilos', [{ oportunidad_id: 4 }, { oportunidad_id: 5 }]);
    expect([...(await cola.idsEnCurso('revisar_hilos'))]).toEqual([4, 5]);
    expect((await cola.idsEnCurso('buscar_envios')).size).toBe(0);
  });

  test('long poll: espera hasta el límite y devuelve null; una tarea nueva la despierta', async () => {
    const { cola, reloj } = armar();
    const inicio = reloj.t;
    expect(await cola.esperarTarea({ esperaMs: 25000 })).toBeNull();
    expect(reloj.t - inicio).toBe(25000);

    const real = crearCola({ db: crearDbTareas(), logger: silencio });
    const espera = real.esperarTarea({ esperaMs: 3000 });
    setTimeout(() => real.encolar('buscar_envios', [{ cotizacion_id: 9 }]), 20);
    const tarea = await espera;
    expect(tarea.items).toEqual([{ cotizacion_id: 9 }]);
  });
});

describe('validación de resultados (zod)', () => {
  test('acepta el contrato y rechaza claves desconocidas o tipos erróneos', () => {
    expect(validarResultado('revisar_hilos', { ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: true, respuesta_en: '2026-11-11T12:00:00-03:00', remitente: 'a@b.cl', resumen: 'ok' }], metricas: { ms: 10 } }).ok).toBe(true);
    expect(validarResultado('revisar_hilos', { ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: true, cuerpo: 'texto completo' }] }).ok).toBe(false);
    expect(validarResultado('revisar_hilos', { ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: false, respuesta_en: 'ayer' }] }).ok).toBe(false);
    expect(validarResultado('crear_borradores', { ok: true, items: [{ oportunidad_id: 1, creado: true }] }).ok).toBe(false);
    expect(validarResultado('buscar_envios', { ok: 'si' }).ok).toBe(false);
    expect(validarResultado('otro', { ok: true }).ok).toBe(false);
    expect(validarResultado('buscar_envios', null).ok).toBe(false);
  });
});
