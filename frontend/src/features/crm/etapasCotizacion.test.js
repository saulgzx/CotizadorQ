import { contarPorEtapa, estadoDeEtapa, etapaDeCotizacion, textoConteoArchivo, tonoEtapa } from './etapasCotizacion';

describe('etapaDeCotizacion', () => {
  test('usa la etapa del backend cuando viene', () => {
    expect(etapaDeCotizacion({ etapa: 'negociacion', estado: 'enviada' })).toBe('negociacion');
    expect(etapaDeCotizacion({ etapa: 'Ganada' })).toBe('ganada');
  });

  test('sin etapa la deriva del estado heredado', () => {
    expect(etapaDeCotizacion({ estado: 'revision' })).toBe('nueva');
    expect(etapaDeCotizacion({ estado: 'pendiente' })).toBe('nueva');
    expect(etapaDeCotizacion({ estado: 'enviada' })).toBe('cotizada');
    expect(etapaDeCotizacion({ estado: 'aprobada' })).toBe('ganada');
    expect(etapaDeCotizacion({ estado: 'rechazada' })).toBe('perdida');
    expect(etapaDeCotizacion({})).toBe('nueva');
    expect(etapaDeCotizacion({ etapa: 'rara', estado: 'aprobada' })).toBe('ganada');
  });
});

test('estadoDeEtapa sigue el contrato del backend', () => {
  expect(estadoDeEtapa('ganada')).toBe('aprobada');
  expect(estadoDeEtapa('perdida')).toBe('rechazada');
  expect(estadoDeEtapa('cotizada')).toBe('enviada');
  expect(estadoDeEtapa('negociacion')).toBe('enviada');
  expect(estadoDeEtapa('nueva')).toBe('revision');
});

test('tonoEtapa da un tono por etapa', () => {
  expect(tonoEtapa('ganada')).toBe('ok');
  expect(tonoEtapa('perdida')).toBe('critico');
  expect(tonoEtapa('otra')).toBe('neutro');
});

test('contarPorEtapa incluye todas las etapas', () => {
  expect(contarPorEtapa([{ etapa: 'ganada' }, { estado: 'aprobada' }, { estado: 'enviada' }])).toEqual({
    nueva: 0, cotizada: 1, negociacion: 0, ganada: 2, perdida: 0
  });
});

test('textoConteoArchivo usa singular y plural', () => {
  expect(textoConteoArchivo({ cotizaciones: 1, oportunidades: 0 })).toBe('1 cotización y 0 oportunidades');
  expect(textoConteoArchivo({ cotizaciones: 3, oportunidades: 1 })).toBe('3 cotizaciones y 1 oportunidad');
  expect(textoConteoArchivo(null)).toBe('0 cotizaciones y 0 oportunidades');
});
