const {
  AXIS_CONSTANTS,
  CADENA_POR_ORIGEN,
  ORIGENES_VALIDOS,
  QNAP_CONSTANTS,
  costoFinal,
  costoXCL,
  normalizarOrigen,
  normalizarLineaAdmin,
  serializarItems,
  resumen,
  vistaCliente
} = require('../src/services/cotizacionItems');

const CAMPOS_INTERNOS = [
  'costo',
  'costo_unitario',
  'margen',
  'margen_unitario',
  'margen_total',
  'margen_pct',
  'rebate',
  'rebate_partner',
  'rebate_proyecto',
  'precio_disty',
  'gp',
  'partner_category'
];

const lineaCompleta = {
  id: 1,
  cotizacion_id: 9,
  producto_id: 3,
  marca: 'Axis',
  sku: '0123',
  mpn: '02747-001',
  descripcion: 'Camara',
  origen: 'AXIS',
  precio_disty: 1000,
  rebate_partner: 50,
  rebate_proyecto: 25,
  partner_category: 'Partner Gold',
  costo_unitario: 1100,
  gp: 0.15,
  cantidad: 2,
  precio_unitario: 1294.12,
  precio_total: 2588.24,
  tiempo_entrega: '8 semanas',
  orden: 0
};

describe('T1.4 · separacion de vistas en la serializacion', () => {
  test('la vista cliente NO contiene costo, margen ni rebate', () => {
    const serializado = vistaCliente(lineaCompleta);
    for (const campo of CAMPOS_INTERNOS) {
      expect(serializado).not.toHaveProperty(campo);
    }
    expect(JSON.stringify(serializado)).not.toMatch(/costo|margen|rebate|disty/i);
    expect(serializado.precio_unitario).toBe(1294.12);
  });

  test('una columna nueva desconocida tampoco llega al cliente', () => {
    const serializado = vistaCliente({ ...lineaCompleta, costo_futuro_secreto: 1 });
    expect(serializado).not.toHaveProperty('costo_futuro_secreto');
  });

  test.each(['client', 'cot_stock_admin', '', undefined])('rol %p recibe solo la vista cliente', (role) => {
    const [item] = serializarItems([lineaCompleta], role);
    for (const campo of CAMPOS_INTERNOS) expect(item).not.toHaveProperty(campo);
    expect(resumen([lineaCompleta], role)).toEqual({ venta: 2588.24 });
  });

  test('solo el admin recibe costo y margen', () => {
    const [item] = serializarItems([lineaCompleta], 'admin');
    expect(item.costo_unitario).toBe(1100);
    expect(item.margen_unitario).toBe(194.12);
    expect(item.margen_total).toBe(388.24);
    expect(item.margen_pct).toBeCloseTo(15, 1);
    expect(resumen([lineaCompleta], 'admin')).toMatchObject({ venta: 2588.24, costo: 2200, margen: 388.24, lineas_sin_costo: 0 });
  });
});

describe('normalizarLineaAdmin', () => {
  test('respeta el costo que manda el editor y deriva gp y totales', () => {
    const linea = normalizarLineaAdmin({ origen: 'QNAP', precio_disty: 500, costo_unitario: 600, precio_unitario: 800, cantidad: 3 });
    expect(linea.costo_unitario).toBe(600);
    expect(linea.gp).toBe(0.25);
    expect(linea.precio_total).toBe(2400);
  });

  test('sin costo, lo calcula desde el gp con que se creo (precio = costo / (1 - gp))', () => {
    const linea = normalizarLineaAdmin({ precio_unitario: 1000, gp: 0.2, cantidad: 1 });
    expect(linea.costo_unitario).toBe(800);
    expect(linea.gp).toBe(0.2);
  });

  test('sin costo ni gp, lo calcula desde el disty con las constantes del cotizador', () => {
    const linea = normalizarLineaAdmin({ origen: 'AXIS', precio_disty: 1000, rebate_partner: 40, precio_unitario: 2000, cantidad: 1 });
    expect(linea.costo_unitario).toBeCloseTo(costoFinal({ origen: 'AXIS', precio_disty: 1000, rebate_partner: 40 }), 2);
  });

  test('una linea antigua sin costo queda sin costo, no con margen inventado', () => {
    const linea = normalizarLineaAdmin({ precio_unitario: 1000, precio_disty: 0, gp: 0, cantidad: 1 });
    expect(linea.costo_unitario).toBeNull();
  });

  test('margen negativo se guarda acotado y la cantidad minima es 1', () => {
    const linea = normalizarLineaAdmin({ costo_unitario: 5000, precio_unitario: 100, cantidad: 0 });
    expect(linea.gp).toBe(-9.9999);
    expect(linea.cantidad).toBe(1);
  });

  test('el rebate solo aplica a AXIS', () => {
    const linea = normalizarLineaAdmin({ origen: 'QNAP', rebate_partner: 99, precio_unitario: 10, cantidad: 1 });
    expect(linea.rebate_partner).toBeNull();
  });
});

