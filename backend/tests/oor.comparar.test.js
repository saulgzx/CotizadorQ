const {
  DIAS_A_ETA, parsearFecha, sumarDias, diasEntre, numeroDe, esCerrada, leerOor, huella, comparar, posDe, cruzarConBo
} = require('../src/oor/comparar');

// Cabecera real de la pestaña OOR (las columnas que importan, en su orden).
const CABECERA = ['Order Confirmation', 'Del No', 'Order No', 'Line No', 'Customer PO No', 'Created', 'Order Status', 'Status',
  'Sales Part', 'Sales Part Description', 'Sales Qty', 'Planned Ship Date', 'Planned Delivery Date', 'Days changed',
  'Previous Planned Deliver Date', 'Project Description'];
const fila = ({ orden, linea, po, parte = '02317-004', desc = 'AXIS Q6225-LE', cant = 1, despacho, entrega = '', estado = 'Released', del = 1 }) =>
  ['Confirmed', del, orden, linea, po, '09-04-2026', estado, estado, parte, desc, cant, despacho, entrega, 0, '', ''];
// Copia de la cabecera: hay tests que la modifican.
const hoja = (...filas) => [[...CABECERA], ...filas.map(fila)];

describe('parsearFecha', () => {
  test('texto día-mes-año con guiones, con y sin ceros (como escribe la planilla)', () => {
    expect(parsearFecha('10-12-2026')).toBe('2026-12-10'); // new Date() lo leería como 12 de octubre
    expect(parsearFecha('09-04-2026')).toBe('2026-04-09');
    expect(parsearFecha('5-6-2026')).toBe('2026-06-05');
    expect(parsearFecha('30-4-2026')).toBe('2026-04-30');
    expect(parsearFecha('23-12-2026')).toBe('2026-12-23');
    expect(parsearFecha(' 1-5-2026 ')).toBe('2026-05-01');
    expect(parsearFecha('10.12.2026')).toBe('2026-12-10');
    expect(parsearFecha('10-12-26')).toBe('2026-12-10');
  });

  test('con barras es mes/día, salvo que el número delate lo contrario', () => {
    expect(parsearFecha('11/23/2026')).toBe('2026-11-23');
    expect(parsearFecha('3/4/2026')).toBe('2026-03-04');
    expect(parsearFecha('23/11/2026')).toBe('2026-11-23');
  });

  test('con guiones, un segundo número mayor que 12 delata que el mes va primero', () => {
    expect(parsearFecha('11-23-2026')).toBe('2026-11-23');
  });

  test('fecha real de Sheets (número de serie) e ISO', () => {
    expect(parsearFecha(46366)).toBe('2026-12-10');
    expect(parsearFecha(46366.75)).toBe('2026-12-10');
    expect(parsearFecha('2026-12-10')).toBe('2026-12-10');
    expect(parsearFecha('2026-12-10T08:30:00Z')).toBe('2026-12-10');
    expect(parsearFecha('2026-1-5')).toBe('2026-01-05');
  });

  test('lo que no es fecha devuelve null, nunca una fecha inventada', () => {
    for (const v of ['', null, undefined, 'TBD', 'N/A', '31-02-2026', '2026-02-30', '00-01-2026', '13-13-2026', 12, 0, 'abc', '10-12']) {
      expect(parsearFecha(v)).toBeNull();
    }
  });
});

describe('utilidades', () => {
  test('sumarDias y diasEntre cruzan meses y años', () => {
    expect(sumarDias('2026-12-23', DIAS_A_ETA)).toBe('2027-01-07');
    expect(sumarDias(null, 5)).toBeNull();
    expect(diasEntre('2026-01-15', '2026-06-10')).toBe(146);
    expect(diasEntre('2026-06-10', '2026-01-15')).toBe(-146);
    expect(diasEntre(null, '2026-01-15')).toBeNull();
  });

  test('numeroDe entiende coma decimal y punto de miles', () => {
    expect(numeroDe('3311,2')).toBe(3311.2);
    expect(numeroDe('1.796,35')).toBe(1796.35);
    expect(numeroDe(60)).toBe(60);
    expect(numeroDe('60')).toBe(60);
    expect(numeroDe('')).toBeNull();
    expect(numeroDe('x')).toBeNull();
  });

  test('esCerrada y posDe', () => {
    expect(esCerrada('Invoiced/Closed')).toBe(true);
    expect(esCerrada('Cancelled')).toBe(true);
    expect(esCerrada('Released')).toBe(false);
    expect(esCerrada('Partially Delivered')).toBe(false);
    expect(posDe('575740')).toEqual(['575740']);
    expect(posDe(' 575740 / 577655, 577655 ')).toEqual(['575740', '577655']);
    expect(posDe(null)).toEqual([]);
  });
});

