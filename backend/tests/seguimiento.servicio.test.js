const { crearServicioSeguimiento } = require('../src/seguimiento/servicio');
const { crearCalendario, fechaChile } = require('../src/seguimiento/calendario');
const { leerFeriados } = require('../src/seguimiento/feriados');
const { leerConfigSeguimiento } = require('../src/seguimiento/config');
const { crearCola } = require('../src/seguimiento/cola');
const { cl, crearDbTareas, crearMundo } = require('./helpers/seguimientoFalso');

const cal = crearCalendario({ feriados: leerFeriados({}) });
const silencio = { info: () => {}, warn: () => {}, error: () => {} };

const armar = ({ inicio, env = { SEGUIMIENTO_ACTIVO: 'true' }, whatsapp = null, leerStock } = {}) => {
  const reloj = { t: cl(inicio).getTime() };
  const db = crearDbTareas();
  const mundo = crearMundo({ reloj });
  const config = leerConfigSeguimiento(env);
  const ahora = () => reloj.t;
  const cola = crearCola({ db, config: config.tareas, ahora, logger: silencio, esperar: async () => {} });
  const servicio = crearServicioSeguimiento({
    db,
    calendario: cal,
    config,
    whatsapp,
    leerStock: leerStock || (async () => [{ mpn: '02491-001', sku: 'AX1', disponible: 7 }]),
    pdfNombre: ({ numero, proyecto }) => `COT-${numero}_${proyecto}`,
    crm: mundo.crm,
    repo: mundo.repo,
    cola,
    ahora,
    logger: silencio
  });
  const ir = (texto) => {
    reloj.t = cl(texto).getTime();
  };
  // El agente toma la siguiente tarea y devuelve lo que diga `responder(items)`.
  const agente = async (responder) => {
    const tarea = await cola.tomar();
    if (!tarea) return null;
    const cuerpo = responder(tarea);
    const r = await servicio.registrarResultado(tarea.id, cuerpo);
    return { tarea, r };
  };
  return { reloj, db, mundo, servicio, cola, ir, agente };
};

const seg = (mundo, oportunidadId = 1) => [...mundo.store.segs.values()].find((s) => s.oportunidad_id === oportunidadId);
const tipos = (mundo) => mundo.store.eventos.map((e) => e.tipo);

