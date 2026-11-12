const motor = require('../src/seguimiento/motor');
const { crearCalendario, fechaChile, minutosChile } = require('../src/seguimiento/calendario');
const { leerFeriados } = require('../src/seguimiento/feriados');
const { cl } = require('./helpers/seguimientoFalso');

const cal = crearCalendario({ feriados: leerFeriados({}) });
const { ESTADOS } = motor;

const seg = (extra = {}) => ({
  id: 1,
  oportunidad_id: 10,
  cotizacion_id: 100,
  estado: ESTADOS.ESPERANDO,
  paso: 0,
  etapa: 'cotizada',
  motivo_perdida: null,
  conversation_id: 'conv-1',
  message_id: 'msg-1',
  enviado_en: cl('2026-11-02 11:00').toISOString(), // lunes
  ultimo_envio_mio_en: cl('2026-11-02 11:00').toISOString(),
  ultima_revision_en: null,
  borrador_id: null,
  borrador_paso: null,
  borrador_creado_en: null,
  borrador_fallos: 0,
  intentos_busqueda: 0,
  busqueda_desde: cl('2026-11-02 12:00').toISOString(),
  created_at: cl('2026-11-02 12:00').toISOString(),
  empresa_nombre: 'Sonda',
  numero: 65430,
  ...extra
});

const aplicar = (s, r) => ({ ...s, ...r.cambios });

describe('siguientePaso: cadencia en días hábiles', () => {
  test('paso 0: 1er borrador a los 3 días hábiles, a las 08:00 de Chile', () => {
    const r = motor.siguientePaso(seg(), cl('2026-11-03 10:00'), cal);
    expect(r.accion).toBe('crear_borrador_1');
    expect(fechaChile(r.en)).toBe('2026-11-05');
    expect(minutosChile(r.en)).toBe(8 * 60);
    expect(r.vencida).toBe(false);
  });

  test('envío del viernes: los 3 días hábiles saltan el fin de semana', () => {
    const s = seg({ enviado_en: cl('2026-11-13 17:30').toISOString(), ultimo_envio_mio_en: cl('2026-11-13 17:30').toISOString() });
    expect(fechaChile(motor.siguientePaso(s, cl('2026-11-13 18:00'), cal).en)).toBe('2026-11-18');
  });

  test('con feriado en medio se corre un día', () => {
    const s = seg({ enviado_en: cl('2026-12-07 10:00').toISOString(), ultimo_envio_mio_en: cl('2026-12-07 10:00').toISOString() });
    expect(fechaChile(motor.siguientePaso(s, cl('2026-12-07 11:00'), cal).en)).toBe('2026-12-11');
  });

  test('paso 1: 2º borrador a los 7 días hábiles desde que el dueño ENVIÓ el 1º', () => {
    const s = seg({ paso: 1, ultimo_envio_mio_en: cl('2026-11-09 10:00').toISOString() });
    const r = motor.siguientePaso(s, cl('2026-11-10 10:00'), cal);
    expect(r.accion).toBe('crear_borrador_2');
    expect(fechaChile(r.en)).toBe('2026-11-18');
  });

  test('paso 2: cierre a los 7 días hábiles', () => {
    const s = seg({ paso: 2, ultimo_envio_mio_en: cl('2026-11-19 10:00').toISOString() });
    const r = motor.siguientePaso(s, cl('2026-11-20 10:00'), cal);
    expect(r.accion).toBe('cerrar');
    expect(fechaChile(r.en)).toBe('2026-11-30');
  });

  test('vence desde las 08:00 de un día hábil y exige una revisión reciente del hilo', () => {
    const s = seg();
    expect(motor.siguientePaso(s, cl('2026-11-05 07:59'), cal).vencida).toBe(false);
    const sinRevision = motor.siguientePaso(s, cl('2026-11-05 08:15'), cal);
    expect(sinRevision).toMatchObject({ vencida: true, requiereRevision: true });
    const revisado = motor.siguientePaso({ ...s, ultima_revision_en: cl('2026-11-05 07:40').toISOString() }, cl('2026-11-05 08:15'), cal);
    expect(revisado).toMatchObject({ vencida: true, requiereRevision: false, accion: 'crear_borrador_1' });
    const viejo = motor.siguientePaso({ ...s, ultima_revision_en: cl('2026-11-04 17:30').toISOString() }, cl('2026-11-05 08:15'), cal);
    expect(viejo.requiereRevision).toBe(true);
  });

  test('una acción atrasada no se ejecuta en fin de semana', () => {
    expect(motor.siguientePaso(seg(), cl('2026-11-07 10:00'), cal).vencida).toBe(false);
  });

  test('un correo manual del dueño reinicia la espera del paso actual', () => {
    const s = seg();
    const r = motor.aplicarResultado(s, 'revisar_hilos', { oportunidad_id: 10, respuesta_recibida: false, ultimo_envio_mio_en: cl('2026-11-04 09:00').toISOString() }, cl('2026-11-04 13:00'), cal);
    expect(r.eventos.map((e) => e.tipo)).toContain('envio_manual');
    const despues = aplicar(s, r);
    expect(despues.paso).toBe(0);
    expect(fechaChile(motor.siguientePaso(despues, cl('2026-11-04 13:00'), cal).en)).toBe('2026-11-09');
  });
});

