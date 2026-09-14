const {
  costoFinal,
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
