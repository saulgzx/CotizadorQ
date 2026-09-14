import { pareceLista, parsearLista, resolverLista } from './listaPegada';

const productos = [
  { id: 1, sku: 'NW001QNA07', mpn: 'TS-435XeU-4G-US', desc: 'NAS' },
  { id: 2, sku: 'AC997QNA09', mpn: 'RAIL-B02', desc: 'Rail' },
  { id: 3, sku: 'AC997QNA15', mpn: 'RAIL-B03', desc: 'Rail 3' },
  { id: 4, sku: '100010879', mpn: '02747-001', desc: 'Axis rail' },
  { id: 5, sku: 'To Create', mpn: 'RAIL-S01', desc: 'Rail S01' }
];

describe('lista pegada', () => {
  test('columnas de Excel: codigo y cantidad separados por tab, con encabezado', () => {
    const r = resolverLista(productos, parsearLista('SKU\tCantidad\nRAIL-B02\t3\nts-435xeu-4g-us\t1'));
    expect(r.resueltas.map((x) => [x.producto.id, x.cantidad])).toEqual([[2, 3], [1, 1]]);
    expect(r.noEncontradas).toEqual([]);
  });

  test('formatos de correo: "2 x CODIGO", "CODIGO; 4" y sin cantidad', () => {
    const r = resolverLista(productos, parsearLista('2 x RAIL-B02\n02747-001; 4\nRAIL S01'));
    expect(r.resueltas.map((x) => [x.producto.id, x.cantidad])).toEqual([[2, 2], [4, 4], [5, 1]]);
  });

  test('un SKU numerico se toma como codigo y no como cantidad', () => {
    const r = resolverLista(productos, parsearLista('100010879 5'));
    expect(r.resueltas).toEqual([{ producto: productos[3], cantidad: 5 }]);
  });

  test('el mismo producto repetido suma cantidades', () => {
    const r = resolverLista(productos, parsearLista('RAIL-B02 1\nAC997QNA09 2'));
    expect(r.resueltas).toEqual([{ producto: productos[1], cantidad: 3 }]);
  });

  test('un codigo incompleto con varios candidatos queda ambiguo, no se adivina', () => {
    const r = resolverLista(productos, parsearLista('RAIL-B 2'));
    expect(r.resueltas).toEqual([]);
    expect(r.ambiguas[0].candidatos.map((p) => p.id)).toEqual([2, 3]);
    expect(r.ambiguas[0].cantidad).toBe(2);
  });

  test('lo que no existe se informa', () => {
    expect(resolverLista(productos, parsearLista('XYZ-999 1')).noEncontradas).toEqual(['XYZ-999 1']);
  });

  test('detecta cuando un pegado es una lista', () => {
    expect(pareceLista('RAIL-B02')).toBe(false);
    expect(pareceLista('RAIL-B02\t2')).toBe(true);
    expect(pareceLista('RAIL-B02\nTS-435')).toBe(true);
  });
});