describe('leerOor', () => {
  test('lee las líneas con su identidad, PO, fechas y estado', () => {
    const { lineas, avisos } = leerOor(hoja(
      { orden: 4598684, linea: 3, po: 575740, cant: 60, despacho: '10-12-2026', entrega: '14-12-2026' },
      { orden: '4601171', linea: '7', po: '577655 ', cant: '25', despacho: 46309, estado: 'Invoiced/Closed' }
    ));
    expect(avisos).toEqual([]);
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toMatchObject({
      clave: '4598684|3|1', orden: '4598684', linea: '3', po: '575740', parte: '02317-004', cantidad: 60,
      despacho: '2026-12-10', entregaPlan: '2026-12-14', estado: 'Released', cerrada: false
    });
    expect(lineas[1]).toMatchObject({ clave: '4601171|7|1', po: '577655', cantidad: 25, despacho: '2026-10-14', cerrada: true });
  });

  test('salta filas en blanco y de totales; cabecera con otras mayúsculas y espacios', () => {
    const filas = hoja({ orden: 1, linea: 1, po: 9, despacho: '1-5-2026' });
    filas[0] = filas[0].map((c) => ` ${c.toUpperCase()} `);
    filas.push([], ['', '', '', '', '', '', '', '', '', 'TOTAL', 99]);
    expect(leerOor(filas).lineas).toHaveLength(1);
  });

  test('la misma orden y línea repetida se numera y se avisa', () => {
    const { lineas, avisos } = leerOor(hoja(
      { orden: 1, linea: 1, po: 9, despacho: '1-5-2026' },
      { orden: 1, linea: 1, po: 9, despacho: '2-5-2026' }
    ));
    expect(lineas.map((l) => l.clave)).toEqual(['1|1|1', '1|1|1#2']);
    expect(avisos.join(' ')).toMatch(/repiten la misma orden y línea/);
  });

  test('una fecha ilegible queda sin fecha y se avisa; no se inventa', () => {
    const { lineas, avisos } = leerOor(hoja({ orden: 1, linea: 1, po: 9, despacho: 'TBD' }));
    expect(lineas[0].despacho).toBeNull();
    expect(avisos.join(' ')).toMatch(/1 líneas del OOR traen una fecha que no se pudo leer/);
  });

  test('sin "Order No" no compara nada y lo dice; hoja vacía no avisa', () => {
    const { lineas, avisos } = leerOor([['Columna1', 'Columna2'], ['a', 'b']]);
    expect(lineas).toEqual([]);
    expect(avisos.join(' ')).toMatch(/Order No/);
    expect(leerOor([])).toEqual({ lineas: [], avisos: [] });
    expect(leerOor(undefined)).toEqual({ lineas: [], avisos: [] });
  });

  test('sin "Line No" identifica por orden y parte', () => {
    const filas = hoja({ orden: 1, linea: 5, po: 9, parte: 'ABC-1', despacho: '1-5-2026' });
    filas[0][3] = 'Otra cosa';
    const { lineas, avisos } = leerOor(filas);
    expect(lineas[0].clave).toBe('1|parte:abc-1');
    expect(avisos.join(' ')).toMatch(/Line No/);
  });
});

