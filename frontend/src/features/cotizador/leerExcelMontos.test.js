import * as XLSX from 'xlsx';
import { CANDIDATOS, encontrarEncabezados, leerMontosDeExcel } from './leerExcelMontos';
import { calzarMontos } from './pantallazoMontos';

// Arma un Excel de verdad con SheetJS y lo envuelve en un File falso.
// hojas: { nombreDeHoja: matriz de filas }.
const archivo = (hojas) => {
  const libro = XLSX.utils.book_new();
  for (const [nombre, filas] of Object.entries(hojas)) {
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), nombre);
  }
  const datos = XLSX.write(libro, { type: 'array', bookType: 'xlsx' });
  return { name: 'proyecto.xlsx', arrayBuffer: async () => datos };
};

describe('CANDIDATOS', () => {
  test('tiene los cuatro campos y todos los nombres vienen ya normalizados', () => {
    expect(Object.keys(CANDIDATOS).sort()).toEqual(['descripcion', 'monto', 'mpn', 'sku']);
    for (const lista of Object.values(CANDIDATOS)) {
      for (const nombre of lista) expect(nombre).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/);
    }
  });

  test('cantidad nunca es candidato de monto', () => {
    for (const nombre of ['cantidad', 'qty', 'quantity']) expect(CANDIDATOS.monto).not.toContain(nombre);
  });
});

describe('encontrarEncabezados', () => {
  test('encabezados en la primera fila', () => {
    const r = encontrarEncabezados([['MPN', 'SKU', 'Descripción', 'Precio Unitario'], ['P1475-LE', '02345-001', 'Camara', 320.5]]);
    expect(r.indiceFila).toBe(0);
    expect(r.columnas).toEqual({ sku: 'SKU', mpn: 'MPN', descripcion: 'Descripción', monto: 'Precio Unitario' });
    expect(r.indices).toEqual({ sku: 1, mpn: 0, descripcion: 2, monto: 3 });
    expect(r.falta).toBeNull();
  });

  test('normaliza mayusculas, tildes, puntuacion y espacios', () => {
    for (const precio of ['Precio Unit.', 'PRECIO UNITARIO', '  precio   unitario ', 'Precio\nUnitario', 'Precio (USD)']) {
      const r = encontrarEncabezados([['Código', 'DESCRIPCIÓN', precio]]);
      expect(r.indiceFila).toBe(0);
      expect(r.indices).toEqual({ sku: 0, mpn: -1, descripcion: 1, monto: 2 });
    }
  });

  test('el candidato mas largo decide: "Part Number" es mpn aunque contenga "part" de sku', () => {
    const r = encontrarEncabezados([['Axis Part Number', 'Item Description', 'Net Price']]);
    expect(r.columnas).toEqual({ sku: null, mpn: 'Axis Part Number', descripcion: 'Item Description', monto: 'Net Price' });
  });

  test('contiene por palabra completa: "Pnl" no es pn ni "Codificacion" es cod', () => {
    const r = encontrarEncabezados([['Pnl', 'Codificacion', 'Precio']]);
    expect(r.indiceFila).toBe(-1);
    expect(r.falta).toBe('producto');
  });

  test('"Codigo de producto" es sku y "Precio producto" es monto, no descripcion', () => {
    const r = encontrarEncabezados([['Código de producto', 'Precio producto']]);
    expect(r.columnas).toEqual({ sku: 'Código de producto', mpn: null, descripcion: null, monto: 'Precio producto' });
  });

  test('precio de lista pierde contra el precio neto, este donde este', () => {
    const r = encontrarEncabezados([['Part Number', 'List Price', 'Discount', 'Net Price']]);
    expect(r.columnas.monto).toBe('Net Price');
    const r2 = encontrarEncabezados([['Part Number', 'Project Price', 'List Price']]);
    expect(r2.columnas.monto).toBe('Project Price');
  });

  test('no mira mas alla de las primeras 30 filas', () => {
    const relleno = Array.from({ length: 30 }, () => ['nada']);
    expect(encontrarEncabezados([...relleno, ['SKU', 'Precio']]).indiceFila).toBe(-1);
    expect(encontrarEncabezados([...relleno.slice(1), ['SKU', 'Precio']]).indiceFila).toBe(29);
  });

  test('solo descripcion y precio tambien sirve, pero prefiere una fila con codigo', () => {
    expect(encontrarEncabezados([['Producto', 'Precio']]).indices).toEqual({ sku: -1, mpn: -1, descripcion: 0, monto: 1 });
    expect(encontrarEncabezados([['Producto', 'Precio'], ['SKU', 'Precio']]).indiceFila).toBe(1);
  });

  test('entrada vacia o rara no revienta', () => {
    for (const entrada of [undefined, null, [], [null, undefined, 'x', [null, 5]]]) {
      const r = encontrarEncabezados(entrada);
      expect(r.indiceFila).toBe(-1);
      expect(r.falta).toBe('encabezados');
    }
  });
});

