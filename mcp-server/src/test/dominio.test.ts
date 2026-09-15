import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  garantiaDe,
  infoEntrega,
  rankearBusqueda,
  rotulos,
  skuEstado,
  textoEntrega,
  textoGarantia,
  textoStock,
  unidadesDe,
  type LecturaStock,
  type Producto
} from '../dominio.js';

let siguienteId = 1;
const producto = (parcial: Partial<Producto>): Producto => ({
  id: siguienteId++,
  origen: 'QNAP',
  marca: 'QNAP',
  sku: 'NW001QNA00',
  mpn: 'X-US',
  descripcion: '',
  tiempo_entrega: '8 - 10 semanas tras OC',
  precio_cliente: 100,
  ...parcial
});

const vivo = (items: Record<string, number | string> = {}): LecturaStock => ({
  mapa: new Map(Object.entries(items)),
  verificado: true,
  origen: 'vivo',
  leido_en: new Date().toISOString(),
  error: null
});

const sinStock: LecturaStock = {
  mapa: new Map(),
  verificado: false,
  origen: 'ninguno',
  leido_en: null,
  error: 'Login contra CotizadorQ fallo (HTTP 500).'
};

describe('T0.2 · no afirmar un plazo que no se verifico', () => {
  const nas = producto({ mpn: 'TS-435XEU-4G-US' });

  test('sin stock legible, entrega es null y el texto dice «plazo no verificado»', () => {
    const info = infoEntrega(nas, sinStock, 7);
    assert.equal(info.entrega, null);
    assert.equal(info.stock_verificado, false);
    assert.equal(info.entrega_catalogo, '8 - 10 semanas tras OC');
    assert.equal(textoEntrega(info), 'plazo no verificado');
    assert.doesNotMatch(textoEntrega(info), /semanas/);
  });

  test('con snapshot viejo tampoco se afirma plazo, aunque traiga unidades', () => {
    const snapshot: LecturaStock = { ...vivo({ 'TS-435XEU-4G-US': 12 }), verificado: false, origen: 'snapshot' };
    assert.equal(infoEntrega(nas, snapshot, 7).entrega, null);
  });

  test('stock verificado con unidades: entrega inmediata', () => {
    const info = infoEntrega(nas, vivo({ 'TS-435XEU-4G-US': 3 }), 7);
    assert.match(info.entrega || '', /^3 unidades disponible en entrega inmediata/);
  });

  test('stock parcial: disponible inmediato y la diferencia con el plazo ETA', () => {
    const lectura = vivo({ 'TS-435XEU-4G-US': 4 });
    assert.equal(
      infoEntrega(nas, lectura, 7, 7).entrega,
      '4 unidades disponible en entrega inmediata, salvo venta previa | diferencia 8 - 10 semanas tras OC'
    );
    assert.doesNotMatch(infoEntrega(nas, lectura, 7, 4).entrega || '', /diferencia/);
  });

  test('0 disponible cuenta como sin stock: sin unidades y plazo de catalogo', () => {
    const lectura = vivo({ 'TS-435XEU-4G-US': 0 });
    assert.equal(unidadesDe(lectura, nas), null);
    assert.equal(textoStock(lectura, unidadesDe(lectura, nas)), 'sin unidades');
    assert.equal(infoEntrega(nas, lectura, 7).entrega, '8 - 10 semanas tras OC');
  });

  test('stock verificado sin unidades: el plazo de catalogo pasa a ser el real', () => {
    assert.equal(infoEntrega(nas, vivo({}), 7).entrega, '8 - 10 semanas tras OC');
    assert.equal(infoEntrega(nas, vivo({ 'TS-435XEU-4G-US': 0 }), 7).entrega, '8 - 10 semanas tras OC');
  });
});

describe('T0.3 · el snapshot sale con su antiguedad en el texto', () => {
  test('muestra unidades, fecha y «no verificado hoy»', () => {
    const lectura: LecturaStock = {
      mapa: new Map([['TS-435XEU-4G-US', 12]]),
      verificado: false,
      origen: 'snapshot',
      leido_en: '2026-09-12T12:40:00.000Z', // 09:40 en Santiago (UTC-3 en septiembre)
      error: 'HTTP 500'
    };
    const texto = textoStock(lectura, 12, new Date('2026-09-14T15:00:00Z'));
    assert.equal(texto, '12 u. al 12-sep 09:40 · no verificado hoy');
  });

  test('sin lectura previa dice «sin dato», no inventa un cero', () => {
    assert.equal(textoStock(sinStock, null), 'sin dato');
  });
});