describe('huella', () => {
  const base = () => leerOor(hoja(
    { orden: 1, linea: 1, po: 9, despacho: '1-5-2026' },
    { orden: 2, linea: 1, po: 8, despacho: '2-5-2026' }
  )).lineas;

  test('no depende del orden de las filas ni de cómo esté escrita la misma fecha', () => {
    const otra = leerOor(hoja(
      { orden: 2, linea: 1, po: 8, despacho: '02-05-2026' },
      { orden: 1, linea: 1, po: 9, despacho: 46143 }
    )).lineas;
    expect(huella(otra)).toBe(huella(base()));
  });

  test('cambia si se mueve una fecha, la cantidad o el estado', () => {
    const h = huella(base());
    for (const cambio of [{ despacho: '3-5-2026' }, { cant: 2 }, { estado: 'Invoiced/Closed' }]) {
      const distinta = leerOor(hoja({ orden: 1, linea: 1, po: 9, despacho: '1-5-2026', ...cambio }, { orden: 2, linea: 1, po: 8, despacho: '2-5-2026' })).lineas;
      expect(huella(distinta)).not.toBe(h);
    }
  });
});

describe('comparar', () => {
  const leer = (...filas) => leerOor(hoja(...filas)).lineas;
  const tipos = (cambios) => cambios.map((c) => `${c.tipo}:${c.linea.clave}`).sort();

  test('sin cambios no informa nada', () => {
    const a = leer({ orden: 1, linea: 1, po: 9, despacho: '15-1-2026' });
    expect(comparar(a, leer({ orden: 1, linea: 1, po: 9, despacho: 46037 }))).toEqual([]);
  });

  test('atraso de enero a junio: días, fechas de antes y de ahora, y la ETA a 15 días', () => {
    const [c] = comparar(
      leer({ orden: 1, linea: 1, po: 9, despacho: '15-1-2026', entrega: '19-1-2026' }),
      leer({ orden: 1, linea: 1, po: 9, despacho: '10-6-2026', entrega: '12-6-2026' })
    );
    expect(c).toMatchObject({ tipo: 'atraso', dias: 146 });
    expect(c.antes).toMatchObject({ despacho: '2026-01-15', eta: '2026-01-30' });
    expect(c.linea).toMatchObject({ despacho: '2026-06-10', eta: '2026-06-25', po: '9', parte: '02317-004' });
  });

  test('adelanto, fecha que desaparece y fecha que aparece', () => {
    const antes = leer(
      { orden: 1, linea: 1, po: 9, despacho: '10-6-2026' },
      { orden: 1, linea: 2, po: 9, despacho: '10-6-2026' },
      { orden: 1, linea: 3, po: 9, despacho: '' }
    );
    const ahora = leer(
      { orden: 1, linea: 1, po: 9, despacho: '1-6-2026' },
      { orden: 1, linea: 2, po: 9, despacho: '' },
      { orden: 1, linea: 3, po: 9, despacho: '10-6-2026' }
    );
    const cambios = comparar(antes, ahora);
    expect(tipos(cambios)).toEqual(['adelanto:1|1|1', 'fecha_nueva:1|3|1', 'sin_fecha:1|2|1']);
    expect(cambios.find((c) => c.tipo === 'adelanto').dias).toBe(-9);
  });

  test('mismo despacho pero otra fecha de entrega también es un movimiento', () => {
    const [c] = comparar(
      leer({ orden: 1, linea: 1, po: 9, despacho: '10-6-2026', entrega: '12-6-2026' }),
      leer({ orden: 1, linea: 1, po: 9, despacho: '10-6-2026', entrega: '19-6-2026' })
    );
    expect(c).toMatchObject({ tipo: 'atraso', dias: 7 });
  });

  test('línea nueva, línea que desaparece y línea que se cierra', () => {
    const antes = leer(
      { orden: 1, linea: 1, po: 9, despacho: '10-6-2026' },
      { orden: 1, linea: 2, po: 9, despacho: '10-6-2026' }
    );
    const ahora = leer(
      { orden: 1, linea: 2, po: 9, despacho: '10-6-2026', estado: 'Invoiced/Closed' },
      { orden: 7, linea: 1, po: 5, despacho: '1-7-2026' }
    );
    expect(tipos(comparar(antes, ahora))).toEqual(['cerrada:1|2|1', 'desaparecida:1|1|1', 'nueva:7|1|1']);
  });

  test('lo que ya estaba cerrado no hace ruido: ni si cambia, ni si desaparece, ni si llega nueva y cerrada', () => {
    const antes = leer({ orden: 1, linea: 1, po: 9, despacho: '10-6-2026', estado: 'Invoiced/Closed' }, { orden: 2, linea: 1, po: 9, despacho: '10-6-2026', estado: 'Invoiced/Closed' });
    const ahora = leer({ orden: 1, linea: 1, po: 9, despacho: '20-6-2026', estado: 'Invoiced/Closed' }, { orden: 3, linea: 1, po: 9, despacho: '1-1-2026', estado: 'Invoiced/Closed' });
    expect(comparar(antes, ahora)).toEqual([]);
  });

  test('cantidad: sola es su propio tipo; junto con la fecha viaja en el mismo cambio', () => {
    const antes = leer({ orden: 1, linea: 1, po: 9, cant: 10, despacho: '10-6-2026' }, { orden: 1, linea: 2, po: 9, cant: 10, despacho: '10-6-2026' });
    const ahora = leer({ orden: 1, linea: 1, po: 9, cant: 4, despacho: '10-6-2026' }, { orden: 1, linea: 2, po: 9, cant: 4, despacho: '20-6-2026' });
    const cambios = comparar(antes, ahora);
    expect(cambios.find((c) => c.linea.clave === '1|1|1')).toMatchObject({ tipo: 'cantidad', cantidadAntes: 10, dias: null });
    expect(cambios.find((c) => c.linea.clave === '1|2|1')).toMatchObject({ tipo: 'atraso', cantidadAntes: 10, dias: 10 });
    expect(cambios).toHaveLength(2);
  });

  test('listas vacías o ausentes no revientan', () => {
    expect(comparar(undefined, undefined)).toEqual([]);
    expect(comparar([], leer({ orden: 1, linea: 1, po: 9, despacho: '1-1-2026' }))).toHaveLength(1);
  });
});

