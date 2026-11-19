const reglas = require('../src/crm/reglas');
const { AHORA } = require('../src/crm/repositorio');

describe('reglas de etapa de una oportunidad', () => {
  const abierta = { etapa: 'cotizada', motivo_perdida: null, cerrada_en: null };

  test('cambiar de etapa actualiza etapa_desde; a una etapa abierta deja cerrada_en en null', () => {
    expect(reglas.cambiosOportunidad(abierta, { etapa: 'negociacion' })).toEqual({
      etapa: 'negociacion', etapa_desde: AHORA, cerrada_en: null, motivo_perdida: null
    });
  });

  test('pasar a ganada fija cerrada_en', () => {
    expect(reglas.cambiosOportunidad(abierta, { etapa: 'ganada' })).toMatchObject({ etapa: 'ganada', etapa_desde: AHORA, cerrada_en: AHORA });
  });

  test('pasar a perdida exige motivo_perdida (400)', () => {
    for (const body of [{ etapa: 'perdida' }, { etapa: 'perdida', motivo_perdida: '   ' }, { etapa: 'perdida', motivo_perdida: null }]) {
      expect(() => reglas.cambiosOportunidad(abierta, body)).toThrow(reglas.MENSAJE_MOTIVO);
      try {
        reglas.cambiosOportunidad(abierta, body);
      } catch (error) {
        expect(error.status).toBe(400);
      }
    }
    expect(reglas.cambiosOportunidad(abierta, { etapa: 'perdida', motivo_perdida: ' Precio ' })).toMatchObject({
      etapa: 'perdida', motivo_perdida: 'Precio', cerrada_en: AHORA
    });
  });

  test('volver de perdida a una etapa abierta limpia cerrada_en y el motivo', () => {
    const perdida = { etapa: 'perdida', motivo_perdida: 'Precio', cerrada_en: new Date() };
    expect(reglas.cambiosOportunidad(perdida, { etapa: 'cotizada' })).toMatchObject({ cerrada_en: null, motivo_perdida: null });
  });

  test('misma etapa: no toca etapa_desde ni cerrada_en; el motivo solo se edita si sigue perdida', () => {
    expect(reglas.cambiosOportunidad(abierta, { etapa: 'cotizada', titulo: 'Nuevo' })).toEqual({ titulo: 'Nuevo' });
    expect(reglas.cambiosOportunidad(abierta, { motivo_perdida: 'x' })).toEqual({});
    const perdida = { etapa: 'perdida', motivo_perdida: 'Precio' };
    expect(reglas.cambiosOportunidad(perdida, { motivo_perdida: 'Plazo' })).toEqual({ motivo_perdida: 'Plazo' });
    expect(() => reglas.cambiosOportunidad(perdida, { motivo_perdida: '' })).toThrow(reglas.MENSAJE_MOTIVO);
  });

  test('campos simples pasan tal cual, incluido null para borrar', () => {
    expect(reglas.cambiosOportunidad(abierta, { monto_manual: null, contacto_id: 3, es_proyecto: true, fecha_cierre_estimada: '2026-12-01' })).toEqual({
      monto_manual: null, contacto_id: 3, es_proyecto: true, fecha_cierre_estimada: '2026-12-01'
    });
  });

  test('oportunidad nueva: etapa por defecto "nueva"; cerrada o perdida siguen las mismas reglas', () => {
    expect(reglas.datosOportunidadNueva({ empresa_id: 1, titulo: 'X' })).toEqual({ empresa_id: 1, titulo: 'X', etapa: 'nueva' });
    expect(reglas.datosOportunidadNueva({ empresa_id: 1, titulo: 'X', etapa: 'ganada' })).toMatchObject({ cerrada_en: AHORA });
    expect(() => reglas.datosOportunidadNueva({ empresa_id: 1, titulo: 'X', etapa: 'perdida' })).toThrow(reglas.MENSAJE_MOTIVO);
  });
});

