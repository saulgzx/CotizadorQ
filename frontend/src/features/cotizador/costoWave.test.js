import { costosWave, origenDeCadena, redondear2, tablaWave } from './costoWave';
import { totalDeLinea, totalDelCarrito, unitarioGuardado } from './totalesCarrito';
import { calcularPrecioCliente } from './cotizadorHelpers';
import { AXIS_CONSTANTS, CONSTANTS } from './cotizadorConstants';

describe('costosWave', () => {
  test('QNAP: XUS = disty x 1,011 y XUS + IC = eso / 0,95', () => {
    expect(costosWave({ origen: 'QNAP', precio: 1000 })).toEqual({ disty: 1000, costoXus: 1011, costoXusIc: 1064.21, flete: 1.011, ic: 0.95, origen: 'QNAP' });
  });

  test('AXIS: XUS = disty x 1,015 y XUS + IC = eso / 0,97', () => {
    expect(costosWave({ origen: 'AXIS', precio: 1000 })).toMatchObject({ costoXus: 1015, costoXusIc: 1046.39, flete: 1.015, ic: 0.97 });
  });

  test('son los pasos intermedios de la cadena: seguir con el arancel y el margen da el precio del cotizador', () => {
    for (const [origen, c] of [['QNAP', CONSTANTS], ['AXIS', AXIS_CONSTANTS]]) {
      for (const disty of [12.34, 95, 433.21, 1040, 15999.99]) {
        const xusIc = (disty * c.INBOUND_FREIGHT) / c.IC;
        expect(costosWave({ origen, precio: disty }).costoXusIc).toBe(redondear2(xusIc));
        expect(calcularPrecioCliente(disty, 0.15, c)).toBeCloseTo((xusIc * (1 + c.INT)) / 0.85, 8);
      }
    }
  });

  test('rebates, costo real de stock, margen y cantidad no cambian estos costos', () => {
    const base = costosWave({ origen: 'AXIS', precio: 500 });
    expect(costosWave({ origen: 'AXIS', precio: 500, costoChile: 480, rebateProject: 30, rebate_partner_gold: 40, gpOverride: 0.05, cant: 9 })).toEqual(base);
  });

  test('sin origen o con uno desconocido usa la cadena de QNAP, como el carrito', () => {
    expect(origenDeCadena(undefined)).toBe('QNAP');
    expect(origenDeCadena('otro')).toBe('QNAP');
    expect(origenDeCadena(' axis ')).toBe('AXIS');
    expect(costosWave({ precio: 1000 }).costoXusIc).toBe(1064.21);
  });

  test('fabricantes de quote: sin flete ni IC son el mismo costo; Velasea lleva solo el flete', () => {
    expect(costosWave({ origen: 'ISS', precio: 100 })).toMatchObject({ costoXus: 100, costoXusIc: 100 });
    expect(costosWave({ origen: 'MILESTONE_HW', precio: 100 })).toMatchObject({ costoXus: 100, costoXusIc: 100 });
    expect(costosWave({ origen: 'VELASEA', precio: 100 })).toMatchObject({ costoXus: 101.1, costoXusIc: 101.1 });
  });

  test('sin precio disty no inventa nada', () => {
    for (const precio of [0, null, undefined, '', -5, 'abc', NaN]) expect(costosWave({ origen: 'QNAP', precio })).toBeNull();
    expect(costosWave(null)).toBeNull();
    // Un precio en texto numérico sí vale (así llega a veces del catálogo).
    expect(costosWave({ origen: 'QNAP', precio: '1000' }).costoXus).toBe(1011);
  });
});

describe('tablaWave', () => {
  test('una fila por línea, con tabuladores y punto decimal, lista para pegar en Excel', () => {
    const tabla = tablaWave([
      { marca: 'QNAP', sku: 'NW001', mpn: 'TS-464', desc: 'NAS 4\tbahías\nrack', cant: 2, origen: 'QNAP', precio: 1000 },
      { marca: 'AXIS', sku: '', mpn: 'P1475-LE', desc: 'Cámara', cant: 1, origen: 'AXIS', precio: 0, costoChile: 300 }
    ]).split('\n');
    expect(tabla[0]).toBe('Marca\tSKU\tMPN\tDescripción\tCantidad\tPrecio disty\tCosto XUS\tCosto XUS + IC');
    expect(tabla[1]).toBe('QNAP\tNW001\tTS-464\tNAS 4 bahías rack\t2\t1000.00\t1011.00\t1064.21');
    expect(tabla[2]).toBe('AXIS\t\tP1475-LE\tCámara\t1\t\t\t');
    expect(tablaWave(undefined).split('\n')).toHaveLength(1);
  });
});

describe('totales del carrito como los guarda el servidor', () => {
  test('el unitario se redondea antes de multiplicar', () => {
    expect(unitarioGuardado(70.11269349845202)).toBe(70.11);
    expect(totalDeLinea(70.11269349845202, 2)).toBe(140.22); // sin redondear antes daría 140,23
    expect(totalDeLinea(133.2118, 3)).toBe(399.63);
    expect(totalDeLinea(1401.4449, 7)).toBe(9810.08);
    expect(totalDeLinea(125, 3)).toBe(375);
  });

  test('cantidad inválida cuenta como 1 y un precio inválido como 0', () => {
    expect(totalDeLinea(10.005, 0)).toBe(10.01);
    expect(totalDeLinea(10, '3')).toBe(30);
    expect(totalDeLinea('x', 3)).toBe(0);
    expect(totalDeLinea(-4, 3)).toBe(0);
  });

  test('el total es la suma de las líneas, sin errores de coma flotante', () => {
    expect(totalDelCarrito([
      { precio: 70.11269349845202, cantidad: 2 },
      { precio: 133.2118, cantidad: 3 },
      { precio: 1401.4449, cantidad: 7 }
    ])).toBe(10349.93);
    expect(totalDelCarrito([{ precio: 0.1, cantidad: 1 }, { precio: 0.2, cantidad: 1 }])).toBe(0.3);
    expect(totalDelCarrito([])).toBe(0);
    expect(totalDelCarrito(null)).toBe(0);
  });
});
