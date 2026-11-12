import { beforeEach, describe, expect, test } from 'vitest';
import {
  MARGEN_SISTEMA_DEFAULTS,
  guardarMargenSistema,
  leerMargenSistema,
  precioSistema,
  precioSistemaDe,
  sanearMargenSistema
} from './precioSistema';

describe('precio de sistema del stock', () => {
  beforeEach(() => localStorage.clear());

  test('por defecto: 13% en Axis y 15% en QNAP', () => {
    expect(MARGEN_SISTEMA_DEFAULTS).toEqual({ AXIS: 13, QNAP: 15 });
    expect(leerMargenSistema()).toEqual({ AXIS: 13, QNAP: 15 });
  });

  test('costo / (1 - margen), redondeado a 2 decimales', () => {
    // P1475-LE: costo Chile real 684.79, sin rebate de partner.
    expect(precioSistema(684.79, 13)).toBe(787.11);
    expect(precioSistema(100, 15)).toBe(117.65);
    expect(precioSistema(500, 0)).toBe(500);
  });

  test('sin costo real o con margen invalido no hay precio', () => {
    expect(precioSistema(null, 13)).toBeNull();
    expect(precioSistema(0, 13)).toBeNull();
    expect(precioSistema(undefined, 13)).toBeNull();
    expect(precioSistema(100, 100)).toBeNull();
    expect(precioSistema(100, -1)).toBeNull();
    expect(precioSistema(100, '')).toBeNull();
  });

  test('elige el margen segun el origen de la fila', () => {
    const config = { AXIS: 13, QNAP: 15 };
    expect(precioSistemaDe({ origin: 'AXIS', costo_chile: 684.79 }, config)).toBe(787.11);
    expect(precioSistemaDe({ origin: 'QNAP', costo_chile: 100 }, config)).toBe(117.65);
    expect(precioSistemaDe({ origin: 'QNAP' }, config)).toBeNull();
  });

  test('el margen editado se guarda y se lee de vuelta; valores invalidos vuelven al defecto', () => {
    expect(guardarMargenSistema({ AXIS: 10, QNAP: 18.5 })).toEqual({ AXIS: 10, QNAP: 18.5 });
    expect(leerMargenSistema()).toEqual({ AXIS: 10, QNAP: 18.5 });
    expect(sanearMargenSistema({ AXIS: 'x', QNAP: 120 })).toEqual({ AXIS: 13, QNAP: 15 });
    expect(sanearMargenSistema({ AXIS: 0 })).toEqual({ AXIS: 0, QNAP: 15 });
  });
});