describe('embudo y resumen', () => {
  test('sin oportunidades: las 5 etapas presentes, en orden, en cero', () => {
    expect(reglas.armarEmbudo([])).toEqual({
      etapas: ['nueva', 'cotizada', 'negociacion', 'ganada', 'perdida'].map((etapa) => ({ etapa, cantidad: 0, monto: 0 })),
      abiertas: { cantidad: 0, monto: 0 },
      ganadas_mes: { cantidad: 0, monto: 0 },
      perdidas_mes: { cantidad: 0, monto: 0 }
    });
  });

  test('suma las abiertas (nueva + cotizada + negociacion) y separa el mes', () => {
    const embudo = reglas.armarEmbudo([
      { tipo: 'etapa', clave: 'cotizada', cantidad: 3, monto: 100.1 },
      { tipo: 'etapa', clave: 'negociacion', cantidad: 1, monto: 0.2 },
      { tipo: 'etapa', clave: 'ganada', cantidad: 5, monto: 900 },
      { tipo: 'mes', clave: 'ganada', cantidad: 2, monto: 300 }
    ]);
    expect(embudo.etapas.map((e) => e.etapa)).toEqual(['nueva', 'cotizada', 'negociacion', 'ganada', 'perdida']);
    expect(embudo.abiertas).toEqual({ cantidad: 4, monto: 100.3 });
    expect(embudo.ganadas_mes).toEqual({ cantidad: 2, monto: 300 });
    expect(embudo.perdidas_mes).toEqual({ cantidad: 0, monto: 0 });
  });

  test('resumenEmpresa: tasa_cierre = ganadas / (ganadas + perdidas), null sin cerradas', () => {
    const ops = [{ etapa: 'ganada', monto: 100 }, { etapa: 'ganada', monto: 50.5 }, { etapa: 'perdida', monto: 10 }, { etapa: 'cotizada', monto: 1 }];
    expect(reglas.resumenEmpresa(ops, { cotizaciones: 4, monto_cotizado: 161.5 })).toEqual({
      cotizaciones: 4, monto_cotizado: 161.5, ganadas: 2, perdidas: 1, monto_ganado: 150.5, tasa_cierre: 0.6667
    });
    expect(reglas.resumenEmpresa([{ etapa: 'nueva', monto: 0 }], { cotizaciones: 0, monto_cotizado: 0 }).tasa_cierre).toBeNull();
  });
});

describe('regla de cierre del seguimiento (cambiosOportunidad / datosOportunidadNueva)', () => {
  const abierta = { etapa: 'cotizada', motivo_perdida: null, cerrada_en: null };
  const cerrada = { etapa: 'ganada', motivo_perdida: null, cerrada_en: new Date() };
  const SIN = { proximo_seguimiento: null, seguimiento_nota: null };

  test('pasar a ganada o perdida limpia el seguimiento, incluso si el cuerpo trae uno', () => {
    expect(reglas.cambiosOportunidad(abierta, { etapa: 'ganada' })).toMatchObject(SIN);
    expect(reglas.cambiosOportunidad(abierta, { etapa: 'perdida', motivo_perdida: 'x' })).toMatchObject(SIN);
    expect(
      reglas.cambiosOportunidad(abierta, { etapa: 'ganada', proximo_seguimiento: '2026-12-01', seguimiento_nota: 'n' })
    ).toMatchObject(SIN);
  });

  test('cambiar entre etapas abiertas no toca el seguimiento; reabrir tampoco lo restaura', () => {
    expect(reglas.cambiosOportunidad(abierta, { etapa: 'negociacion' })).not.toHaveProperty('proximo_seguimiento');
    const reabierta = reglas.cambiosOportunidad(cerrada, { etapa: 'cotizada' });
    expect(reabierta).not.toHaveProperty('proximo_seguimiento');
    expect(reabierta).not.toHaveProperty('seguimiento_nota');
    expect(reglas.cambiosOportunidad(cerrada, { etapa: 'cotizada', proximo_seguimiento: '2027-01-01' })).toMatchObject({
      proximo_seguimiento: '2027-01-01'
    });
  });

  test('en una oportunidad abierta los campos pasan tal cual, null incluido', () => {
    expect(reglas.cambiosOportunidad(abierta, { proximo_seguimiento: '2026-12-01', seguimiento_nota: 'n' })).toEqual({
      proximo_seguimiento: '2026-12-01', seguimiento_nota: 'n'
    });
    expect(reglas.cambiosOportunidad(abierta, SIN)).toEqual(SIN);
  });

  test('fijar seguimiento (no nulo) en una cerrada lanza 400; null se acepta', () => {
    for (const body of [{ proximo_seguimiento: '2026-12-01' }, { seguimiento_nota: 'n' }, { etapa: 'ganada', seguimiento_nota: 'n' }]) {
      expect(() => reglas.cambiosOportunidad(cerrada, body)).toThrow(reglas.MENSAJE_CERRADA_SIN_SEGUIMIENTO);
      try {
        reglas.cambiosOportunidad(cerrada, body);
      } catch (error) {
        expect(error.status).toBe(400);
      }
    }
    expect(reglas.cambiosOportunidad(cerrada, SIN)).toEqual(SIN);
  });

  test('oportunidad nueva cerrada nace sin seguimiento; abierta lo conserva', () => {
    const body = { empresa_id: 1, titulo: 'X', proximo_seguimiento: '2026-12-01', seguimiento_nota: 'n' };
    expect(reglas.datosOportunidadNueva({ ...body, etapa: 'ganada' })).toMatchObject(SIN);
    expect(reglas.datosOportunidadNueva(body)).toMatchObject({ proximo_seguimiento: '2026-12-01', seguimiento_nota: 'n' });
  });
});
