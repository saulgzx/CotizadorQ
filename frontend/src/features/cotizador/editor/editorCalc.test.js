import {
  aplicarCambio,
  buscarEnCatalogo,
  cambiosDeLinea,
  costoFinal,
  costoXCL,
  gpDe,
  inferirOrigen,
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

  test('con costo Chile real de stock (OH Unit USD), la linea nueva lo usa en vez del calculado', () => {
    const qnap = lineaDesdeProducto({ id: 5, origen: 'QNAP', precio: 90, costoChile: 107.5, desc: 'Rail' }, { gpPct: 20 });
    expect(qnap.costo_unitario).toBe(107.5);
    expect(qnap.precio_unitario).toBeCloseTo(134.38, 2);
    // AXIS: el rebate se descuenta del costo real.
    const axis = lineaDesdeProducto({ id: 6, origen: 'AXIS', precio: 400, costoChile: 480, rebate_partner_autorizado: 30, desc: 'Cam' }, { gpPct: 13 });
    expect(axis.costo_unitario).toBe(450);
    // Editar el disty a mano vuelve al costo calculado.
    const editada = aplicarCambio(qnap, 'precio_disty', 100);
    expect(editada.costo_xcl_real).toBeNull();
    expect(editada.costo_unitario).toBeCloseTo(costoXCL('QNAP', 100), 2);
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

describe('editorCalc: líneas de quote (ISS, Neural Labs, Milestone)', () => {
  test('inferirOrigen respeta los seis orígenes sin importar mayúsculas ni espacios', () => {
    for (const origen of ['AXIS', 'QNAP', 'ISS', 'NEURAL', 'MILESTONE', 'MILESTONE_HW']) {
      expect(inferirOrigen({ origen })).toBe(origen);
      expect(inferirOrigen({ origen: origen.toLowerCase() })).toBe(origen);
    }
    expect(inferirOrigen({ origen: ' milestone_hw ' })).toBe('MILESTONE_HW');
    expect(inferirOrigen({ origen: ' Mile stone ' })).toBe('MILESTONE');
    // aunque el texto diga "axis", manda el origen
    expect(inferirOrigen({ origen: 'ISS', descripcion: 'Licencia para cámaras Axis' })).toBe('ISS');
  });

  test('inferirOrigen sin origen conocido deduce AXIS/QNAP del texto, como el backend', () => {
    expect(inferirOrigen({ origen: '', marca: 'AXIS' })).toBe('AXIS');
    expect(inferirOrigen({ origen: 'OTRO', descripcion: 'Cámara Axis' })).toBe('AXIS');
    expect(inferirOrigen({ origen: null, mpn: 'TS-464' })).toBe('QNAP');
    expect(inferirOrigen({})).toBe('QNAP');
  });

  test('costoXCL usa la cadena de cada origen', () => {
    expect(costoXCL('ISS', 100)).toBeCloseTo(115, 6);
    expect(costoXCL('NEURAL', 100)).toBeCloseTo(115, 6);
    expect(costoXCL('MILESTONE', 100)).toBeCloseTo(100, 6);
    expect(costoXCL('MILESTONE_HW', 100)).toBeCloseTo(112, 6);
    // AXIS y QNAP no cambian
    expect(costoXCL('QNAP', 1000)).toBeCloseTo(((1000 * 1.011) / 0.95) * 1.12, 6);
    expect(costoXCL('AXIS', 1000)).toBeCloseTo(((1000 * 1.015) / 0.97) * 1.12, 6);
  });

  test('costoXCL con un origen desconocido cae a QNAP (el backend lanzaría un error)', () => {
    expect(costoXCL('OTRO', 1000)).toBeCloseTo(costoXCL('QNAP', 1000), 6);
    expect(costoXCL(undefined, 1000)).toBeCloseTo(costoXCL('QNAP', 1000), 6);
  });

  test('abrir y guardar una cotización con líneas de quote no cambia su origen ni su costo', () => {
    const items = [
      { id: 1, origen: 'ISS', marca: 'ISS', sku: 'To Create', mpn: 'A', precio_disty: 100, costo_unitario: 115, precio_unitario: 125, cantidad: 3 },
      { id: 2, origen: 'MILESTONE_HW', marca: 'Milestone', sku: 'To Create', mpn: 'B', precio_disty: 100, costo_unitario: 112, precio_unitario: 121.74, cantidad: 1 },
      { id: 3, origen: 'MILESTONE', marca: 'Milestone', sku: 'To Create', mpn: 'C', precio_disty: 100, costo_unitario: 100, precio_unitario: 108.7, cantidad: 1 }
    ];
    const lineas = items.map(lineaDesdeItem);
    expect(lineas.map((l) => l.origen)).toEqual(['ISS', 'MILESTONE_HW', 'MILESTONE']);
    // sin rebates ni categoría de partner: son solo de AXIS
    for (const l of lineas) {
      expect(l.rebate_partner).toBeNull();
      expect(l.rebate_proyecto).toBeNull();
      expect(l.rebate_inferido).toBe(false);
    }
    const payloads = lineas.map((l, i) => lineaAPayload(l, i));
    expect(payloads.map((p) => p.origen)).toEqual(['ISS', 'MILESTONE_HW', 'MILESTONE']);
    expect(payloads.map((p) => p.costo_unitario)).toEqual([115, 112, 100]);
    expect(payloads.map((p) => p.precio_disty)).toEqual([100, 100, 100]);
    expect(payloads.every((p) => p.partner_category === null && p.rebate_partner === null)).toBe(true);
  });

  test('editar el costo del quote de una línea recalcula con la cadena de su origen', () => {
    const linea = lineaDesdeItem({ id: 1, origen: 'ISS', precio_disty: 100, costo_unitario: 115, precio_unitario: 125, cantidad: 1 });
    const editada = aplicarCambio(linea, 'precio_disty', 200, MODO_COSTO.MANTENER_PRECIO);
    expect(editada.costo_unitario).toBe(230); // 200 x 1,15, no la cadena de QNAP
    const servidor = lineaDesdeItem({ id: 2, origen: 'MILESTONE_HW', precio_disty: 100, costo_unitario: 112, precio_unitario: 125, cantidad: 1 });
    expect(aplicarCambio(servidor, 'precio_disty', 200).costo_unitario).toBe(224);
  });

  test('Velasea en el editor: cadena de QNAP sin IC y margen por defecto de 15 %', () => {
    expect(inferirOrigen({ origen: ' velasea ' })).toBe('VELASEA');
    expect(costoXCL('VELASEA', 100)).toBeCloseTo(113.232, 10);
    expect(costoXCL('VELASEA', 100)).toBeCloseTo(costoXCL('QNAP', 100) * 0.95, 10);
    const linea = lineaDesdeProducto({ id: 'quote:VELASEA:X#1', origen: 'VELASEA', precio: 100, costoChile: 113.23, desc: 'Servidor' });
    expect(linea.origen).toBe('VELASEA');
    expect(linea.rebate_partner).toBeNull();
    expect(linea.precio_unitario).toBeCloseTo(133.21, 2);
    expect(gpDe(linea)).toBeCloseTo(15, 1);
  });

  test('la línea nueva de un producto de origen quote parte del 8 % por defecto', () => {
    const producto = { id: 'quote:ISS:X#1', origen: 'ISS', precio: 100, costoChile: 115, desc: 'Licencia' };
    const linea = lineaDesdeProducto(producto);
    expect(linea.origen).toBe('ISS');
    expect(linea.rebate_partner).toBeNull();
    expect(linea.precio_unitario).toBeCloseTo(125, 2);
    expect(gpDe(linea)).toBeCloseTo(8, 1);
  });

  test('un producto del catálogo sin margen indicado sigue partiendo del 15 %', () => {
    const linea = lineaDesdeProducto({ id: 1, origen: 'QNAP', precio: 1000, desc: 'NAS' });
    expect(gpDe(linea)).toBeCloseTo(15, 1);
    const axis = lineaDesdeProducto({ id: 2, origen: 'AXIS', precio: 1000, desc: 'Cam' });
    expect(gpDe(axis)).toBeCloseTo(15, 1);
  });
});

