import {
  FABRICANTES,
  GP_QUOTE_POR_DEFECTO,
  TIPOS_MILESTONE,
  tipoMilestoneSugerido,
  tipoEsDudoso,
  porcentajeInternacion,
  costoChileQuote,
  precioClienteQuote,
  normalizarLineasQuote,
  productoDeQuote,
  resumenQuote,
  ORIGENES_QUOTE,
  esOrigenQuote,
  origenDeQuote,
  productoDeQuoteGuardado,
  fleteEntradaQuote,
  usaMargenQnap
} from './quoteFabricante';
import { CADENA_POR_ORIGEN } from './cotizadorConstants';
import { productoFueraDeLista } from './fueraDeLista';

describe('configuración', () => {
  test('fabricantes, nombres y margen por defecto', () => {
    expect(Object.keys(FABRICANTES)).toEqual(['ISS', 'NEURAL', 'VAIDIO', 'MILESTONE', 'VELASEA']);
    expect(FABRICANTES.VAIDIO.nombre).toBe('Vaidio');
    expect(FABRICANTES.VELASEA.nombre).toBe('Velasea');
    expect(FABRICANTES.ISS.nombre).toBe('ISS');
    expect(FABRICANTES.NEURAL.nombre).toBe('Neural Labs');
    expect(FABRICANTES.MILESTONE.nombre).toBe('Milestone');
    expect(GP_QUOTE_POR_DEFECTO).toBe(0.08);
    expect(TIPOS_MILESTONE).toEqual(['licencia', 'servidor']);
  });

  test('está congelada', () => {
    expect(Object.isFrozen(FABRICANTES)).toBe(true);
    expect(Object.isFrozen(FABRICANTES.ISS)).toBe(true);
    expect(Object.isFrozen(FABRICANTES.MILESTONE.internacion)).toBe(true);
  });
});

describe('tipoMilestoneSugerido / tipoEsDudoso', () => {
  test.each([
    ['Husky M30 Server', 'servidor'],
    ['Milestone Husky IVO 350R', 'servidor'],
    ['Servidor de grabación', 'servidor'],
    ['NVR appliance 16 canales', 'servidor'],
    ['Workstation para Smart Client', 'servidor'],
    ['Storage 100TB rack', 'servidor'],
    ['Chassis 2U', 'servidor']
  ])('hardware: %s', (descripcion, esperado) => {
    expect(tipoMilestoneSugerido({ descripcion })).toBe(esperado);
  });

  test.each([
    'XProtect Professional+ Base License',
    'Device License x1',
    'Licencia adicional de cámara',
    'Care Plus 3 años',
    'XProtect Management Server License',
    'Suscripción anual'
  ])('licencia: %s', (descripcion) => {
    expect(tipoMilestoneSugerido({ descripcion })).toBe('licencia');
  });

  test('hardware fuerte gana aunque diga license', () => {
    expect(tipoMilestoneSugerido({ descripcion: 'Husky M50 with XProtect license' })).toBe('servidor');
  });

  test('mira también el MPN', () => {
    expect(tipoMilestoneSugerido({ descripcion: '', mpn: 'HUSKY-M10' })).toBe('servidor');
  });

  test('sin tildes ni mayúsculas', () => {
    expect(tipoMilestoneSugerido({ descripcion: 'SERVIDOR DE GRABACIÓN' })).toBe('servidor');
  });

  test('palabras que solo contienen la clave no cuentan (observers, racket)', () => {
    expect(tipoMilestoneSugerido({ descripcion: 'observers racket' })).toBe('licencia');
  });

  test('línea vacía o inválida: licencia y dudosa', () => {
    expect(tipoMilestoneSugerido({})).toBe('licencia');
    expect(tipoMilestoneSugerido(null)).toBe('licencia');
    expect(tipoEsDudoso({})).toBe(true);
  });

  test('dudosa: conflicto o sin señal; no dudosa: señal clara', () => {
    expect(tipoEsDudoso({ descripcion: 'Husky M50 with XProtect license' })).toBe(true);
    expect(tipoEsDudoso({ descripcion: 'XYZ-123' })).toBe(true);
    expect(tipoEsDudoso({ descripcion: 'Device License' })).toBe(false);
    expect(tipoEsDudoso({ descripcion: 'Husky M30' })).toBe(false);
  });
});

