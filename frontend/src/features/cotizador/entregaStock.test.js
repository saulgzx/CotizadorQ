import { esEntregaAutomatica, partesEntrega, textoEntregaLinea } from './entregaStock';

describe('entrega según stock y cantidad', () => {
  const eta = '6 semanas tras OC';
  const inmediata = '4 unidades disponible en entrega inmediata, salvo venta previa';

  test('pedido cubierto por stock: solo entrega inmediata', () => {
    expect(textoEntregaLinea({ disponible: 4, cantidad: 4, etaCatalogo: eta })).toBe(inmediata);
  });

  test('stock parcial: la diferencia sale con el ETA', () => {
    expect(textoEntregaLinea({ disponible: 4, cantidad: 7, etaCatalogo: eta })).toBe(`${inmediata} | diferencia ${eta}`);
    expect(textoEntregaLinea({ disponible: 4, cantidad: 7, etaCatalogo: '' })).toBe(`${inmediata} | diferencia ETA por confirmar`);
  });

  test('sin stock o 0 disponible: plazo del catálogo', () => {
    expect(textoEntregaLinea({ disponible: undefined, cantidad: 2, etaCatalogo: eta })).toBe(eta);
    expect(textoEntregaLinea({ disponible: 0, cantidad: 2, etaCatalogo: eta })).toBe(eta);
  });

  test('partes para las etiquetas de entrega', () => {
    expect(partesEntrega(`${inmediata} | diferencia ${eta}`, 7)).toEqual({ inmediata: 4, pendiente: 3, eta });
    expect(partesEntrega(inmediata, 2)).toEqual({ inmediata: 4, pendiente: 0, eta: null });
    expect(partesEntrega(eta, 2)).toEqual({ texto: eta });
  });

  test('solo se recalcula lo que generó el sistema', () => {
    expect(esEntregaAutomatica(`${inmediata} | diferencia ${eta}`, eta)).toBe(true);
    expect(esEntregaAutomatica(eta, eta)).toBe(true);
    expect(esEntregaAutomatica('', eta)).toBe(true);
    expect(esEntregaAutomatica('Entrega en obra marzo', eta)).toBe(false);
  });
});
