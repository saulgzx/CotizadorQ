import {
  conteoSeguimiento, cuando, empresasPorPipeline, estancadas, etapasEmbudo, hitosSeguimiento, pipelinePorMarca, tasaCierre
} from './resumen';

const OPS = [
  { id: 1, empresa_id: 1, empresa_nombre: 'Acme', etapa: 'cotizada', monto: 1000, marca: 'AXIS', dias_en_etapa: 12 },
  { id: 2, empresa_id: 1, empresa_nombre: 'Acme', etapa: 'nueva', monto: 500, marca: 'QNAP', dias_en_etapa: 1 },
  { id: 3, empresa_id: 2, empresa_nombre: 'Beta', etapa: 'negociacion', monto: 4000, marca: 'QNAP', dias_en_etapa: 30 },
  { id: 4, empresa_id: 3, empresa_nombre: 'Gama', etapa: 'ganada', monto: 9000, marca: 'AXIS', dias_en_etapa: 40 }
];

describe('panel del CRM', () => {
  test('tasa de cierre: null sin cierres, razón con cierres', () => {
    expect(tasaCierre({ ganadas_mes: { cantidad: 0 }, perdidas_mes: { cantidad: 0 } })).toBeNull();
    expect(tasaCierre({ ganadas_mes: { cantidad: 3 }, perdidas_mes: { cantidad: 1 } })).toBe(0.75);
  });

  test('etapas del embudo: solo abiertas y proporción contra la mayor', () => {
    const filas = etapasEmbudo({ etapas: [{ etapa: 'nueva', cantidad: 1, monto: 500 }, { etapa: 'cotizada', cantidad: 2, monto: 2000 }, { etapa: 'ganada', cantidad: 9, monto: 9000 }] });
    expect(filas.map((f) => f.clave)).toEqual(['nueva', 'cotizada', 'negociacion']);
    expect(filas.map((f) => f.razon)).toEqual([0.25, 1, 0]);
  });

  test('empresas por pipeline: suma abiertas, ignora cerradas y ordena por monto', () => {
    expect(empresasPorPipeline(OPS)).toEqual([
      { empresa_id: 2, nombre: 'Beta', monto: 4000, cantidad: 1, razon: 1 },
      { empresa_id: 1, nombre: 'Acme', monto: 1500, cantidad: 2, razon: 0.375 }
    ]);
  });

  test('estancadas: abiertas con 7+ días, la más antigua primero', () => {
    expect(estancadas(OPS).map((o) => o.id)).toEqual([3, 1]);
  });

  test('pipeline por marca: orden fijo y proporción sobre el total abierto', () => {
    const { total, filas } = pipelinePorMarca(OPS);
    expect(total).toBe(5500);
    expect(filas.map((f) => [f.marca, f.monto])).toEqual([['AXIS', 1000], ['QNAP', 4500], ['MIXTA', 0]]);
  });
});

describe('seguimiento automático', () => {
  test('cuenta por grupo', () => {
    const c = conteoSeguimiento([{ estado: 'esperando' }, { estado: 'buscando_envio' }, { estado: 'borrador_listo' }, { estado: 'sin_envio' }]);
    expect(c).toMatchObject({ curso: 2, borrador: 1, detenida: 1, respondida: 0, cerrada: 0 });
  });

  test('hitos según el paso y el estado', () => {
    expect(hitosSeguimiento({ enviado_en: 'x', paso: 1, estado: 'esperando' }).map((h) => h.hecho)).toEqual([true, true, false, false]);
    expect(hitosSeguimiento({ enviado_en: 'x', paso: 1, estado: 'respondida' })[3]).toMatchObject({ nombre: 'Respondió', hecho: true });
  });

  test('fechas relativas', () => {
    const ahora = new Date(2026, 10, 12, 15);
    expect(cuando(new Date(2026, 10, 12, 8).toISOString(), ahora)).toBe('hoy');
    expect(cuando(new Date(2026, 10, 13, 8).toISOString(), ahora)).toBe('mañana');
    expect(cuando(new Date(2026, 10, 9, 8).toISOString(), ahora)).toBe('hace 3 días');
    expect(cuando(null, ahora)).toBe('');
  });
});