describe('servicio de seguimiento: ciclo completo', () => {
  test('alta, vinculación, 1er y 2º seguimiento, cierre "Sin respuesta", reapertura y valor', async () => {
    const wa = { habilitado: () => true, avisar: jest.fn(async () => true) };
    const { mundo, servicio, ir, agente, db } = armar({ inicio: '2026-11-02 13:05', whatsapp: wa });
    mundo.agregarOportunidad({ id: 1, empresa: 'Sonda', creada: cl('2026-11-02 10:00'), cotizacion: { numero: 65430, total: 2500 } });

    // Lunes 13:05 (turno de las 13:00): entra al seguimiento y se pide buscar el envío.
    const c1 = await servicio.ciclo();
    expect(c1.altas).toBe(1);
    expect(seg(mundo).estado).toBe('buscando_envio');
    const t1 = await agente((tarea) => {
      expect(tarea.tipo).toBe('buscar_envios');
      expect(tarea.items).toEqual([
        // pdfNombre da la base sin versión: el agente acepta cualquier `_vN.pdf` (la cotización
        // pudo editarse después de enviarla); pdf_nombre queda como el de la v1 por compatibilidad.
        {
          cotizacion_id: 101, numero: 65430, pdf_nombre: 'COT-65430_Proyecto CCTV_v1.pdf', pdf_nombre_base: 'COT-65430_Proyecto CCTV',
          cliente_email: 'ana1@cliente.cl', cliente_empresa: 'Sonda', creada_en: cl('2026-11-02 10:00').toISOString()
        }
      ]);
      expect(tarea.instrucciones).toMatch(/enviados/i);
      expect(tarea.instrucciones).toMatch(/pdf_nombre_base/);
      expect(tarea.instrucciones).toMatch(/_v<N>\.pdf/);
      return { ok: true, items: [{ cotizacion_id: 101, encontrado: true, message_id: 'msg-1', conversation_id: 'conv-1', enviado_en: cl('2026-11-02 11:00').toISOString(), para: ['ana1@cliente.cl'] }] };
    });
    expect(t1.r.status).toBe(204);
    expect(seg(mundo)).toMatchObject({ estado: 'esperando', paso: 0, message_id: 'msg-1', proxima_accion: 'crear_borrador_1' });
    expect(fechaChile(seg(mundo).proxima_accion_en)).toBe('2026-11-05');
    expect(JSON.stringify(seg(mundo))).not.toMatch(/ana1@cliente/); // no se guardan destinatarios

    // Jueves 07:35: turno de revisión de hilos, sin respuesta.
    ir('2026-11-05 07:35');
    await servicio.ciclo();
    await agente((tarea) => {
      expect(tarea.tipo).toBe('revisar_hilos');
      expect(tarea.items).toEqual([{ oportunidad_id: 1, conversation_id: 'conv-1', message_id: 'msg-1', desde: cl('2026-11-02 11:00').toISOString() }]);
      return { ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: false }] };
    });

    // 08:15: vence el 1er seguimiento -> tarea de borrador con contexto real.
    ir('2026-11-05 08:15');
    await servicio.ciclo();
    await servicio.ciclo(); // otro ciclo no duplica la tarea
    expect(db.tareas.filter((x) => x.tipo === 'crear_borradores')).toHaveLength(1);
    await agente((tarea) => {
      expect(tarea.tipo).toBe('crear_borradores');
      const [item] = tarea.items;
      expect(item).toMatchObject({ oportunidad_id: 1, message_id: 'msg-1', paso: 1, para: ['ana1@cliente.cl'] });
      expect(item.contexto).toEqual({
        contacto_nombre: 'Ana Pérez', empresa: 'Sonda', numero: 65430, monto: 2500, moneda: 'USD',
        validez_vence_en: '2026-11-17', dias_desde_envio: 2,
        productos: [{ descripcion: 'Cámara AXIS P1465-LE', cantidad: 4, stock: 7, entrega: '4-6 semanas' }]
      });
      expect(item.guia).toMatch(/stock y la entrega/);
      return { ok: true, items: [{ oportunidad_id: 1, creado: true, borrador_id: 'draft-1' }] };
    });
    expect(seg(mundo)).toMatchObject({ estado: 'borrador_listo', borrador_paso: 1, borrador_id: 'draft-1' });

    // Ciclos siguientes no crean otro borrador para el mismo paso.
    ir('2026-11-05 13:05');
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: false, borrador_existe: true, borrador_enviado: false }] }));
    ir('2026-11-09 08:40'); // lunes: 2 días hábiles sin enviar
    await servicio.ciclo();
    expect(db.tareas.filter((x) => x.tipo === 'crear_borradores')).toHaveLength(1);
    const hoy = await servicio.hoy();
    expect(hoy.borradores_sin_enviar).toEqual([expect.objectContaining({ oportunidad_id: 1, paso: 1, dias_habiles: 2 })]);
    expect(hoy.borradores_listos).toEqual([]);

    // El dueño lo envía el lunes a las 10:00; el turno de las 13:00 lo detecta.
    await agente(() => ({ ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: false, ultimo_envio_mio_en: cl('2026-11-09 10:00').toISOString(), borrador_existe: false, borrador_enviado: true }] }));
    expect(seg(mundo)).toMatchObject({ estado: 'esperando', paso: 1, proxima_accion: 'crear_borrador_2' });
    expect(fechaChile(seg(mundo).proxima_accion_en)).toBe('2026-11-18');

    // 2º seguimiento el miércoles 18.
    ir('2026-11-18 07:31');
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: false }] }));
    ir('2026-11-18 08:01');
    await servicio.ciclo();
    await agente((tarea) => {
      expect(tarea.items[0].paso).toBe(2);
      expect(tarea.items[0].guia).toMatch(/validez/);
      return { ok: true, items: [{ oportunidad_id: 1, creado: true, borrador_id: 'draft-2' }] };
    });
    ir('2026-11-19 13:01');
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: false, ultimo_envio_mio_en: cl('2026-11-19 09:00').toISOString(), borrador_enviado: true }] }));
    expect(seg(mundo)).toMatchObject({ estado: 'esperando', paso: 2, proxima_accion: 'cerrar' });
    expect(fechaChile(seg(mundo).proxima_accion_en)).toBe('2026-11-30');

    // Lunes 30: sin respuesta -> cierre y oportunidad perdida "Sin respuesta".
    ir('2026-11-30 07:31');
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: false }] }));
    ir('2026-11-30 08:01');
    await servicio.ciclo();
    expect(seg(mundo).estado).toBe('cerrada_sin_respuesta');
    expect(mundo.store.oportunidades.get(1)).toMatchObject({ etapa: 'perdida', motivo_perdida: 'Sin respuesta' });

    // El cliente responde el martes: se reabre a negociación y se avisa.
    ir('2026-12-01 13:01');
    await servicio.ciclo();
    await agente((tarea) => {
      expect(tarea.items[0].oportunidad_id).toBe(1);
      return { ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: true, respuesta_en: cl('2026-12-01 11:00').toISOString(), remitente: 'ana1@cliente.cl', resumen: 'Quieren avanzar con 4 cámaras.' }] };
    });
    expect(seg(mundo)).toMatchObject({ estado: 'respondida', respuesta_resumen: 'Quieren avanzar con 4 cámaras.' });
    expect(mundo.store.oportunidades.get(1).etapa).toBe('negociacion');
    expect(wa.avisar).toHaveBeenCalledWith(expect.stringMatching(/Respondió Sonda \(cotización N°65430\) \(se reabre\)/));

    // Se gana: el ingreso se atribuye (respondió después de un seguimiento automático).
    await mundo.crm.cambiarEtapa(null, 1, 'ganada');
    const valor = await servicio.valor(cl('2026-11-01 00:00'), cl('2026-12-02 00:00'));
    expect(valor.ingreso_atribuido).toBe(2500);
    expect(valor.margen_atribuido).toBe(200); // 1000 - 200 * 4
    expect(valor.acciones.vincular.cantidad).toBe(1);
    expect(valor.acciones.borrador.cantidad).toBe(2);
    expect(valor.respuestas_por_paso[2]).toEqual({ paso: 2, enviados: 1, respuestas: 1, tasa: 1 });
    expect(valor.tasa_cierre).toBe(1);
    expect(tipos(mundo)).toEqual(expect.arrayContaining(['alta', 'envio_vinculado', 'borrador_creado', 'seguimiento_enviado', 'cerrada_sin_respuesta', 'respuesta', 'crm_actualizado']));
  });

  test('respuesta en el paso 0: la oportunidad pasa de cotizada a negociación', async () => {
    const { mundo, servicio, ir, agente } = armar({ inicio: '2026-11-02 13:05' });
    mundo.agregarOportunidad({ id: 1, creada: cl('2026-11-02 10:00') });
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ cotizacion_id: 101, encontrado: true, message_id: 'm', conversation_id: 'c', enviado_en: cl('2026-11-02 11:00').toISOString() }] }));
    ir('2026-11-02 17:35');
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: true, resumen: 'Gracias, lo revisamos.' }] }));
    expect(seg(mundo).estado).toBe('respondida');
    expect(mundo.store.oportunidades.get(1).etapa).toBe('negociacion');
    ir('2026-11-05 08:15');
    await servicio.ciclo();
    expect((await servicio.hoy()).respuestas).toEqual([]); // la respuesta fue el lunes; hoy es jueves
  });

  test('sin correo de envío tras 10 días hábiles queda sin_envio y aparece en el resumen', async () => {
    const { mundo, servicio, ir, agente } = armar({ inicio: '2026-11-02 13:05' });
    mundo.agregarOportunidad({ id: 1, creada: cl('2026-11-02 10:00') });
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ cotizacion_id: 101, encontrado: false }] }));
    expect(seg(mundo)).toMatchObject({ estado: 'buscando_envio', intentos_busqueda: 1 });
    ir('2026-11-16 13:05');
    await servicio.ciclo();
    expect(seg(mundo).estado).toBe('sin_envio');
    expect((await servicio.hoy()).sin_correo).toEqual([expect.objectContaining({ oportunidad_id: 1 })]);
    const r = await servicio.reanudar(1);
    expect(r.seguimiento.estado).toBe('buscando_envio');
  });

  test('alta: no entran cotizaciones de más de 30 días ni oportunidades cerradas', async () => {
    const { mundo, servicio } = armar({ inicio: '2026-11-11 13:05' });
    mundo.agregarOportunidad({ id: 1, creada: cl('2026-10-01 10:00') });
    mundo.agregarOportunidad({ id: 2, creada: cl('2026-11-10 10:00') });
    mundo.agregarOportunidad({ id: 3, etapa: 'ganada', creada: cl('2026-11-10 10:00') });
    expect((await servicio.ciclo()).altas).toBe(1);
    expect([...mundo.store.segs.values()].map((s) => s.oportunidad_id)).toEqual([2]);
    expect((await servicio.ciclo()).altas).toBe(0);
  });

  test('con SEGUIMIENTO_ACTIVO=false el ciclo no toca nada', async () => {
    const wa = { habilitado: () => true, avisar: jest.fn(async () => true) };
    const { mundo, servicio, db } = armar({ inicio: '2026-11-11 13:05', env: {}, whatsapp: wa });
    mundo.agregarOportunidad({ id: 1, creada: cl('2026-11-10 10:00') });
    expect(await servicio.ciclo()).toEqual({ activo: false });
    expect(mundo.crm.altaAutomatica).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(wa.avisar).not.toHaveBeenCalled();
  });

  test('agrupa en tareas de máximo 20 ítems', async () => {
    const { mundo, servicio, db } = armar({ inicio: '2026-11-11 13:05' });
    for (let i = 1; i <= 45; i += 1) mundo.agregarOportunidad({ id: i, creada: cl('2026-11-10 10:00') });
    await servicio.ciclo();
    expect(db.tareas.map((x) => x.items.length)).toEqual([20, 20, 5]);
    // El mismo turno no vuelve a encolar.
    await servicio.ciclo();
    expect(db.tareas).toHaveLength(3);
  });

  test('si la oportunidad se gana por fuera, el seguimiento se detiene', async () => {
    const { mundo, servicio, agente } = armar({ inicio: '2026-11-02 13:05' });
    mundo.agregarOportunidad({ id: 1, creada: cl('2026-11-02 10:00') });
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ cotizacion_id: 101, encontrado: true, message_id: 'm', conversation_id: 'c', enviado_en: cl('2026-11-02 11:00').toISOString() }] }));
    await mundo.crm.cambiarEtapa(null, 1, 'ganada');
    await servicio.ciclo();
    expect(seg(mundo).estado).toBe('pausada');
  });

  test('un borrador pedido que el agente no devuelve cuenta como fallido', async () => {
    const { mundo, servicio, ir, agente } = armar({ inicio: '2026-11-02 13:05' });
    mundo.agregarOportunidad({ id: 1, creada: cl('2026-11-02 10:00') });
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ cotizacion_id: 101, encontrado: true, message_id: 'm', conversation_id: 'c', enviado_en: cl('2026-11-02 11:00').toISOString() }] }));
    ir('2026-11-05 07:35');
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ oportunidad_id: 1, respuesta_recibida: false }] }));
    ir('2026-11-05 08:15');
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [] }));
    expect(seg(mundo)).toMatchObject({ estado: 'esperando', borrador_fallos: 1 });
  });

  test('pausar y reanudar desde el panel; 404 y 409', async () => {
    const { mundo, servicio, agente } = armar({ inicio: '2026-11-02 13:05' });
    mundo.agregarOportunidad({ id: 1, creada: cl('2026-11-02 10:00') });
    await servicio.ciclo();
    await agente(() => ({ ok: true, items: [{ cotizacion_id: 101, encontrado: true, message_id: 'm', conversation_id: 'c', enviado_en: cl('2026-11-02 11:00').toISOString() }] }));
    expect((await servicio.pausar(1)).seguimiento.estado).toBe('pausada');
    expect((await servicio.pausar(1)).status).toBe(409);
    expect((await servicio.pausar(99)).status).toBe(404);
    expect((await servicio.reanudar(1)).seguimiento).toMatchObject({ estado: 'esperando', proxima_accion: 'crear_borrador_1' });
    const d = await servicio.detalle(1);
    expect(d.eventos.map((e) => e.tipo)).toEqual(['reanudada', 'pausada', 'envio_vinculado', 'alta']);
    expect(d.siguiente.accion).toBe('crear_borrador_1');
  });
});