describe('buscar_envios', () => {
  const buscando = () => seg({ estado: ESTADOS.BUSCANDO, enviado_en: null, ultimo_envio_mio_en: null, message_id: null, conversation_id: null });

  test('encontrado: pasa a esperando en paso 0 sin guardar destinatarios ni asunto', () => {
    const r = motor.aplicarResultado(buscando(), 'buscar_envios', {
      cotizacion_id: 100, encontrado: true, message_id: 'm', conversation_id: 'c', enviado_en: '2026-11-02T14:00:00Z', para: ['x@y.cl'], asunto: 'Cotización'
    }, cl('2026-11-02 13:00'), cal);
    expect(r.cambios).toEqual({
      estado: ESTADOS.ESPERANDO, paso: 0, message_id: 'm', conversation_id: 'c',
      enviado_en: '2026-11-02T14:00:00.000Z', ultimo_envio_mio_en: '2026-11-02T14:00:00.000Z'
    });
    expect(r.eventos).toEqual([{ tipo: 'envio_vinculado', detalle: { cotizacion_id: 100 } }]);
  });

  test('no encontrado: suma intentos y a los 10 días hábiles queda sin_envio', () => {
    const s = buscando();
    const r1 = motor.aplicarResultado(s, 'buscar_envios', { cotizacion_id: 100, encontrado: false }, cl('2026-11-10 13:00'), cal);
    expect(r1.cambios).toEqual({ intentos_busqueda: 1 });
    // 2-nov + 10 hábiles = 16-nov
    const r2 = motor.aplicarResultado({ ...s, intentos_busqueda: 7 }, 'buscar_envios', { cotizacion_id: 100, encontrado: false }, cl('2026-11-16 13:00'), cal);
    expect(r2.cambios).toEqual({ estado: ESTADOS.SIN_ENVIO, intentos_busqueda: 8 });
    expect(motor.siguientePaso(s, cl('2026-11-13 13:00'), cal).accion).toBe('buscar_envio');
    expect(motor.siguientePaso(s, cl('2026-11-16 08:00'), cal).accion).toBe('marcar_sin_envio');
  });

  test('un resultado para un seguimiento que ya no busca se ignora', () => {
    const r = motor.aplicarResultado(seg(), 'buscar_envios', { cotizacion_id: 100, encontrado: true, message_id: 'x', conversation_id: 'y', enviado_en: '2026-11-03T10:00:00Z' }, cl('2026-11-03 13:00'), cal);
    expect(r.ignorado).toBe('estado');
    expect(r.cambios).toEqual({});
  });
});

