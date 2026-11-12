import { diffVersiones, emparejarLineas, etiquetaLinea } from './versionDiff';

const item = (extra) => ({ producto_id: 1, sku: 'SKU-1', mpn: 'MPN-1', descripcion: 'Cámara', cantidad: 1, precio_unitario: 100, costo_unitario: 80, precio_total: 100, ...extra });

const version = (items, cotizacion = {}, total) => ({
  total: total ?? items.reduce((s, i) => s + i.precio_total, 0),
  cotizacion: { cliente_nombre: 'Ana', cliente_empresa: 'Sonda', cliente_telefono: 'Proyecto X', ...cotizacion },
  items
});

describe('emparejarLineas', () => {
  test('empareja por producto_id aunque cambie el SKU', () => {
    const { pares, agregadas, quitadas } = emparejarLineas([item()], [item({ sku: 'SKU-NUEVO' })]);
    expect(pares).toHaveLength(1);
    expect(agregadas).toHaveLength(0);
    expect(quitadas).toHaveLength(0);
  });

  test('sin producto_id cae a SKU, luego MPN y luego descripción', () => {
    const antes = [
      item({ producto_id: null, sku: 'A' }),
      item({ producto_id: null, sku: '', mpn: 'M-2' }),
      item({ producto_id: null, sku: '', mpn: '', descripcion: 'Servicio de instalación' })
    ];
    const despues = [
      item({ producto_id: null, sku: 'a ' }),
      item({ producto_id: null, sku: '', mpn: 'm-2' }),
      item({ producto_id: null, sku: '', mpn: '', descripcion: 'servicio de  instalación' })
    ];
    const r = emparejarLineas(antes, despues);
    expect(r.pares).toHaveLength(3);
    expect(r.agregadas).toHaveLength(0);
    expect(r.quitadas).toHaveLength(0);
  });

  test('una línea con producto_id y otra sin él se emparejan por SKU', () => {
    const r = emparejarLineas([item({ producto_id: 7 })], [item({ producto_id: null })]);
    expect(r.pares).toHaveLength(1);
  });

  test('duplicados se emparejan en orden y el sobrante queda como agregado', () => {
    const antes = [item({ cantidad: 1 }), item({ cantidad: 2 })];
    const despues = [item({ cantidad: 1 }), item({ cantidad: 5 }), item({ cantidad: 3 })];
    const r = emparejarLineas(antes, despues);
    expect(r.pares.map((p) => [p.antes.cantidad, p.despues.cantidad])).toEqual([[1, 1], [2, 5]]);
    expect(r.agregadas.map((a) => a.cantidad)).toEqual([3]);
    expect(r.quitadas).toEqual([]);
  });

  test('tolera listas vacías o ausentes', () => {
    expect(emparejarLineas(undefined, undefined)).toEqual({ pares: [], quitadas: [], agregadas: [] });
  });
});

describe('diffVersiones', () => {
  test('detecta líneas agregadas y quitadas, cantidad, precio, costo y total', () => {
    const anterior = version([
      item({ producto_id: 1, sku: 'CAM-1', cantidad: 2, precio_unitario: 100, costo_unitario: 80, precio_total: 200 }),
      item({ producto_id: 2, sku: 'NAS-1', cantidad: 1, precio_unitario: 500, costo_unitario: 400, precio_total: 500 })
    ]);
    const actual = version([
      item({ producto_id: 1, sku: 'CAM-1', cantidad: 3, precio_unitario: 95, costo_unitario: 78, precio_total: 285 }),
      item({ producto_id: 3, sku: 'SW-1', cantidad: 1, precio_unitario: 60, costo_unitario: 40, precio_total: 60 })
    ]);
    const d = diffVersiones(anterior, actual);
    expect(d.agregadas.map((l) => l.etiqueta)).toEqual(['SW-1']);
    expect(d.quitadas.map((l) => l.etiqueta)).toEqual(['NAS-1']);
    expect(d.cantidad).toEqual([{ etiqueta: 'CAM-1', antes: 2, despues: 3 }]);
    expect(d.precio).toEqual([{ etiqueta: 'CAM-1', antes: 100, despues: 95 }]);
    expect(d.costo).toEqual([{ etiqueta: 'CAM-1', antes: 80, despues: 78 }]);
    expect(d.total).toEqual({ antes: 700, despues: 345, diferencia: -355 });
    expect(d.sinCambios).toBe(false);
  });

  test('sin permiso de costo no informa cambios de costo', () => {
    const d = diffVersiones(version([item()]), version([item({ costo_unitario: 50 })]), { conCosto: false });
    expect(d.costo).toEqual([]);
    expect(d.sinCambios).toBe(true);
  });

  test('cambios en los datos del cliente; fechas comparadas por día', () => {
    const anterior = version([item()], { cliente_empresa: 'Sonda', fecha_ejecucion: '2026-01-10T03:00:00.000Z' });
    const actual = version([item()], { cliente_empresa: 'Sonda S.A.', fecha_ejecucion: '2026-01-10' });
    const d = diffVersiones(anterior, actual);
    expect(d.cliente).toEqual([{ campo: 'cliente_empresa', etiqueta: 'Empresa', antes: 'Sonda', despues: 'Sonda S.A.' }]);
  });

  test('versiones idénticas: sin cambios', () => {
    const d = diffVersiones(version([item()]), version([item()]));
    expect(d.sinCambios).toBe(true);
    expect(d.total.diferencia).toBe(0);
  });

  test('sin total explícito lo suma de las líneas', () => {
    const d = diffVersiones({ items: [item({ precio_total: 10 })] }, { items: [item({ precio_total: 25.5 })] });
    expect(d.total).toEqual({ antes: 10, despues: 25.5, diferencia: 15.5 });
  });

  test('ignora diferencias de redondeo en el precio', () => {
    const d = diffVersiones(version([item({ precio_unitario: 100 })]), version([item({ precio_unitario: '100.001' })]));
    expect(d.precio).toEqual([]);
  });
});

test('etiquetaLinea usa SKU, MPN o descripción', () => {
  expect(etiquetaLinea({ sku: 'A' })).toBe('A');
  expect(etiquetaLinea({ mpn: 'B' })).toBe('B');
  expect(etiquetaLinea({ descripcion: 'C' })).toBe('C');
  expect(etiquetaLinea({})).toBe('Línea sin código');
});