describe('resúmenes por WhatsApp', () => {
  const preparar = async (inicio, wa, env) => {
    const ctx = armar({ inicio, whatsapp: wa, env: { SEGUIMIENTO_ACTIVO: 'true', ...env } });
    ctx.mundo.agregarOportunidad({ id: 1, empresa: 'Sonda', creada: cl(inicio).getTime() - 24 * 3600000, cotizacion: { numero: 65430 } });
    return ctx;
  };

  test('diario a las 08:30 en día hábil, una vez; si falla reintenta en el ciclo siguiente', async () => {
    const wa = { habilitado: () => true, avisar: jest.fn(async () => false) };
    const { servicio, ir, mundo } = await preparar('2026-11-11 08:20', wa);
    await servicio.ciclo(); // alta, aún no son las 08:30
    expect(wa.avisar).not.toHaveBeenCalled();
    ir('2026-11-11 08:31');
    expect((await servicio.ciclo()).resumenes.diario).toBe('vacio'); // nada que contar
    expect(wa.avisar).not.toHaveBeenCalled();

    // Día siguiente con un borrador listo.
    const s = seg(mundo);
    Object.assign(s, { estado: 'borrador_listo', borrador_paso: 1, borrador_creado_en: cl('2026-11-12 08:10').toISOString(), message_id: 'm', conversation_id: 'c' });
    ir('2026-11-12 08:31');
    expect((await servicio.ciclo()).resumenes.diario).toBe('fallo');
    wa.avisar.mockResolvedValue(true);
    ir('2026-11-12 08:46');
    expect((await servicio.ciclo()).resumenes.diario).toBe('enviado');
    expect(wa.avisar).toHaveBeenLastCalledWith(expect.stringContaining('*Borradores para enviar (1)*\n• Sonda N°65430 (1er seg.)'));
    const llamadas = wa.avisar.mock.calls.length;
    ir('2026-11-12 09:01');
    await servicio.ciclo();
    expect(wa.avisar.mock.calls.length).toBe(llamadas); // sin spam
    expect(tipos(mundo).filter((x) => x === 'resumen_diario')).toHaveLength(1);
  });

  test('no hay resumen diario en feriado ni fin de semana', async () => {
    const wa = { habilitado: () => true, avisar: jest.fn(async () => true) };
    const { servicio, ir, mundo } = await preparar('2026-12-08 09:00', wa);
    await servicio.ciclo();
    Object.assign(seg(mundo), { estado: 'sin_envio' });
    ir('2026-12-08 10:00');
    await servicio.ciclo();
    ir('2026-12-12 10:00');
    await servicio.ciclo();
    expect(wa.avisar).not.toHaveBeenCalled();
    ir('2026-12-14 08:31');
    await servicio.ciclo();
    expect(wa.avisar).toHaveBeenCalledWith(expect.stringContaining('*Sin correo encontrado (1)*'));
  });

  test('semanal el viernes desde las 17:00 y con plantilla si está configurada', async () => {
    const wa = { habilitado: () => true, avisar: jest.fn(async () => true), avisarPlantilla: jest.fn(async () => true) };
    const { servicio, ir } = await preparar('2026-11-13 16:50', wa, { WHATSAPP_PLANTILLA_RESUMEN: 'resumen_myquote' });
    await servicio.ciclo();
    expect(wa.avisarPlantilla).not.toHaveBeenCalled();
    ir('2026-11-13 17:01');
    expect((await servicio.ciclo()).resumenes.semanal).toBe('enviado');
    expect(wa.avisar).not.toHaveBeenCalled();
    const [{ nombre, idioma, parametros }] = wa.avisarPlantilla.mock.calls[0];
    expect(nombre).toBe('resumen_myquote');
    expect(idioma).toBe('es');
    expect(parametros[0]).not.toMatch(/\n/);
    expect(parametros[0]).toMatch(/Seguimiento MyQuote · semana/);
    ir('2026-11-13 17:20');
    await servicio.ciclo();
    expect(wa.avisarPlantilla).toHaveBeenCalledTimes(1);
  });
});