describe('origenes y cadena de costo', () => {
  const NUEVOS = ['ISS', 'NEURAL', 'MILESTONE', 'MILESTONE_HW', 'VELASEA'];

  test('la tabla tiene los 7 origenes', () => {
    expect([...ORIGENES_VALIDOS].sort()).toEqual(['AXIS', 'ISS', 'MILESTONE', 'MILESTONE_HW', 'NEURAL', 'QNAP', 'VELASEA']);
    expect(Object.keys(CADENA_POR_ORIGEN)).toEqual(ORIGENES_VALIDOS);
  });

  test.each(ORIGENES_VALIDOS)('normalizarOrigen respeta %s (minusculas y espacios incluidos)', (origen) => {
    expect(normalizarOrigen(origen)).toBe(origen);
    expect(normalizarOrigen(origen.toLowerCase())).toBe(origen);
    expect(normalizarOrigen(`  ${origen.toLowerCase()} `)).toBe(origen);
  });

  test('ISS con descripcion que menciona AXIS sigue siendo ISS', () => {
    expect(normalizarOrigen('ISS', { descripcion: 'integración con cámaras AXIS' })).toBe('ISS');
    expect(normalizarOrigen('milestone_hw', { marca: 'Axis' })).toBe('MILESTONE_HW');
  });

  test.each([undefined, null, '', '  ', 'OTRO'])('origen %p sin texto conserva el fallback QNAP', (origen) => {
    expect(normalizarOrigen(origen, { descripcion: 'NAS 4 bahias' })).toBe('QNAP');
    expect(normalizarOrigen(origen)).toBe('QNAP');
  });

  test.each([undefined, '', 'OTRO'])('origen %p con "axis" en el texto conserva el fallback AXIS', (origen) => {
    expect(normalizarOrigen(origen, { marca: 'Axis', sku: '0123' })).toBe('AXIS');
    expect(normalizarOrigen(origen, { descripcion: 'Camara AXIS P1375' })).toBe('AXIS');
  });

  test('costoXCL de los fabricantes sin lista: costo del quote + transporte y arancel', () => {
    expect(costoXCL('ISS', 100)).toBeCloseTo(115, 10);
    expect(costoXCL('NEURAL', 100)).toBeCloseTo(115, 10);
    expect(costoXCL('MILESTONE', 100)).toBeCloseTo(100, 10);
    expect(costoXCL('MILESTONE_HW', 100)).toBeCloseTo(112, 10);
    // Velasea: como QNAP pero sin dividir por IC -> 100 x 1,011 x 1,12
    expect(costoXCL('VELASEA', 100)).toBeCloseTo(113.232, 10);
    expect(costoXCL('VELASEA', 100)).toBeCloseTo(costoXCL('QNAP', 100) * 0.95, 10);
  });

  test('AXIS y QNAP dan exactamente lo de siempre', () => {
    expect(AXIS_CONSTANTS).toEqual({ INBOUND_FREIGHT: 1.015, IC: 0.97, INT: 0.12 });
    expect(QNAP_CONSTANTS).toEqual({ INBOUND_FREIGHT: 1.011, IC: 0.95, INT: 0.12 });
    expect(costoXCL('AXIS', 1000)).toBe(((1000 * 1.015) / 0.97) * (1 + 0.12));
    expect(costoXCL('QNAP', 1000)).toBe(((1000 * 1.011) / 0.95) * (1 + 0.12));
    expect(costoXCL('AXIS', 1000)).toBeCloseTo(1171.96, 2);
    expect(costoXCL('QNAP', 1000)).toBeCloseTo(1191.92, 2);
  });

  test('costoXCL con un origen fuera de la tabla lanza, no cae a QNAP', () => {
    expect(() => costoXCL('OTRO', 100)).toThrow(/Origen sin cadena/);
    expect(() => costoXCL(undefined, 100)).toThrow(/Origen sin cadena/);
    expect(() => costoXCL('', 100)).toThrow(/Origen sin cadena/);
  });

  test.each([
    ['ISS', 115],
    ['MILESTONE', 100],
    ['MILESTONE_HW', 112]
  ])('linea %s sin producto_id: conserva origen, sin rebates y respeta el costo enviado', (origen, esperado) => {
    const base = {
      origen,
      marca: origen,
      sku: 'LIC-1',
      descripcion: 'Integracion con camaras Axis',
      precio_disty: 100,
      rebate_partner: 30,
      rebate_proyecto: 20,
      partner_category: 'Partner Gold',
      precio_unitario: 200,
      cantidad: 2
    };
    const enviado = normalizarLineaAdmin({ ...base, costo_unitario: 140 });
    expect(enviado).toMatchObject({ origen, producto_id: null, rebate_partner: null, rebate_proyecto: null, partner_category: null });
    expect(enviado.costo_unitario).toBe(140);
    expect(enviado.gp).toBe(0.3);

    // Sin costo ni gp: se calcula con la cadena del origen y el gp se deriva.
    const calculada = normalizarLineaAdmin(base);
    expect(calculada.origen).toBe(origen);
    expect(calculada.costo_unitario).toBe(esperado);
    expect(calculada.rebate_partner).toBeNull();
    expect(calculada.partner_category).toBeNull();
    expect(calculada.gp).toBe(Math.round((1 - esperado / 200) * 10000) / 10000);
  });

  test.each(NUEVOS)('costoFinal de %s ignora rebates', (origen) => {
    expect(costoFinal({ origen, precio_disty: 100, rebate_partner: 0 })).toBe(costoXCL(origen, 100));
  });
});