describe('cruzarConBo', () => {
  const leer = (...filas) => leerOor(hoja(...filas)).lineas;
  const bo = (extra) => ({ bo: '4978126', po_axis: '575740', customer_name: 'SICE', project_name: 'Túnel Norte', customer_po: '8370', estimated_invoice_month: '2026-02', estimated_invoice_week: 2, ...extra });

  test('el ejemplo del dueño: la BO de SICE pasó de enero a junio y su facturación de febrero queda afectada', () => {
    const antes = leer(
      { orden: 4598684, linea: 1, po: 575740, despacho: '5-1-2026' },
      { orden: 4598684, linea: 2, po: 575740, despacho: '15-1-2026' }
    );
    const ahora = leer(
      { orden: 4598684, linea: 1, po: 575740, despacho: '5-1-2026' },
      { orden: 4598684, linea: 2, po: 575740, despacho: '10-6-2026' }
    );
    const r = cruzarConBo({ cambios: comparar(antes, ahora), antes, ahora, bos: [bo()] });
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0]).toMatchObject({
      bo: '4978126', cliente: 'SICE', proyecto: 'Túnel Norte', poAxis: '575740', poCliente: '8370', compartida: false,
      ultimoDespacho: { antes: '2026-01-15', ahora: '2026-06-10' },
      eta: { antes: '2026-01-30', ahora: '2026-06-25' },
      mes: { antes: '2026-01', ahora: '2026-06' },
      dias: 146,
      facturacion: { mes: '2026-02', semana: 2, afectada: true }
    });
    expect(r.grupos[0].lineas).toHaveLength(1);
    expect(r.resumen).toMatchObject({ cambios: 1, atraso: 1, bos: 1, bosAtrasadas: 1, bosConFacturacionAfectada: 1, lineasSinBo: 0 });
    expect(r.sinBo).toEqual([]);
  });

  test('la BO se mide por su línea más tardía: atrasar una línea que no es la última no mueve la BO', () => {
    const antes = leer({ orden: 1, linea: 1, po: 575740, despacho: '5-1-2026' }, { orden: 1, linea: 2, po: 575740, despacho: '10-6-2026' });
    const ahora = leer({ orden: 1, linea: 1, po: 575740, despacho: '20-2-2026' }, { orden: 1, linea: 2, po: 575740, despacho: '10-6-2026' });
    const r = cruzarConBo({ cambios: comparar(antes, ahora), antes, ahora, bos: [bo({ estimated_invoice_month: '2026-07' })] });
    expect(r.grupos[0].dias).toBe(0);
    expect(r.grupos[0].lineas[0]).toMatchObject({ tipo: 'atraso', dias: 46 });
    expect(r.grupos[0].facturacion.afectada).toBe(false);
    expect(r.resumen).toMatchObject({ atraso: 1, bosAtrasadas: 0, bosConFacturacionAfectada: 0 });
  });

  test('sin mes de facturación configurado no se afirma nada (null)', () => {
    const antes = leer({ orden: 1, linea: 1, po: 575740, despacho: '5-1-2026' });
    const ahora = leer({ orden: 1, linea: 1, po: 575740, despacho: '5-3-2026' });
    const r = cruzarConBo({ cambios: comparar(antes, ahora), antes, ahora, bos: [bo({ estimated_invoice_month: null })] });
    expect(r.grupos[0].facturacion).toEqual({ mes: null, semana: 2, afectada: null });
  });

  test('las líneas cerradas no cuentan para la fecha de la BO', () => {
    const antes = leer({ orden: 1, linea: 1, po: 575740, despacho: '5-1-2026' }, { orden: 1, linea: 2, po: 575740, despacho: '1-12-2026', estado: 'Invoiced/Closed' });
    const ahora = leer({ orden: 1, linea: 1, po: 575740, despacho: '5-2-2026' }, { orden: 1, linea: 2, po: 575740, despacho: '1-12-2026', estado: 'Invoiced/Closed' });
    const r = cruzarConBo({ cambios: comparar(antes, ahora), antes, ahora, bos: [bo()] });
    expect(r.grupos[0].ultimoDespacho).toEqual({ antes: '2026-01-05', ahora: '2026-02-05' });
  });

  test('un PO sin BO asociada va aparte; un PO en dos BO se informa en las dos', () => {
    const antes = leer({ orden: 1, linea: 1, po: 575740, despacho: '5-1-2026' }, { orden: 2, linea: 1, po: 999999, despacho: '5-1-2026' });
    const ahora = leer({ orden: 1, linea: 1, po: 575740, despacho: '5-2-2026' }, { orden: 2, linea: 1, po: 999999, despacho: '5-2-2026' });
    const r = cruzarConBo({ cambios: comparar(antes, ahora), antes, ahora, bos: [bo(), bo({ bo: '5000001', customer_name: 'OTRO', po_axis: '111 / 575740' })] });
    expect(r.grupos.map((g) => g.bo).sort()).toEqual(['4978126', '5000001']);
    expect(r.grupos.every((g) => g.compartida)).toBe(true);
    expect(r.sinBo).toHaveLength(1);
    expect(r.sinBo[0]).toMatchObject({ po: '999999' });
    expect(r.resumen).toMatchObject({ cambios: 2, bos: 2, lineasSinBo: 1 });
  });

  test('orden: primero las BO con facturación afectada, luego por mayor atraso', () => {
    const antes = leer({ orden: 1, linea: 1, po: 1, despacho: '5-1-2026' }, { orden: 2, linea: 1, po: 2, despacho: '5-1-2026' }, { orden: 3, linea: 1, po: 3, despacho: '5-1-2026' });
    const ahora = leer({ orden: 1, linea: 1, po: 1, despacho: '5-12-2026' }, { orden: 2, linea: 1, po: 2, despacho: '5-3-2026' }, { orden: 3, linea: 1, po: 3, despacho: '5-2-2026' });
    const r = cruzarConBo({
      cambios: comparar(antes, ahora), antes, ahora,
      bos: [bo({ bo: 'A', po_axis: '1', estimated_invoice_month: null }), bo({ bo: 'B', po_axis: '2', estimated_invoice_month: '2026-02' }), bo({ bo: 'C', po_axis: '3', estimated_invoice_month: '2026-12' })]
    });
    expect(r.grupos.map((g) => g.bo)).toEqual(['B', 'A', 'C']);
  });

  test('sin datos devuelve el resumen en cero', () => {
    const r = cruzarConBo();
    expect(r.grupos).toEqual([]);
    expect(r.sinBo).toEqual([]);
    expect(r.resumen).toMatchObject({ cambios: 0, atraso: 0, bos: 0, lineasSinBo: 0 });
  });
});