describe('respuesta del cliente en cualquier paso', () => {
  const respuesta = { oportunidad_id: 10, respuesta_recibida: true, respuesta_en: '2026-11-04T15:00:00Z', remitente: 'ana@cliente.cl', resumen: 'Pide plazo. Escribir a ana@cliente.cl o +56 9 1234 5678, ver https://x.cl/a' };

  test.each([
    ['paso 0 esperando', { paso: 0 }],
    ['paso 1 esperando', { paso: 1 }],
    ['paso 2 esperando', { paso: 2 }],
    ['con borrador listo', { estado: ESTADOS.BORRADOR, borrador_id: 'b1', borrador_paso: 1 }]
  ])('%s: se detiene, pasa a negociación y avisa', (_n, extra) => {
    const s = seg(extra);
    const r = motor.aplicarResultado(s, 'revisar_hilos', respuesta, cl('2026-11-04 13:00'), cal);
    expect(r.cambios.estado).toBe(ESTADOS.RESPONDIDA);
    expect(r.cambios.proxima_accion).toBeNull();
    expect(r.etapa).toEqual({ etapa: 'negociacion', motivo: null });
    expect(r.aviso).toMatch(/Respondió Sonda \(cotización N°65430\)/);
    const ev = r.eventos.find((e) => e.tipo === 'respuesta');
    expect(ev.detalle.paso).toBe(s.paso);
    expect(motor.siguientePaso(aplicar(s, r), cl('2026-11-30 10:00'), cal).accion).toBeNull();
  });

  test('el resumen se limpia de correos, teléfonos y enlaces y se corta a 400', () => {
    const r = motor.aplicarResultado(seg(), 'revisar_hilos', respuesta, cl('2026-11-04 13:00'), cal);
    expect(r.cambios.respuesta_resumen).toBe('Pide plazo. Escribir a [correo] o [número], ver [enlace]');
    expect(motor.limpiarResumen('a'.repeat(1000))).toHaveLength(400);
  });

  test('una oportunidad ganada no cambia de etapa (solo desde nueva/cotizada)', () => {
    const r = motor.aplicarResultado(seg({ etapa: 'ganada' }), 'revisar_hilos', respuesta, cl('2026-11-04 13:00'), cal);
    expect(r.etapa).toBeNull();
  });

  test('reabre una oportunidad perdida por "Sin respuesta"', () => {
    const s = seg({ estado: ESTADOS.CERRADA, paso: 2, etapa: 'perdida', motivo_perdida: 'Sin respuesta' });
    const r = motor.aplicarResultado(s, 'revisar_hilos', respuesta, cl('2026-12-01 13:00'), cal);
    expect(r.cambios.estado).toBe(ESTADOS.RESPONDIDA);
    expect(r.etapa).toEqual({ etapa: 'negociacion', motivo: null });
    expect(r.eventos.find((e) => e.tipo === 'respuesta').detalle.reabierta).toBe(true);
    expect(r.aviso).toMatch(/se reabre/);
  });

  test('una perdida por otro motivo no se reabre', () => {
    const s = seg({ estado: ESTADOS.CERRADA, paso: 2, etapa: 'perdida', motivo_perdida: 'Precio' });
    expect(motor.aplicarResultado(s, 'revisar_hilos', respuesta, cl('2026-12-01 13:00'), cal).etapa).toBeNull();
  });
});

