import {
  aplicarCambio,
  buscarEnCatalogo,
  cambiosDeLinea,
  costoFinal,
  costoXCL,
  gpDe,
  lineaAPayload,
  lineaDesdeItem,
  lineaDesdeProducto,
  margenDe,
  MODO_COSTO,
  resumenLineas
} from './editorCalc';
import { calcularPrecioCliente } from '../cotizadorHelpers';

describe('editorCalc', () => {
  test('el precio de una linea nueva QNAP es el mismo que calcula el cotizador', () => {
    const linea = lineaDesdeProducto({ id: 1, origen: 'QNAP', precio: 1000, marca: 'QNAP', sku: 'X', mpn: 'TS-1', desc: 'NAS' }, { gpPct: 15 });
    expect(linea.precio_unitario).toBeCloseTo(calcularPrecioCliente(1000, 0.15), 2);
    expect(gpDe(linea)).toBeCloseTo(15, 1);
  });

  test('una linea nueva AXIS descuenta el rebate de su categoria de partner', () => {
    const producto = { id: 2, origen: 'AXIS', precio: 1000, rebate_partner_gold: 60, rebate_partner_autorizado: 10, desc: 'Camara' };
    const linea = lineaDesdeProducto(producto, { gpPct: 13, partnerCategory: 'Partner Gold' });
    expect(linea.rebate_partner).toBe(60);
    expect(linea.costo_unitario).toBeCloseTo(costoXCL('AXIS', 1000) - 60, 2);
  });

  test('AXIS antigua sin rebate guardado: se infiere desde el costo y se marca', () => {
    const costo = Math.round((costoXCL('AXIS', 500) - 25) * 100) / 100;
    const linea = lineaDesdeItem({ id: 9, origen: 'AXIS', precio_disty: 500, costo_unitario: costo, precio_unitario: 700, cantidad: 1 });
    expect(linea.rebate_partner).toBeCloseTo(25, 1);
    expect(linea.rebate_inferido).toBe(true);
    // Guardar sin tocar nada no cambia el costo.
    expect(lineaAPayload(linea, 0).costo_unitario).toBe(costo);
  });

  test('cambiar el costo en modo "mantener precio" deja el precio y mueve el margen', () => {
    const linea = lineaDesdeItem({ id: 1, origen: 'QNAP', precio_disty: 1000, costo_unitario: 1200, precio_unitario: 1500, cantidad: 2 });
    const next = aplicarCambio(linea, 'precio_disty', 1100, MODO_COSTO.MANTENER_PRECIO);
    expect(next.precio_unitario).toBe(1500);
    expect(next.costo_unitario).toBeCloseTo(costoFinal({ origen: 'QNAP', precio_disty: 1100 }), 2);
    expect(margenDe(next).unitario).toBeLessThan(margenDe(linea).unitario);
  });

  test('cambiar el costo en modo "mantener margen" recalcula el precio con el mismo GP', () => {
    const linea = lineaDesdeItem({ id: 1, origen: 'QNAP', precio_disty: 1000, costo_unitario: 1200, precio_unitario: 1500, cantidad: 1 });
    const next = aplicarCambio(linea, 'precio_disty', 1100, MODO_COSTO.MANTENER_MARGEN);
    expect(gpDe(next)).toBeCloseTo(gpDe(linea), 1);
    expect(next.precio_unitario).toBeGreaterThan(1500);
  });

  test('reaplicar el mismo disty no toca una linea guardada (ni un centavo)', () => {
    const linea = lineaDesdeItem({ id: 1, origen: 'QNAP', precio_disty: 90, costo_unitario: 107.25, precio_unitario: 126.18, cantidad: 1 });
    expect(aplicarCambio(linea, 'precio_disty', 90, MODO_COSTO.MANTENER_MARGEN)).toBe(linea);
  });

  test('editar el GP fija el precio; editar el precio mueve el GP', () => {
    const linea = lineaDesdeItem({ id: 1, costo_unitario: 800, precio_unitario: 1000, cantidad: 1 });
    expect(aplicarCambio(linea, 'gp', 20).precio_unitario).toBe(1000);
    expect(aplicarCambio(linea, 'gp', 50).precio_unitario).toBe(1600);
    expect(gpDe(aplicarCambio(linea, 'precio_unitario', 900))).toBeCloseTo(11.11, 1);
  });

  test('una linea sin costo no inventa margen', () => {
    const linea = lineaDesdeItem({ id: 1, precio_unitario: 1000, cantidad: 1, costo_unitario: null });
    expect(margenDe(linea)).toEqual({ unitario: null, total: null, pct: null });
    expect(aplicarCambio(linea, 'gp', 30).precio_unitario).toBe(1000);
    const r = resumenLineas([linea]);
    expect(r.sin_costo).toBe(1);
    expect(r.margen_pct).toBeNull();
  });

  test('resumen: venta, costo, margen y lineas con margen negativo', () => {
    const a = lineaDesdeItem({ id: 1, costo_unitario: 800, precio_unitario: 1000, cantidad: 2 });
    const b = lineaDesdeItem({ id: 2, costo_unitario: 600, precio_unitario: 500, cantidad: 1 });
    expect(resumenLineas([a, b])).toMatchObject({ venta: 2500, costo: 2200, margen: 300, margen_pct: 12, negativas: 1 });
  });

  test('detecta que cambio en cada linea', () => {
    const linea = lineaDesdeItem({ id: 1, costo_unitario: 800, precio_unitario: 1000, cantidad: 2 });
    expect(cambiosDeLinea(linea).campos).toEqual([]);
    expect(cambiosDeLinea(aplicarCambio(linea, 'cantidad', 3)).campos).toEqual(['cantidad']);
  });

  test('busqueda del catalogo prioriza MPN exacto sobre texto', () => {
    const productos = [
      { id: 1, mpn: 'TS-h1090FU', sku: 'x', desc: 'NAS without rail (RAIL-B02)' },
      { id: 2, mpn: 'RAIL-B02', sku: 'AC997QNA09', desc: 'Rail kit' }
    ];
    expect(buscarEnCatalogo(productos, 'rail-b02').map((p) => p.id)).toEqual([2, 1]);
  });
});