describe('porcentajeInternacion', () => {
  test('ISS y Neural: 15% sin importar el tipo', () => {
    expect(porcentajeInternacion('ISS')).toBe(0.15);
    expect(porcentajeInternacion('NEURAL')).toBe(0.15);
    expect(porcentajeInternacion('NEURAL', 'servidor')).toBe(0.15);
  });

  test('Milestone: 0% licencia, 12% servidor', () => {
    expect(porcentajeInternacion('MILESTONE', 'licencia')).toBe(0);
    expect(porcentajeInternacion('MILESTONE', 'servidor')).toBe(0.12);
  });

  test('Milestone sin tipo válido es null, no 0', () => {
    expect(porcentajeInternacion('MILESTONE')).toBeNull();
    expect(porcentajeInternacion('MILESTONE', 'otro')).toBeNull();
  });

  test('fabricante desconocido es null, no 0', () => {
    expect(porcentajeInternacion('AXIS')).toBeNull();
    expect(porcentajeInternacion('')).toBeNull();
    expect(porcentajeInternacion(undefined)).toBeNull();
    expect(porcentajeInternacion('toString')).toBeNull();
  });

  test('tolera mayúsculas y espacios', () => {
    expect(porcentajeInternacion(' iss ')).toBe(0.15);
    expect(porcentajeInternacion('milestone', ' Servidor ')).toBe(0.12);
  });
});

describe('costoChileQuote', () => {
  test('porcentajes exactos: 100 -> 115 / 115 / 100 / 112', () => {
    expect(costoChileQuote(100, 'ISS')).toBe(115);
    expect(costoChileQuote(100, 'NEURAL')).toBe(115);
    expect(costoChileQuote(100, 'MILESTONE', 'licencia')).toBe(100);
    expect(costoChileQuote(100, 'MILESTONE', 'servidor')).toBe(112);
  });

  test('redondea a 2 decimales', () => {
    expect(costoChileQuote(33.33, 'ISS')).toBe(38.33); // 38.3295
    expect(costoChileQuote(10.005, 'MILESTONE', 'licencia')).toBe(10.01);
    expect(costoChileQuote(1.1, 'MILESTONE', 'servidor')).toBe(1.23); // 1.232
  });

  test('acepta número en texto', () => {
    expect(costoChileQuote('200', 'ISS')).toBe(230);
  });

  test.each([0, -5, NaN, null, undefined, '', 'abc', true, Infinity])('costo inválido %p -> null', (c) => {
    expect(costoChileQuote(c, 'ISS')).toBeNull();
  });

  test('fabricante desconocido o Milestone sin tipo -> null', () => {
    expect(costoChileQuote(100, 'AXIS')).toBeNull();
    expect(costoChileQuote(100, 'MILESTONE')).toBeNull();
  });
});

describe('precioClienteQuote', () => {
  test('115 / 0,92 = 125 con 8%', () => {
    expect(precioClienteQuote(115, 0.08)).toBe(125);
  });

  test('igual fórmula y redondeo que precioSistema', () => {
    expect(precioClienteQuote(100, 0.13)).toBe(114.94);
    expect(precioClienteQuote(38.33, 0.08)).toBe(41.66);
  });

  test('gp 0 deja el costo', () => {
    expect(precioClienteQuote(100, 0)).toBe(100);
  });

  test.each([1, 1.5, -0.1, NaN, null, undefined, '', 'x'])('gp inválido %p -> null', (gp) => {
    expect(precioClienteQuote(100, gp)).toBeNull();
  });

  test('costo inválido -> null', () => {
    expect(precioClienteQuote(0, 0.08)).toBeNull();
    expect(precioClienteQuote(null, 0.08)).toBeNull();
    expect(precioClienteQuote(-1, 0.08)).toBeNull();
  });
});