describe('borradores', () => {
  const creado = { oportunidad_id: 10, creado: true, borrador_id: 'b1' };

  test('crear_borradores deja borrador_listo y no hay otra acción de borrador', () => {
    const s = seg({ ultima_revision_en: cl('2026-11-05 07:40').toISOString() });
    const r = motor.aplicarResultado(s, 'crear_borradores', creado, cl('2026-11-05 08:20'), cal, motor.CONFIG_MOTOR, { paso: 1 });
    expect(r.cambios).toMatchObject({ estado: ESTADOS.BORRADOR, borrador_id: 'b1', borrador_paso: 1 });
    const despues = aplicar(s, r);
    const sp = motor.siguientePaso(despues, cl('2026-11-20 10:00'), cal);
    expect(sp.accion).toBe('esperar_envio_borrador');
  });

  test('nunca dos borradores para el mismo paso: un resultado repetido se ignora', () => {
    const s = seg({ estado: ESTADOS.BORRADOR, borrador_id: 'b1', borrador_paso: 1 });
    const r = motor.aplicarResultado(s, 'crear_borradores', { ...creado, borrador_id: 'b2' }, cl('2026-11-05 09:00'), cal, motor.CONFIG_MOTOR, { paso: 1 });
    expect(r.ignorado).toBe('duplicado');
    expect(r.cambios).toEqual({});
    expect(r.eventos[0].tipo).toBe('borrador_duplicado');
  });

  test('un borrador para un paso que no corresponde se ignora', () => {
    const r = motor.aplicarResultado(seg({ paso: 1 }), 'crear_borradores', creado, cl('2026-11-05 09:00'), cal, motor.CONFIG_MOTOR, { paso: 1 });
    expect(r.ignorado).toBe('estado');
  });

  test('borrador sin enviar 2 días hábiles: se recuerda, no se crea otro', () => {
    const s = seg({ estado: ESTADOS.BORRADOR, borrador_id: 'b1', borrador_paso: 1, borrador_creado_en: cl('2026-11-05 08:20').toISOString() });
    expect(motor.siguientePaso(s, cl('2026-11-06 10:00'), cal).recordar).toBe(false);
    const r = motor.siguientePaso(s, cl('2026-11-09 08:00'), cal); // vie 6, lun 9
    expect(r).toMatchObject({ accion: 'esperar_envio_borrador', recordar: true });
  });

  test('la cadencia avanza cuando el dueño ENVÍA el borrador', () => {
    const s = seg({ estado: ESTADOS.BORRADOR, borrador_id: 'b1', borrador_paso: 1, borrador_creado_en: cl('2026-11-05 08:20').toISOString() });
    const r = motor.aplicarResultado(s, 'revisar_hilos', {
      oportunidad_id: 10, respuesta_recibida: false, ultimo_envio_mio_en: cl('2026-11-09 10:00').toISOString(), borrador_existe: false, borrador_enviado: true
    }, cl('2026-11-09 13:00'), cal);
    expect(r.cambios).toMatchObject({ estado: ESTADOS.ESPERANDO, paso: 1, borrador_id: null, borrador_paso: null });
    expect(r.eventos.map((e) => e.tipo)).toEqual(['hilo_revisado', 'seguimiento_enviado']);
    const sp = motor.siguientePaso(aplicar(s, r), cl('2026-11-09 13:00'), cal);
    expect(sp.accion).toBe('crear_borrador_2');
    expect(fechaChile(sp.en)).toBe('2026-11-18');
  });

  test('si el borrador sigue sin enviar la cadencia no avanza', () => {
    const s = seg({ estado: ESTADOS.BORRADOR, borrador_id: 'b1', borrador_paso: 1, borrador_creado_en: cl('2026-11-05 08:20').toISOString() });
    const r = motor.aplicarResultado(s, 'revisar_hilos', { oportunidad_id: 10, respuesta_recibida: false, borrador_existe: true, borrador_enviado: false }, cl('2026-11-09 13:00'), cal);
    expect(r.cambios).toEqual({ ultima_revision_en: cl('2026-11-09 13:00').toISOString() });
  });

  test('si el dueño borra el borrador sin enviarlo, se pausa (no se crea otro)', () => {
    const s = seg({ estado: ESTADOS.BORRADOR, borrador_id: 'b1', borrador_paso: 1 });
    const r = motor.aplicarResultado(s, 'revisar_hilos', { oportunidad_id: 10, respuesta_recibida: false, borrador_existe: false }, cl('2026-11-09 13:00'), cal);
    expect(r.cambios).toMatchObject({ estado: ESTADOS.PAUSADA, estado_antes_pausa: ESTADOS.ESPERANDO, borrador_id: null });
    expect(r.eventos.map((e) => e.tipo)).toContain('borrador_descartado');
  });

  test('un fallo del agente espera 2 h y al tercero pausa', () => {
    const t0 = cl('2026-11-05 08:20');
    const s = seg({ ultima_revision_en: cl('2026-11-05 07:40').toISOString() });
    const r1 = motor.aplicarResultado(s, 'crear_borradores', { oportunidad_id: 10, creado: false }, t0, cal, motor.CONFIG_MOTOR, { paso: 1 });
    expect(r1.cambios).toMatchObject({ borrador_fallos: 1 });
    const s1 = aplicar(s, r1);
    expect(motor.siguientePaso(s1, cl('2026-11-05 09:00'), cal).vencida).toBe(false);
    expect(motor.siguientePaso(s1, cl('2026-11-05 10:21'), cal).vencida).toBe(true);
    const r3 = motor.aplicarResultado({ ...s1, borrador_fallos: 2 }, 'crear_borradores', { oportunidad_id: 10, creado: false }, t0, cal, motor.CONFIG_MOTOR, { paso: 1 });
    expect(r3.cambios.estado).toBe(ESTADOS.PAUSADA);
  });
});

