const { leerGp, leerNivel, calcularPrecioProducto } = require('../src/services/preciosPartner');

// Caso real del cotizador web: AXIS P1475-LE, costo Chile real 684.79,
// rebate Autorizado 38.95 -> costo 645.84 -> precio 759.81 con GP 15%.
const p1475 = {
  id: 1,
  origen: 'AXIS',
  sku: 'ES006AXS92',
  mpn: '03181-001',
  descripcion: 'AXIS P1475-LE',
  precio_disty: 600,
  rebate_partner_autorizado: 38.95,
  rebate_partner_silver: 50,
  rebate_partner_gold: 70,
  rebate_partner_multiregional: 90
};

describe('preciosPartner', () => {
  test('leerGp acepta decimal o porcentaje y rechaza invalidos', () => {
    expect(leerGp(0.12)).toBe(0.12);
    expect(leerGp('12')).toBe(0.12);
    expect(leerGp(0)).toBe(0);
    expect(leerGp(100)).toBeNull();
    expect(leerGp('abc')).toBeNull();
    expect(leerGp(undefined)).toBeNull();
  });

  test('leerNivel normaliza nombres', () => {
    expect(leerNivel('gold')).toBe('Partner Gold');
    expect(leerNivel('Partner Multiregional')).toBe('Partner Multiregional');
    expect(leerNivel('')).toBeNull();
    expect(leerNivel('platino')).toBeUndefined();
  });

  test('reproduce el precio del cotizador web (Autorizado, GP 15%)', () => {
    const r = calcularPrecioProducto({ producto: p1475, costoReal: 684.79, gp: 0.15, nivel: 'Partner Autorizado' });
    expect(r.costo_base_fuente).toBe('stock_chile_real');
    expect(r.niveles).toHaveLength(1);
    expect(r.niveles[0]).toMatchObject({ costo_unitario: 645.84, precio_unitario: 759.81, margen_unitario: 113.97 });
  });

  test('sin nivel calcula los 4 niveles y respeta cantidad', () => {
    const r = calcularPrecioProducto({ producto: p1475, costoReal: 684.79, gp: 0.12, cantidad: 2 });
    expect(r.niveles.map((n) => n.nivel)).toEqual([
      'Partner Autorizado',
      'Partner Silver',
      'Partner Gold',
      'Partner Multiregional'
    ]);
    const gold = r.niveles.find((n) => n.nivel === 'Partner Gold');
    expect(gold.costo_unitario).toBe(614.79);
    expect(gold.precio_unitario).toBe(698.63);
    expect(gold.precio_total).toBe(1397.26);
  });

  test('sin costo real usa el costo calculado desde el disty', () => {
    const r = calcularPrecioProducto({ producto: p1475, costoReal: null, gp: 0.15, nivel: 'Partner Autorizado' });
    expect(r.costo_base_fuente).toBe('calculado_desde_disty');
    // 600 * 1.015 / 0.97 * 1.12 = 703.18
    expect(r.costo_base).toBe(703.18);
  });

  test('QNAP no aplica niveles de partner', () => {
    const r = calcularPrecioProducto({ producto: { id: 2, origen: 'QNAP', precio_disty: 500 }, gp: 0.15 });
    expect(r.niveles).toBeUndefined();
    expect(r.precio_unitario).toBeGreaterThan(r.costo_unitario);
  });
});