describe('leerMontosDeExcel', () => {
  test('hoja simple con MPN / SKU / Descripcion / Precio Unitario', async () => {
    const r = await leerMontosDeExcel(archivo({
      Proyecto: [
        ['MPN', 'SKU', 'Descripción', 'Precio Unitario'],
        ['P1475-LE', '02345-001', ' AXIS P1475-LE ', 320.5],
        ['M3086-V', '01234-001', 'AXIS M3086-V Mini Dome', 199]
      ]
    }));
    expect(r).toEqual({
      filas: [
        { sku: '02345-001', mpn: 'P1475-LE', descripcion: 'AXIS P1475-LE', monto: 320.5 },
        { sku: '01234-001', mpn: 'M3086-V', descripcion: 'AXIS M3086-V Mini Dome', monto: 199 }
      ],
      columnas: { sku: 'SKU', mpn: 'MPN', descripcion: 'Descripción', monto: 'Precio Unitario' },
      hoja: 'Proyecto',
      filasVacias: 0,
      montoEsTotal: false
    });
  });

  test('las filas salen en el formato que consume calzarMontos', async () => {
    const { filas } = await leerMontosDeExcel(archivo({
      Proyecto: [['MPN', 'Precio'], ['p1475-le', 320.5], ['M3086-V', '1.234,56']]
    }));
    const lineas = [
      { sku: '02345-001', mpn: 'P1475-LE', desc: 'AXIS P1475-LE' },
      { sku: '01234-001', mpn: 'M3086-V', desc: 'AXIS M3086-V' }
    ];
    const calce = calzarMontos({ filas, lineas });
    expect(calce.sinCalce).toEqual([]);
    expect(calce.sinMonto).toEqual([]);
  });

  test('encabezados en la fila 5, con titulo y filas en blanco encima', async () => {
    const r = await leerMontosDeExcel(archivo({
      Export: [
        ['Axis Project Registration'],
        ['Proyecto:', 'Hospital Regional'],
        [],
        [null, null, null],
        ['SKU', 'MPN', 'Descripción', 'Precio'],
        ['02345-001', 'P1475-LE', 'AXIS P1475-LE', 320.5]
      ]
    }));
    expect(r.filas).toEqual([{ sku: '02345-001', mpn: 'P1475-LE', descripcion: 'AXIS P1475-LE', monto: 320.5 }]);
    expect(r.filasVacias).toBe(0);
  });

  test('encabezados en ingles', async () => {
    const r = await leerMontosDeExcel(archivo({
      Sheet1: [['Part Number', 'Description', 'Unit Price'], ['P1475-LE', 'AXIS P1475-LE', 320.5]]
    }));
    expect(r.columnas).toEqual({ sku: null, mpn: 'Part Number', descripcion: 'Description', monto: 'Unit Price' });
    expect(r.filas).toEqual([{ sku: '', mpn: 'P1475-LE', descripcion: 'AXIS P1475-LE', monto: 320.5 }]);
  });

  test('la columna Cantidad no se toma como monto', async () => {
    for (const cantidad of ['Cantidad', 'Qty', 'Quantity', 'Cant.']) {
      const r = await leerMontosDeExcel(archivo({
        Proyecto: [['MPN', cantidad, 'Precio'], ['P1475-LE', 4, 320.5]]
      }));
      expect(r.columnas.monto).toBe('Precio');
      expect(r.filas[0].monto).toBe(320.5);
    }
  });

  test('con Precio Unitario y Precio Total juntos se toma el unitario, en cualquier orden', async () => {
    const a = await leerMontosDeExcel(archivo({
      P: [['MPN', 'Cantidad', 'Precio Unitario', 'Precio Total'], ['P1475-LE', 4, 320.5, 1282]]
    }));
    expect(a.columnas.monto).toBe('Precio Unitario');
    expect(a.filas[0].monto).toBe(320.5);
    expect(a.montoEsTotal).toBe(false);

    const b = await leerMontosDeExcel(archivo({
      P: [['MPN', 'Total', 'Cantidad', 'Precio'], ['P1475-LE', 1282, 4, 320.5]]
    }));
    expect(b.columnas.monto).toBe('Precio');
    expect(b.filas[0].monto).toBe(320.5);
  });

  test('si solo hay Total se toma igual y queda indicado', async () => {
    const r = await leerMontosDeExcel(archivo({
      P: [['MPN', 'Cantidad', 'Total'], ['P1475-LE', 4, 1282]]
    }));
    expect(r.columnas.monto).toBe('Total');
    expect(r.montoEsTotal).toBe(true);
    expect(r.filas).toEqual([{ sku: '', mpn: 'P1475-LE', descripcion: '', monto: 1282 }]);
  });

  test('SKU numerico largo vuelve como string sin notacion cientifica', async () => {
    const r = await leerMontosDeExcel(archivo({
      P: [
        ['SKU', 'Precio'],
        [100015418, 10],
        [1.0001e8, 20],
        [123456789012345, 30],
        [1e21, 40],
        [5506.5, 50]
      ]
    }));
    expect(r.filas.map((f) => f.sku)).toEqual(['100015418', '100010000', '123456789012345', '1000000000000000000000', '5506.5']);
    for (const fila of r.filas) expect(typeof fila.sku).toBe('string');
  });

  test('el monto vuelve tal cual: el numero como numero y el texto como texto', async () => {
    const r = await leerMontosDeExcel(archivo({
      P: [['MPN', 'Precio'], ['A', 1234.5678], ['B', 'US$ 1.234,56'], ['C', 0], ['D', 'N/A']]
    }));
    expect(r.filas.map((f) => f.monto)).toEqual([1234.5678, 'US$ 1.234,56', 0, 'N/A']);
  });

  test('filas en blanco, sin producto o sin monto se descartan y se cuentan', async () => {
    const r = await leerMontosDeExcel(archivo({
      P: [
        ['MPN', 'Descripción', 'Precio'],
        ['P1475-LE', 'AXIS P1475-LE', 320.5],
        [],
        ['M3086-V', 'Sin precio', null],
        ['T91B47', 'Precio en blanco', '   '],
        [null, null, 999],
        ['Q6355', 'AXIS Q6355', 2100]
      ]
    }));
    expect(r.filas.map((f) => f.mpn)).toEqual(['P1475-LE', 'Q6355']);
    expect(r.filasVacias).toBe(4);
  });

  test('sin columna de precio: error que nombra la hoja y los encabezados leidos', async () => {
    const promesa = leerMontosDeExcel(archivo({
      Proyecto: [['Detalle del proyecto'], ['MPN', 'SKU', 'Descripción', 'Cantidad'], ['P1475-LE', '02345-001', 'Camara', 4]]
    }));
    await expect(promesa).rejects.toThrow(
      'No encontré una columna de precio en la hoja "Proyecto". Encabezados leídos: MPN, SKU, Descripción, Cantidad.'
    );
  });

  test('sin columna de producto: error claro', async () => {
    const promesa = leerMontosDeExcel(archivo({
      Proyecto: [['Fecha', 'Cantidad', 'Precio Unitario'], ['2026-11-13', 4, 320.5]]
    }));
    await expect(promesa).rejects.toThrow(
      'No encontré una columna de producto en la hoja "Proyecto". Encabezados leídos: Fecha, Cantidad, Precio Unitario.'
    );
  });

  test('hoja sin nada parecido a una tabla: error claro', async () => {
    await expect(leerMontosDeExcel(archivo({ Portada: [['Hola'], ['mundo']] }))).rejects.toThrow(
      'No encontré los encabezados en la hoja "Portada"'
    );
  });

  test('varias hojas: si la primera no sirve devuelve la segunda', async () => {
    const r = await leerMontosDeExcel(archivo({
      Portada: [['Axis Communications'], ['Proyecto aprobado']],
      Detalle: [['MPN', 'Precio'], ['P1475-LE', 320.5]]
    }));
    expect(r.hoja).toBe('Detalle');
    expect(r.filas).toEqual([{ sku: '', mpn: 'P1475-LE', descripcion: '', monto: 320.5 }]);
  });

  test('varias hojas y ninguna sirve: el error habla de la que mas cerca estuvo', async () => {
    const promesa = leerMontosDeExcel(archivo({
      Portada: [['Axis Communications']],
      Detalle: [['MPN', 'Cantidad'], ['P1475-LE', 4]]
    }));
    await expect(promesa).rejects.toThrow('No encontré una columna de precio en la hoja "Detalle". Encabezados leídos: MPN, Cantidad.');
  });

  test('sin archivo: error claro', async () => {
    await expect(leerMontosDeExcel(null)).rejects.toThrow('No hay archivo Excel para leer.');
  });
});