describe('normalizarLineasQuote', () => {
  const fila = (extra = {}) => ({
    mpn: 'ABC-1',
    descripcion: 'Equipo',
    cantidad: 2,
    costo_unitario: '100.00',
    total_linea: '200.00',
    ...extra
  });

  test('línea sana', () => {
    const { lineas, avisos } = normalizarLineasQuote([fila()], { fabricante: 'ISS' });
    expect(lineas).toEqual([
      { mpn: 'ABC-1', descripcion: 'Equipo', cantidad: 2, costoUnitario: 100, totalLinea: 200, tipo: null, problemas: [] }
    ]);
    expect(avisos).toEqual([]);
  });

  test('acepta claves camelCase y parsea montos con formato', () => {
    const { lineas } = normalizarLineasQuote(
      [{ mpn: 'A', cantidad: '3', costoUnitario: '$1,234.50', totalLinea: '3.703,50' }],
      { fabricante: 'ISS' }
    );
    expect(lineas[0]).toMatchObject({ cantidad: 3, costoUnitario: 1234.5, totalLinea: 3703.5, problemas: [] });
  });

  describe('cantidad', () => {
    test.each([[0], [-1], [2.5], [''], [null], ['abc'], [undefined]])('%p -> null y sin-cantidad', (cantidad) => {
      const { lineas } = normalizarLineasQuote([fila({ cantidad, total_linea: null })], { fabricante: 'ISS' });
      expect(lineas[0].cantidad).toBeNull();
      expect(lineas[0].problemas).toContain('sin-cantidad');
    });

    test('texto numérico entero se acepta', () => {
      const { lineas } = normalizarLineasQuote([fila({ cantidad: ' 2 ' })], { fabricante: 'ISS' });
      expect(lineas[0].cantidad).toBe(2);
    });
  });

  test('sin costo: sin-costo y aviso', () => {
    const { lineas, avisos } = normalizarLineasQuote([fila({ costo_unitario: '' })], { fabricante: 'ISS' });
    expect(lineas[0].costoUnitario).toBeNull();
    expect(lineas[0].problemas).toContain('sin-costo');
    expect(avisos.join(' ')).toMatch(/costo unitario/);
  });

  test('costo 0 o negativo cuenta como sin costo', () => {
    const { lineas } = normalizarLineasQuote([fila({ costo_unitario: 0 }), fila({ mpn: 'B', costo_unitario: '-5' })], {
      fabricante: 'ISS'
    });
    expect(lineas.every((l) => l.problemas.includes('sin-costo'))).toBe(true);
  });

  describe('total-no-cuadra', () => {
    test('se marca cuando difiere más del 1%', () => {
      // unitario leído = total (error típico): 200 x 2 = 400 vs 200
      const { lineas, avisos } = normalizarLineasQuote([fila({ costo_unitario: 200 })], { fabricante: 'ISS' });
      expect(lineas[0].problemas).toContain('total-no-cuadra');
      expect(avisos.join(' ')).toMatch(/no cuadra/);
    });

    test('dentro del 1% no se marca', () => {
      const { lineas } = normalizarLineasQuote([fila({ costo_unitario: 100.5, total_linea: 201 })], { fabricante: 'ISS' });
      expect(lineas[0].problemas).toEqual([]);
    });

    test('justo sobre el 1% se marca', () => {
      const { lineas } = normalizarLineasQuote([fila({ costo_unitario: 101.1, total_linea: 200 })], { fabricante: 'ISS' });
      expect(lineas[0].problemas).toContain('total-no-cuadra');
    });

    test('sin total o sin cantidad no se evalúa', () => {
      expect(normalizarLineasQuote([fila({ total_linea: '' })], { fabricante: 'ISS' }).lineas[0].problemas).toEqual([]);
      expect(
        normalizarLineasQuote([fila({ cantidad: '', costo_unitario: 5 })], { fabricante: 'ISS' }).lineas[0].problemas
      ).toEqual(['sin-cantidad']);
    });
  });

  test('sin MPN se conserva con problema sin-mpn', () => {
    const { lineas, avisos } = normalizarLineasQuote([fila({ mpn: '  ' })], { fabricante: 'ISS' });
    expect(lineas).toHaveLength(1);
    expect(lineas[0].mpn).toBe('');
    expect(lineas[0].problemas).toContain('sin-mpn');
    expect(avisos.join(' ')).toMatch(/MPN/);
  });

  test('tipo: sugerido en Milestone, null en el resto', () => {
    const crudas = [fila({ mpn: 'HUSKY-M30', descripcion: 'Husky M30' }), fila({ mpn: 'Y3XPPBL', descripcion: 'Base License' })];
    const mile = normalizarLineasQuote(crudas, { fabricante: 'MILESTONE' }).lineas;
    expect(mile.map((l) => l.tipo)).toEqual(['servidor', 'licencia']);
    expect(normalizarLineasQuote(crudas, { fabricante: 'NEURAL' }).lineas.every((l) => l.tipo === null)).toBe(true);
  });

  test('Milestone con tipo dudoso genera aviso', () => {
    const { avisos } = normalizarLineasQuote([fila({ mpn: 'XYZ', descripcion: '' })], { fabricante: 'MILESTONE' });
    expect(avisos.join(' ')).toMatch(/licencia \(0%\) o servidor \(12%\)/);
  });

  describe('MPN repetido', () => {
    test('mismo costo: suma cantidades y total en una sola línea', () => {
      const { lineas, avisos } = normalizarLineasQuote(
        [fila({ cantidad: 2, total_linea: 200 }), fila({ cantidad: 3, total_linea: 300 })],
        { fabricante: 'ISS' }
      );
      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({ cantidad: 5, costoUnitario: 100, totalLinea: 500, problemas: [] });
      expect(avisos.join(' ')).toMatch(/ABC-1/);
    });

    test('compara el MPN sin distinguir mayúsculas', () => {
      const { lineas } = normalizarLineasQuote([fila({ mpn: 'abc-1' }), fila()], { fabricante: 'ISS' });
      expect(lineas).toHaveLength(1);
      expect(lineas[0].cantidad).toBe(4);
    });

    test('mismo costo con un total faltante: el total queda null', () => {
      const { lineas } = normalizarLineasQuote([fila(), fila({ total_linea: '' })], { fabricante: 'ISS' });
      expect(lineas[0].totalLinea).toBeNull();
    });

    test('costo distinto: separadas y ambas con mpn-repetido', () => {
      const { lineas, avisos } = normalizarLineasQuote(
        [fila({ costo_unitario: 100, total_linea: 200 }), fila({ costo_unitario: 90, total_linea: 180 })],
        { fabricante: 'ISS' }
      );
      expect(lineas).toHaveLength(2);
      expect(lineas.every((l) => l.problemas.includes('mpn-repetido'))).toBe(true);
      expect(avisos.join(' ')).toMatch(/costos distintos/);
    });

    test('tres líneas: dos con igual costo se suman, la distinta queda aparte y todas marcadas', () => {
      const { lineas } = normalizarLineasQuote(
        [fila({ cantidad: 1, total_linea: 100 }), fila({ cantidad: 1, costo_unitario: 90, total_linea: 90 }), fila({ cantidad: 2, total_linea: 200 })],
        { fabricante: 'ISS' }
      );
      expect(lineas).toHaveLength(2);
      expect(lineas.map((l) => l.cantidad)).toEqual([3, 1]);
      expect(lineas.every((l) => l.problemas.includes('mpn-repetido'))).toBe(true);
    });

    test('repetida sin costo no se suma', () => {
      const { lineas } = normalizarLineasQuote([fila({ costo_unitario: '' }), fila({ costo_unitario: '' })], { fabricante: 'ISS' });
      expect(lineas).toHaveLength(2);
      expect(lineas[0].problemas).toContain('mpn-repetido');
    });

    test('las líneas sin MPN nunca se fusionan entre sí', () => {
      const { lineas } = normalizarLineasQuote([fila({ mpn: '' }), fila({ mpn: '' })], { fabricante: 'ISS' });
      expect(lineas).toHaveLength(2);
      expect(lineas.every((l) => !l.problemas.includes('mpn-repetido'))).toBe(true);
    });
  });

  test('descarta no objetos y filas vacías', () => {
    const { lineas } = normalizarLineasQuote(
      [null, 'x', 5, [], undefined, {}, { mpn: '', descripcion: ' ', cantidad: null, costo_unitario: '' }, fila()],
      { fabricante: 'ISS' }
    );
    expect(lineas).toHaveLength(1);
  });

  test('entrada que no es lista: vacío con aviso', () => {
    for (const x of [null, undefined, 'x', {}]) {
      const r = normalizarLineasQuote(x, { fabricante: 'ISS' });
      expect(r.lineas).toEqual([]);
      expect(r.avisos.join(' ')).toMatch(/No se encontraron líneas/);
    }
  });

  test('fabricante desconocido avisa', () => {
    const { avisos } = normalizarLineasQuote([fila()], { fabricante: 'XX' });
    expect(avisos.join(' ')).toMatch(/Fabricante desconocido/);
  });

  test('cuenta las líneas con problemas en un aviso', () => {
    const { avisos } = normalizarLineasQuote([fila({ costo_unitario: '' }), fila({ mpn: 'B' })], { fabricante: 'ISS' });
    expect(avisos[0]).toMatch(/^1 línea tiene problemas/);
  });
});