describe('T1.1 · estado del SKU', () => {
  const r5 = producto({ sku: 'To Create', mpn: 'TS-h1277AXU-RP-R5-16G-US' });
  const r7 = producto({ sku: 'NW001QNA61', mpn: 'TS-h1277AXU-RP-R7-32G-US' });

  test('rotula las dos variantes', () => {
    assert.equal(skuEstado(r5), 'por_crear');
    assert.equal(skuEstado(r7), 'activo');
  });

  test('el R5 suma los dias de creacion al plazo; el R7 no', () => {
    const conStock = vivo({});
    assert.equal(
      infoEntrega(r5, conStock, 7).entrega,
      '8 - 10 semanas tras OC + 7 dias de creacion de SKU'
    );
    assert.equal(infoEntrega(r7, conStock, 7).entrega, '8 - 10 semanas tras OC');
    assert.equal(infoEntrega(r7, conStock, 7).dias_creacion_sku, null);
  });
});

describe('T1.2 · orden por coincidencia y luego por stock', () => {
  // Orden del catalogo real: el B02 venia detras de NAS que lo nombran.
  const catalogo = [
    producto({ sku: 'To Create', mpn: 'TS-h1090FU-7232P-32G-US', descripcion: 'NAS Without Rail Kil (RAIL-B02)' }),
    producto({ sku: 'To Create', mpn: 'RAIL-S02' }),
    producto({ sku: 'To Create', mpn: 'RAIL-S01' }),
    producto({ sku: 'AC997QNA15', mpn: 'RAIL-E03' }),
    producto({ sku: 'AC997QNA09', mpn: 'RAIL-B02' }),
    producto({ sku: 'AC997QNA07', mpn: 'RAIL-A02-90' })
  ];
  const stock = vivo({ 'RAIL-B02': 8 });

  test('buscar "RAIL" pone el B02 primero y el S01 abajo rotulado EOL', () => {
    const r = rankearBusqueda(catalogo, 'RAIL', stock);
    assert.equal(r[0].producto.mpn, 'RAIL-B02');
    const s01 = r.findIndex((x) => x.producto.mpn === 'RAIL-S01');
    const ultimoRail = r.map((x) => x.grupo).lastIndexOf('mpn_prefijo');
    assert.equal(s01, ultimoRail, 'el EOL cierra su grupo');
    assert.equal(rotulos(r[s01]), 'EOL · por crear');
  });

  test('nada se filtra: el NAS que nombra el riel sigue apareciendo, al final', () => {
    const r = rankearBusqueda(catalogo, 'RAIL', stock);
    assert.equal(r.length, catalogo.length);
    assert.equal(r.at(-1)?.grupo, 'texto');
  });

  test('MPN exacto gana aunque este escrito con otro formato', () => {
    const r = rankearBusqueda(catalogo, 'rail b02', stock);
    assert.equal(r[0].grupo, 'mpn_exacto');
    assert.equal(r[0].producto.mpn, 'RAIL-B02');
  });
});

describe('T1.3 · garantia sin inferencia', () => {
  test('modelos validados devuelven su numero', () => {
    assert.equal(garantiaDe(producto({ mpn: 'TS-873A-8G-US' })).garantia_anios, 3);
    assert.equal(garantiaDe(producto({ mpn: 'TS-h1277AXU-RP-R7-32G-US' })).garantia_anios, 5);
  });

  test('el vecino de familia NO hereda: el R5 queda «sin validar»', () => {
    const r5 = garantiaDe(producto({ mpn: 'TS-h1277AXU-RP-R5-16G-US' }));
    assert.equal(r5.garantia_anios, null);
    assert.equal(r5.garantia_estado, 'sin_validar');
    assert.equal(textoGarantia(r5), 'sin validar');
  });

  test('una variante de RAM del mismo chasis tampoco hereda', () => {
    assert.equal(garantiaDe(producto({ mpn: 'TS-873A-4G-US' })).garantia_anios, null);
    assert.equal(garantiaDe(producto({ mpn: 'TS-873AU-RP-8G-US' })).garantia_anios, null);
  });
});
