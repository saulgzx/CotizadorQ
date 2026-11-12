const { calcularValor } = require('../src/seguimiento/valor');
const { datosHoy, textoDiario, datosSemana, textoSemanal, unaLinea } = require('../src/seguimiento/resumenes');
const { leerConfigSeguimiento } = require('../src/seguimiento/config');
const { crearCalendario } = require('../src/seguimiento/calendario');
const { leerFeriados } = require('../src/seguimiento/feriados');
const { crearWhatsApp, leerConfigWhatsApp } = require('../src/services/whatsapp');
const { cl } = require('./helpers/seguimientoFalso');

const cal = crearCalendario({ feriados: leerFeriados({}) });
const ev = (tipo, oportunidad_id = null, detalle = {}) => ({ tipo, oportunidad_id, detalle });

describe('configuración', () => {
  test('por defecto inactivo, cada 15 min y minutos estándar del contrato', () => {
    const c = leerConfigSeguimiento({});
    expect(c.activo).toBe(false);
    expect(c.cadaMin).toBe(15);
    expect(c.minutos).toEqual({ vincular: 2, revisar: 2, borrador: 6, crm: 3, resumen: 10 });
    expect(c.horasRevision.map((h) => h.texto)).toEqual(['07:30', '13:00', '17:30']);
    expect(c.resumenDiario.texto).toBe('08:30');
    expect(c.resumenSemanal.texto).toBe('17:00');
    expect(c.tareas).toMatchObject({ maxItems: 20, maxIntentos: 3, reintentoMs: 15 * 60000 });
  });

  test('variables de entorno', () => {
    const c = leerConfigSeguimiento({ SEGUIMIENTO_ACTIVO: 'TRUE', SEGUIMIENTO_CADA_MIN: '5', SEGUIMIENTO_MIN_BORRADOR: '8.5', SEGUIMIENTO_MIN_REVISAR: '-1', SEGUIMIENTO_REVISION_HORAS: '13:00, 7:15,99:00' });
    expect(c.activo).toBe(true);
    expect(c.cadaMin).toBe(5);
    expect(c.minutos.borrador).toBe(8.5);
    expect(c.minutos.revisar).toBe(2);
    expect(c.horasRevision.map((h) => h.texto)).toEqual(['07:15', '13:00']);
  });
});

describe('valor generado', () => {
  const minutos = { vincular: 2, revisar: 2, borrador: 6, crm: 3, resumen: 10 };
  const eventos = [
    ev('envio_vinculado', 1), ev('envio_vinculado', 2), ev('envio_vinculado', 3),
    ev('hilo_revisado', 1), ev('hilo_revisado', 2),
    ev('borrador_creado', 1, { paso: 1 }), ev('borrador_creado', 2, { paso: 1 }),
    ev('seguimiento_enviado', 1, { paso: 1 }), ev('seguimiento_enviado', 2, { paso: 1 }),
    ev('respuesta', 1, { paso: 1 }), ev('respuesta', 3, { paso: 0 }),
    ev('crm_actualizado', 1), ev('resumen_diario')
  ];
  const cerradas = [
    { id: 1, etapa: 'ganada', monto: 3000, cotizacion_id: 11, created_at: '2026-11-01T12:00:00Z', cerrada_en: '2026-11-11T12:00:00Z', en_seguimiento: true },
    { id: 3, etapa: 'ganada', monto: 500, cotizacion_id: 13, created_at: '2026-11-01T12:00:00Z', cerrada_en: '2026-11-05T12:00:00Z', en_seguimiento: true },
    { id: 4, etapa: 'perdida', monto: 900, cotizacion_id: 14, en_seguimiento: true, motivo_perdida: 'Sin respuesta' },
    { id: 5, etapa: 'ganada', monto: 100, cotizacion_id: 15, en_seguimiento: false }
  ];

  test('tiempo ahorrado, ingreso y margen atribuidos solo a quienes respondieron tras un seguimiento', () => {
    const v = calcularValor({
      desde: '2026-11-01T00:00:00Z', hasta: '2026-12-01T00:00:00Z', eventos, cerradas,
      respuestas: eventos.filter((e) => e.tipo === 'respuesta'), margenes: new Map([[11, 800], [13, 100]]), minutos
    });
    // 3×2 + 2×2 + 2×6 + 1×3 + 1×10
    expect(v.tiempo_ahorrado_min).toBe(35);
    expect(v.ingreso_atribuido).toBe(3000); // la 3 respondió al envío original (paso 0)
    expect(v.margen_atribuido).toBe(800);
    expect(v.respuestas_por_paso).toEqual([
      { paso: 0, enviados: 3, respuestas: 1, tasa: 0.333 },
      { paso: 1, enviados: 2, respuestas: 1, tasa: 0.5 },
      { paso: 2, enviados: 0, respuestas: 0, tasa: null }
    ]);
    expect(v.tasa_cierre).toBe(0.667); // 2 ganadas / 3 cerradas en seguimiento
    expect(v.ciclo_promedio_dias).toBe(7); // (10 + 4) / 2
  });

  test('sin costo el margen es null; sin cerradas, tasas null', () => {
    const v = calcularValor({ desde: 0, hasta: 1, eventos: [], cerradas: [], respuestas: [], minutos });
    expect(v).toMatchObject({ tiempo_ahorrado_min: 0, ingreso_atribuido: 0, margen_atribuido: null, tasa_cierre: null, ciclo_promedio_dias: null });
  });
});