describe('productoDeQuote', () => {
  const linea = { mpn: 'ABC-1', descripcion: 'Equipo', cantidad: 4, costoUnitario: 100, totalLinea: 400, tipo: null, problemas: [] };

  test('ISS: costo Chile con 15%, margen 8% y datos propios', () => {
    const p = productoDeQuote(linea, { fabricante: 'ISS' });
    expect(p).toMatchObject({
      fueraDeLista: true,
      origen: 'ISS',
      marca: 'ISS',
      sku: 'To Create',
      mpn: 'ABC-1',
      desc: 'Equipo',
      precio: 100,
      gp: 0.08,
      costoChile: 115,
      tiempo: 'ETA por confirmar',
      deQuote: true,
      costoFabricante: 100,
      tipoQuote: null,
      cantidadSugerida: 4
    });
    expect(p.rebate_partner_autorizado).toBe(0);
    expect(p.rebate_partner_silver).toBe(0);
    expect(p.rebate_partner_gold).toBe(0);
    expect(p.rebate_partner_multiregional).toBe(0);
    expect(precioClienteQuote(p.costoChile, p.gp)).toBe(125);
  });

  test('Neural: marca legible y origen NEURAL', () => {
    const p = productoDeQuote(linea, { fabricante: 'NEURAL' });
    expect(p.origen).toBe('NEURAL');
    expect(p.marca).toBe('Neural Labs');
    expect(p.costoChile).toBe(115);
  });

  test('Milestone: usa el tipo pedido, el de la línea o el sugerido', () => {
    expect(productoDeQuote(linea, { fabricante: 'MILESTONE', tipo: 'servidor' })).toMatchObject({ costoChile: 112, tipoQuote: 'servidor' });
    expect(productoDeQuote(linea, { fabricante: 'MILESTONE', tipo: 'licencia' })).toMatchObject({ costoChile: 100, tipoQuote: 'licencia' });
    expect(productoDeQuote({ ...linea, tipo: 'servidor' }, { fabricante: 'MILESTONE' }).costoChile).toBe(112);
    expect(productoDeQuote({ ...linea, descripcion: 'Husky M30' }, { fabricante: 'MILESTONE' }).tipoQuote).toBe('servidor');
  });

  test('Milestone: el servidor se guarda como MILESTONE_HW y la licencia como MILESTONE', () => {
    expect(productoDeQuote(linea, { fabricante: 'MILESTONE', tipo: 'servidor' }).origen).toBe('MILESTONE_HW');
    expect(productoDeQuote(linea, { fabricante: 'MILESTONE', tipo: 'licencia' }).origen).toBe('MILESTONE');
    expect(productoDeQuote(linea, { fabricante: 'MILESTONE', tipo: 'servidor' }).marca).toBe('Milestone');
  });

  test('el costo del fabricante viaja como precio (precio_disty) y el costo Chile aparte', () => {
    const p = productoDeQuote({ ...linea, costoUnitario: 250.5 }, { fabricante: 'NEURAL' });
    expect(p.precio).toBe(250.5);
    expect(p.costoChile).toBe(288.08);
  });

  test('el costo Chile redondea al centavo como una calculadora, sin ruido de coma flotante', () => {
    expect(costoChileQuote(80.5, 'ISS')).toBe(92.58);
    expect(costoChileQuote(1000.5, 'NEURAL')).toBe(1150.58);
    expect(costoChileQuote(0.3, 'MILESTONE', 'servidor')).toBe(0.34);
    // Contra aritmética exacta en centavos, para todos los costos de 0,01 a 500,00.
    for (const [fabricante, tipo, pct] of [['ISS', null, 115], ['MILESTONE', 'servidor', 112], ['MILESTONE', 'licencia', 100]]) {
      for (let centavos = 1; centavos <= 50000; centavos += 1) {
        const exacto = Math.floor((centavos * pct + 50) / 100) / 100;
        if (costoChileQuote(centavos / 100, fabricante, tipo) !== exacto) {
          throw new Error(`${fabricante} ${centavos / 100}: ${costoChileQuote(centavos / 100, fabricante, tipo)} en vez de ${exacto}`);
        }
      }
    }
  });

  test('origenDeQuote y esOrigenQuote', () => {
    expect(origenDeQuote('iss')).toBe('ISS');
    expect(origenDeQuote('MILESTONE', 'Servidor')).toBe('MILESTONE_HW');
    expect(origenDeQuote('MILESTONE', 'licencia')).toBe('MILESTONE');
    expect(origenDeQuote('MILESTONE')).toBe('MILESTONE');
    expect(origenDeQuote('QNAP')).toBeNull();
    expect(ORIGENES_QUOTE).toEqual(['ISS', 'NEURAL', 'VAIDIO', 'MILESTONE', 'MILESTONE_HW', 'VELASEA']);
    expect(esOrigenQuote('milestone_hw')).toBe(true);
    expect(esOrigenQuote('AXIS')).toBe(false);
    expect(esOrigenQuote(null)).toBe(false);
  });

  test('tipo inválido en Milestone -> null (no cae a 0%)', () => {
    expect(productoDeQuote(linea, { fabricante: 'MILESTONE', tipo: 'otro' })).toBeNull();
  });

  test('gp editable y gp inválido vuelve al 8%', () => {
    expect(productoDeQuote(linea, { fabricante: 'ISS', gp: 0.2 }).gp).toBe(0.2);
    expect(productoDeQuote(linea, { fabricante: 'ISS', gp: 1 }).gp).toBe(0.08);
    expect(productoDeQuote(linea, { fabricante: 'ISS', gp: 'x' }).gp).toBe(0.08);
  });

  test('sin costo válido o fabricante desconocido -> null', () => {
    expect(productoDeQuote({ ...linea, costoUnitario: null }, { fabricante: 'ISS' })).toBeNull();
    expect(productoDeQuote({ ...linea, costoUnitario: 0 }, { fabricante: 'ISS' })).toBeNull();
    expect(productoDeQuote(linea, { fabricante: 'AXIS' })).toBeNull();
    expect(productoDeQuote(null, { fabricante: 'ISS' })).toBeNull();
    expect(productoDeQuote(linea)).toBeNull();
  });

  test('cantidadSugerida cae a 1 si no hay cantidad', () => {
    expect(productoDeQuote({ ...linea, cantidad: null }, { fabricante: 'ISS' }).cantidadSugerida).toBe(1);
  });

  test('desc cae al MPN y luego a un texto genérico', () => {
    expect(productoDeQuote({ ...linea, descripcion: '' }, { fabricante: 'ISS' }).desc).toBe('ABC-1');
    expect(productoDeQuote({ ...linea, descripcion: '', mpn: '' }, { fabricante: 'ISS' }).desc).toBe('Línea de quote');
  });

  describe('id', () => {
    test('prefijo propio, no numérico', () => {
      const p = productoDeQuote(linea, { fabricante: 'ISS', indice: 0 });
      expect(p.id).toBe('quote:ISS:ABC-1#0');
      expect(Number.isNaN(Number(p.id))).toBe(true);
    });

    test('único con el mismo MPN y sin MPN, con o sin índice', () => {
      const sinMpn = { ...linea, mpn: '' };
      const ids = [
        productoDeQuote(linea, { fabricante: 'ISS' }).id,
        productoDeQuote(linea, { fabricante: 'ISS' }).id,
        productoDeQuote(sinMpn, { fabricante: 'ISS' }).id,
        productoDeQuote(sinMpn, { fabricante: 'ISS' }).id
      ];
      expect(new Set(ids).size).toBe(4);
      expect(ids[2]).toMatch(/^quote:ISS:SINMPN#/);
    });

    test('con índice es determinista', () => {
      const a = productoDeQuote(linea, { fabricante: 'ISS', indice: 3 }).id;
      expect(productoDeQuote(linea, { fabricante: 'ISS', indice: 3 }).id).toBe(a);
      expect(productoDeQuote(linea, { fabricante: 'ISS', indice: 4 }).id).not.toBe(a);
    });
  });

  test('mismas claves que productoFueraDeLista, más las propias', () => {
    const real = productoFueraDeLista({ mpn: 'P1475-LE', sku: '1', name: 'AXIS', costo_chile: 100, origin: 'AXIS', brand: 'AXIS' });
    const q = productoDeQuote(linea, { fabricante: 'ISS' });
    const propias = ['deQuote', 'costoFabricante', 'tipoQuote', 'cantidadSugerida'];
    expect(Object.keys(q).filter((k) => !propias.includes(k)).sort()).toEqual(Object.keys(real).sort());
    expect(propias.every((k) => k in q)).toBe(true);
    // mismos tipos de valor en las claves compartidas
    for (const k of Object.keys(real)) expect(typeof q[k]).toBe(typeof real[k]);
  });
});

describe('resumenQuote', () => {
  test('USD sin descuento ni notas: sin avisos', () => {
    expect(resumenQuote({ moneda: 'USD', descuentoGlobalPct: null, notas: '' })).toEqual({ avisos: [] });
    expect(resumenQuote({ moneda: 'usd' }).avisos).toEqual([]);
  });

  test('moneda distinta avisa', () => {
    const { avisos } = resumenQuote({ moneda: 'EUR' });
    expect(avisos).toEqual(['El quote viene en EUR: los costos se cargaron sin convertir, revisa.']);
  });

  test('moneda ausente avisa que se asumió USD', () => {
    expect(resumenQuote({}).avisos[0]).toMatch(/no indica la moneda/);
    expect(resumenQuote().avisos).toHaveLength(1);
  });

  test('descuento global avisa que no está aplicado', () => {
    expect(resumenQuote({ moneda: 'USD', descuentoGlobalPct: 10 }).avisos).toEqual([
      'Hay un descuento global de 10% que NO está aplicado a los costos: revisa.'
    ]);
    expect(resumenQuote({ moneda: 'USD', descuentoGlobalPct: '12.5%' }).avisos[0]).toMatch(/12,5%/);
  });

  test('descuento 0, null o basura no avisa', () => {
    for (const d of [0, null, undefined, '', 'n/a']) {
      expect(resumenQuote({ moneda: 'USD', descuentoGlobalPct: d }).avisos).toEqual([]);
    }
  });

  test('notas del lector se muestran', () => {
    expect(resumenQuote({ moneda: 'USD', notas: ' Página 2 ilegible ' }).avisos).toEqual(['Nota del lector: Página 2 ilegible']);
  });

  test('acumula todos', () => {
    expect(resumenQuote({ moneda: 'EUR', descuentoGlobalPct: 5, notas: 'x' }).avisos).toHaveLength(3);
  });
});

describe('productoDeQuoteGuardado', () => {
  const guardada = { origen: 'ISS', mpn: 'SOS-LIC', descripcion: 'Licencia SecurOS', cantidad: 4, precio_disty: 100, sku: 'To Create', gp: 0.08 };

  test('rearma la línea con el costo del fabricante guardado', () => {
    expect(productoDeQuoteGuardado(guardada)).toMatchObject({
      origen: 'ISS', marca: 'ISS', mpn: 'SOS-LIC', desc: 'Licencia SecurOS', sku: 'To Create',
      precio: 100, costoChile: 115, deQuote: true, cantidadSugerida: 4
    });
  });

  test('Milestone: el tipo sale del origen guardado', () => {
    expect(productoDeQuoteGuardado({ ...guardada, origen: 'MILESTONE_HW' })).toMatchObject({ origen: 'MILESTONE_HW', marca: 'Milestone', costoChile: 112, tipoQuote: 'servidor' });
    // Aunque la descripción suene a hardware, una línea guardada como licencia sigue siendo licencia.
    expect(productoDeQuoteGuardado({ ...guardada, origen: 'MILESTONE', descripcion: 'Husky M30' })).toMatchObject({ origen: 'MILESTONE', costoChile: 100, tipoQuote: 'licencia' });
    expect(productoDeQuoteGuardado({ ...guardada, origen: ' neural ' }).origen).toBe('NEURAL');
  });

  test('no inventa: línea que no es de quote o sin costo devuelve null', () => {
    expect(productoDeQuoteGuardado({ ...guardada, origen: 'QNAP' })).toBeNull();
    expect(productoDeQuoteGuardado({ ...guardada, origen: 'AXIS' })).toBeNull();
    expect(productoDeQuoteGuardado({ ...guardada, precio_disty: 0 })).toBeNull();
    expect(productoDeQuoteGuardado({ ...guardada, precio_disty: null })).toBeNull();
    expect(productoDeQuoteGuardado(null)).toBeNull();
  });
});

describe('Velasea: igual que QNAP pero sin IC', () => {
  const linea = { mpn: 'VS-4U-RACK', descripcion: 'Servidor de grabación 4U', cantidad: 2, costoUnitario: 100 };

  test('costo Chile = costo del quote x 1,011 (flete de entrada) x 1,12, sin dividir por IC', () => {
    expect(fleteEntradaQuote('VELASEA')).toBe(1.011);
    expect(porcentajeInternacion('VELASEA')).toBe(0.12);
    expect(costoChileQuote(100, 'VELASEA')).toBe(113.23); // 113,232
    expect(costoChileQuote(1000, 'velasea')).toBe(1132.32);
    // Es exactamente el costo Chile de QNAP sin el factor IC (0,95).
    const qnap = (100 * 1.011) / 0.95 * 1.12;
    expect(costoChileQuote(100, 'VELASEA')).toBe(Math.round(qnap * 0.95 * 100) / 100);
    // Medio centavo exacto: 31,25 x 1,13232 = 35,385 -> 35,39
    expect(costoChileQuote(31.25, 'VELASEA')).toBe(35.39);
  });

  test('los demás fabricantes no llevan flete de entrada', () => {
    for (const f of ['ISS', 'NEURAL', 'VAIDIO', 'MILESTONE']) expect(fleteEntradaQuote(f)).toBe(1);
    expect(fleteEntradaQuote('OTRO')).toBeNull();
  });

  test('usa el margen de QNAP, no el 8 % de los quotes', () => {
    expect(usaMargenQnap('VELASEA')).toBe(true);
    expect(usaMargenQnap(' velasea ')).toBe(true);
    for (const o of ['ISS', 'NEURAL', 'VAIDIO', 'MILESTONE', 'MILESTONE_HW', 'QNAP', 'AXIS', '', null]) expect(usaMargenQnap(o)).toBe(false);
  });

  test('el producto sale con origen VELASEA, SKU por crear y el costo del quote como precio', () => {
    const p = productoDeQuote(linea, { fabricante: 'VELASEA' });
    expect(p).toMatchObject({
      origen: 'VELASEA', marca: 'Velasea', sku: 'To Create', mpn: 'VS-4U-RACK',
      precio: 100, costoChile: 113.23, gp: 0.15, deQuote: true, tipoQuote: null, cantidadSugerida: 2
    });
    expect(precioClienteQuote(p.costoChile, 0.15)).toBe(133.21);
    expect(esOrigenQuote('VELASEA')).toBe(true);
    expect(origenDeQuote('velasea')).toBe('VELASEA');
  });

  test('una línea Velasea guardada se rearma igual (duplicar)', () => {
    expect(productoDeQuoteGuardado({ origen: 'VELASEA', mpn: 'VS-4U-RACK', descripcion: 'Servidor', cantidad: 2, precio_disty: 100 }))
      .toMatchObject({ origen: 'VELASEA', marca: 'Velasea', precio: 100, costoChile: 113.23, cantidadSugerida: 2 });
  });
});

describe('la lógica de quotes y la tabla de cadenas de costo dicen lo mismo', () => {
  test.each([
    ['ISS', undefined, 'ISS'],
    ['NEURAL', undefined, 'NEURAL'],
    ['VAIDIO', undefined, 'VAIDIO'],
    ['MILESTONE', 'licencia', 'MILESTONE'],
    ['MILESTONE', 'servidor', 'MILESTONE_HW'],
    ['VELASEA', undefined, 'VELASEA']
  ])('%s %s -> cadena de %s', (fabricante, tipo, origen) => {
    expect(origenDeQuote(fabricante, tipo)).toBe(origen);
    const c = CADENA_POR_ORIGEN[origen];
    for (const costo of [1, 31.25, 80.5, 100, 999.99, 4300.5, 12345.67]) {
      const porCadena = ((costo * c.INBOUND_FREIGHT) / c.IC) * (1 + c.INT);
      expect(Math.abs(costoChileQuote(costo, fabricante, tipo) - porCadena)).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  test('todo origen de quote tiene su cadena y viceversa (salvo AXIS y QNAP)', () => {
    expect(Object.keys(CADENA_POR_ORIGEN).filter((o) => o !== 'AXIS' && o !== 'QNAP').sort()).toEqual([...ORIGENES_QUOTE].sort());
  });
});

describe('Vaidio: exactamente igual que ISS', () => {
  const linea = { mpn: 'VD-CORE-16', descripcion: 'Vaidio Core 16 canales', cantidad: 3, costoUnitario: 100 };

  test('mismo recargo, mismo costo Chile y mismo margen que ISS para cualquier costo', () => {
    expect(porcentajeInternacion('VAIDIO')).toBe(porcentajeInternacion('ISS'));
    expect(fleteEntradaQuote('VAIDIO')).toBe(1);
    expect(usaMargenQnap('VAIDIO')).toBe(false);
    for (const costo of [0.01, 1, 31.25, 80.5, 100, 999.99, 4300.5, 12345.67]) {
      expect(costoChileQuote(costo, 'VAIDIO')).toBe(costoChileQuote(costo, 'ISS'));
    }
    expect(costoChileQuote(100, 'vaidio')).toBe(115);
  });

  test('el producto solo se diferencia del de ISS en el origen, la marca y el id', () => {
    const vaidio = productoDeQuote(linea, { fabricante: 'VAIDIO', indice: 1 });
    const iss = productoDeQuote(linea, { fabricante: 'ISS', indice: 1 });
    expect(vaidio).toMatchObject({ origen: 'VAIDIO', marca: 'Vaidio', sku: 'To Create', precio: 100, costoChile: 115, gp: 0.08, cantidadSugerida: 3 });
    expect({ ...vaidio, origen: 0, marca: 0, id: 0 }).toEqual({ ...iss, origen: 0, marca: 0, id: 0 });
    expect(precioClienteQuote(vaidio.costoChile, vaidio.gp)).toBe(125);
    expect(esOrigenQuote('vaidio')).toBe(true);
  });

  test('una línea Vaidio guardada se rearma igual (duplicar)', () => {
    expect(productoDeQuoteGuardado({ origen: 'VAIDIO', mpn: 'VD-CORE-16', descripcion: 'Core', cantidad: 3, precio_disty: 100 }))
      .toMatchObject({ origen: 'VAIDIO', marca: 'Vaidio', costoChile: 115, cantidadSugerida: 3 });
  });
});
