import { gpBaseDeOrigen, gpDeLinea } from './gpLinea';
import { GP_QUOTE_POR_DEFECTO } from './quoteFabricante';

const globales = { gpQnap: 0.15, gpAxis: 0.13 };

describe('gpBaseDeOrigen', () => {
  test('AXIS usa el margen global de AXIS y QNAP el de QNAP', () => {
    expect(gpBaseDeOrigen('AXIS', globales)).toBe(0.13);
    expect(gpBaseDeOrigen('QNAP', globales)).toBe(0.15);
  });

  test('sin origen o con un origen desconocido cae al margen de QNAP, como siempre', () => {
    expect(gpBaseDeOrigen(undefined, globales)).toBe(0.15);
    expect(gpBaseDeOrigen('', globales)).toBe(0.15);
    expect(gpBaseDeOrigen('OTRA', globales)).toBe(0.15);
  });

  test('los cuatro orígenes de quote usan 8 % sin importar los márgenes globales', () => {
    expect(GP_QUOTE_POR_DEFECTO).toBe(0.08);
    for (const origen of ['ISS', 'NEURAL', 'VAIDIO', 'MILESTONE', 'MILESTONE_HW']) {
      expect(gpBaseDeOrigen(origen, globales)).toBe(0.08);
      expect(gpBaseDeOrigen(origen, { gpQnap: 0.3, gpAxis: 0.3 })).toBe(0.08);
    }
  });

  test('Velasea es "igual que QNAP": usa el margen global de QNAP, no el 8 %', () => {
    expect(gpBaseDeOrigen('VELASEA', globales)).toBe(globales.gpQnap);
    expect(gpBaseDeOrigen(' velasea ', { gpQnap: 0.2, gpAxis: 0.3 })).toBe(0.2);
    expect(gpDeLinea({ origen: 'VELASEA', gpOverride: null }, { gpQnap: 0.2, gpAxis: 0.3 })).toBe(0.2);
    expect(gpDeLinea({ origen: 'VELASEA', gpOverride: 0.1 }, { gpQnap: 0.2, gpAxis: 0.3 })).toBe(0.1);
  });

  test('no distingue mayúsculas ni espacios en el origen', () => {
    expect(gpBaseDeOrigen(' iss ', globales)).toBe(0.08);
    expect(gpBaseDeOrigen('axis', globales)).toBe(0.13);
  });
});

describe('gpDeLinea', () => {
  test('el margen propio de la línea manda sobre el base', () => {
    expect(gpDeLinea({ origen: 'ISS', gpOverride: 0.1 }, globales)).toBe(0.1);
    expect(gpDeLinea({ origen: 'QNAP', gpOverride: 0.2 }, globales)).toBe(0.2);
  });

  test('un margen propio de 0 % es un margen, no "sin margen"', () => {
    expect(gpDeLinea({ origen: 'ISS', gpOverride: 0 }, globales)).toBe(0);
  });

  test('sin margen propio (null o ausente) usa el base del origen', () => {
    expect(gpDeLinea({ origen: 'ISS', gpOverride: null }, globales)).toBe(0.08);
    expect(gpDeLinea({ origen: 'MILESTONE_HW' }, globales)).toBe(0.08);
    expect(gpDeLinea({ origen: 'AXIS', gpOverride: null }, globales)).toBe(0.13);
    expect(gpDeLinea({ origen: 'QNAP' }, globales)).toBe(0.15);
    expect(gpDeLinea({}, globales)).toBe(0.15);
  });
});