describe('resúmenes', () => {
  const s = (extra) => ({ oportunidad_id: 1, cotizacion_id: 101, empresa_nombre: 'Sonda', numero: 65430, total: 1200, cotizacion_creada_en: cl('2026-11-02 10:00').toISOString(), ...extra });

  test('datos del día: borradores, respuestas recientes, recordatorios, vencimientos de la semana y sin correo', () => {
    const ahora = cl('2026-11-12 08:30'); // jueves
    const d = datosHoy([
      s({ estado: 'borrador_listo', borrador_paso: 1, borrador_creado_en: cl('2026-11-12 08:10').toISOString() }),
      s({ oportunidad_id: 2, estado: 'borrador_listo', borrador_paso: 2, borrador_creado_en: cl('2026-11-09 08:10').toISOString() }),
      s({ oportunidad_id: 3, estado: 'respondida', respuesta_en: cl('2026-11-11 16:00').toISOString(), respuesta_resumen: 'Piden descuento' }),
      s({ oportunidad_id: 4, estado: 'respondida', respuesta_en: cl('2026-11-09 16:00').toISOString() }),
      s({ oportunidad_id: 5, estado: 'esperando', cotizacion_creada_en: cl('2026-10-30 10:00').toISOString() }), // vence 14-nov
      s({ oportunidad_id: 6, estado: 'esperando', cotizacion_creada_en: cl('2026-11-10 10:00').toISOString() }), // vence 25-nov
      s({ oportunidad_id: 7, estado: 'sin_envio' })
    ], ahora, cal);
    expect(d.borradores_listos.map((b) => b.oportunidad_id)).toEqual([1]);
    expect(d.borradores_sin_enviar.map((b) => b.oportunidad_id)).toEqual([2]);
    expect(d.respuestas.map((r) => r.oportunidad_id)).toEqual([3]);
    expect(d.vencen_esta_semana).toEqual([expect.objectContaining({ oportunidad_id: 5, vence_en: '2026-11-14' })]);
    expect(d.sin_correo.map((x) => x.oportunidad_id)).toEqual([7]);
    const texto = textoDiario(d);
    expect(texto).toMatch(/^\*Seguimiento MyQuote · jue 12\*/);
    expect(texto).toContain('*Respuestas (1)*\n• Sonda N°65430: Piden descuento');
    expect(texto).toContain('*Borradores sin enviar hace 2+ días (1)*\n• Sonda N°65430 (3 días)');
    expect(texto).toContain('*Vencen esta semana (1)*\n• Sonda N°65430, sáb 14');
    expect(texto.length).toBeLessThan(600);
  });

  test('listas largas se cortan en 5 líneas', () => {
    const muchos = Array.from({ length: 8 }, (_, i) => s({ oportunidad_id: i + 1, estado: 'sin_envio' }));
    const texto = textoDiario(datosHoy(muchos, cl('2026-11-12 08:30'), cal));
    expect(texto).toContain('• y 3 más');
  });

  test('semanal: tasas por paso, ganadas/perdidas, motivos, mayores abiertas y valor', () => {
    const datos = datosSemana({
      valor: { desde: 'a', hasta: 'b', respuestas_por_paso: [{ paso: 0, enviados: 4, respuestas: 1 }, { paso: 1, enviados: 2, respuestas: 1 }, { paso: 2, enviados: 1, respuestas: 0 }], tiempo_ahorrado_min: 95, ingreso_atribuido: 3000, margen_atribuido: null },
      cerradas: [{ etapa: 'ganada', monto: 3000 }, { etapa: 'perdida', monto: 500, motivo_perdida: 'Sin respuesta' }, { etapa: 'perdida', monto: 100, motivo_perdida: 'Sin respuesta' }],
      abiertas: [{ id: 9, empresa_nombre: 'Entel', etapa: 'negociacion', monto: 12000 }]
    });
    expect(datos.motivos_perdida).toEqual([{ motivo: 'Sin respuesta', cantidad: 2 }]);
    const texto = textoSemanal(datos);
    expect(texto).toContain('Respuestas: envío 1/4 · 1er seg. 1/2 · 2º seg. 0/1');
    expect(texto).toContain('Ganadas: 1');
    expect(texto).toContain('• Entel');
    expect(texto).toContain('1 h 35 min ahorrados');
    expect(unaLinea(texto)).not.toMatch(/\n/);
  });
});

describe('WhatsApp con plantilla', () => {
  test('avisarPlantilla manda un mensaje de tipo template a cada número', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true }));
    const wa = crearWhatsApp({
      config: leerConfigWhatsApp({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's', WHATSAPP_NUMEROS: '56911111111' }),
      gestor: {},
      fetchImpl,
      logger: { error: () => {} }
    });
    expect(await wa.avisarPlantilla({ nombre: 'resumen_myquote', idioma: 'es', parametros: ['hola'] })).toBe(true);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      to: '56911111111',
      type: 'template',
      template: { name: 'resumen_myquote', language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'hola' }] }] }
    });
    expect(await wa.avisar('texto libre')).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({ type: 'text', text: { body: 'texto libre' } });
  });
});