describe('cierre, detención y pausas', () => {
  test('cierre tras el 2º seguimiento: perdida "Sin respuesta"', () => {
    const r = motor.aplicarCierre(seg({ paso: 2 }), cl('2026-11-30 08:15'));
    expect(r.cambios.estado).toBe(ESTADOS.CERRADA);
    expect(r.etapa).toEqual({ etapa: 'perdida', motivo: 'Sin respuesta' });
    expect(motor.aplicarCierre(seg({ paso: 1 }), cl('2026-11-30 08:15')).ignorado).toBe('estado');
  });

  test('si la oportunidad se cerró o pasó a negociación por fuera, el seguimiento se detiene', () => {
    for (const etapa of ['ganada', 'perdida', 'negociacion']) {
      expect(motor.siguientePaso(seg({ etapa }), cl('2026-11-03 10:00'), cal).accion).toBe('detener');
    }
    const r = motor.aplicarDetener(seg({ etapa: 'ganada' }));
    expect(r.cambios).toMatchObject({ estado: ESTADOS.PAUSADA, estado_antes_pausa: ESTADOS.ESPERANDO });
  });

  test('pausar y reanudar vuelven al estado anterior; reanudar un sin_envio reinicia la búsqueda', () => {
    const s = seg();
    const p = motor.pausar(s);
    expect(p.cambios.estado).toBe(ESTADOS.PAUSADA);
    const pausado = aplicar(s, p);
    expect(motor.pausar(pausado)).toBeNull();
    expect(motor.reanudar(pausado, cl('2026-11-10 10:00')).cambios.estado).toBe(ESTADOS.ESPERANDO);
    const sinEnvio = seg({ estado: ESTADOS.SIN_ENVIO, intentos_busqueda: 30, message_id: null });
    const r = motor.reanudar(sinEnvio, cl('2026-11-20 10:00'));
    expect(r.cambios).toMatchObject({ estado: ESTADOS.BUSCANDO, intentos_busqueda: 0 });
    expect(motor.reanudar(seg({ estado: ESTADOS.RESPONDIDA }), cl('2026-11-20 10:00'))).toBeNull();
  });

  test('estados terminales no tienen acción', () => {
    for (const estado of [ESTADOS.RESPONDIDA, ESTADOS.CERRADA, ESTADOS.PAUSADA, ESTADOS.SIN_ENVIO]) {
      expect(motor.siguientePaso(seg({ estado, etapa: 'negociacion' }), cl('2026-11-20 10:00'), cal).accion).toBeNull();
    }
  });
});
