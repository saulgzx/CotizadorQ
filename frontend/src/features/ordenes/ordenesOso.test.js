import { MONTH_LABEL_FORMATTER } from '../cotizador/cotizadorConstants';
import {
  calcularEstadisticasOso,
  claveMes,
  contarEstadosOrdenes,
  empresasOso,
  estadoOrden,
  estadoSAndD,
  filasReporteLineas,
  filtrarOrdenarOrdenesOso,
  htmlSAndD,
  marcaDeOrden,
  mesFacturacionDeBo,
  metaDeOrden,
  metaSucia,
  nombreClienteOrden,
  normalizarMarca,
  normalizarMesFacturacion,
  normalizarSemanaFacturacion,
  opcionesMesFacturacion,
  ordenarFacturadas,
  ordenesFacturadasFueraDeLista,
  porcentajeAsignadoOrden,
  semanaFacturacionDeBo,
  sumarDiasIso,
  totalesOrden,
  tramoAsignacion
} from './ordenesOso';

const linea = (orderQty, shippedQty = 0, allocQty = 0, extra = {}) => ({ orderQty, shippedQty, allocQty, ...extra });
const bos = (lista) => lista.map(o => o.bo);

describe('estadoOrden', () => {
  test('sin líneas, sin cantidades o con cantidad 0 es Activa', () => {
    expect(estadoOrden({})).toBe('Activa');
    expect(estadoOrden({ lines: [] })).toBe('Activa');
    expect(estadoOrden({ lines: [linea(0, 5)] })).toBe('Activa');
    expect(estadoOrden({ lines: [{}] })).toBe('Activa');
  });

  test('nada despachado es Activa; algo es Parcial; todo o más es Completa', () => {
    expect(estadoOrden({ lines: [linea(10, 0)] })).toBe('Activa');
    expect(estadoOrden({ lines: [linea(10, 3)] })).toBe('Parcial');
    expect(estadoOrden({ lines: [linea(10, 10)] })).toBe('Completa');
    expect(estadoOrden({ lines: [linea(10, 12)] })).toBe('Completa');
  });

  test('suma todas las líneas y tolera strings y basura', () => {
    expect(estadoOrden({ lines: [linea('4', '4'), linea(6, 0)] })).toBe('Parcial');
    expect(estadoOrden({ lines: [linea('4', '4'), linea(6, '6')] })).toBe('Completa');
    expect(estadoOrden({ lines: [linea('x', 'y'), linea(2, 'abc')] })).toBe('Activa');
  });
});

describe('metaDeOrden', () => {
  test('meta ausente da objeto vacío', () => {
    expect(metaDeOrden({}, {}, 'BO1')).toEqual({});
  });

  test('el borrador pisa a la meta campo por campo y no muta', () => {
    const boMeta = { BO1: { projectName: 'A', poAxis: 'P1' } };
    const boDraft = { BO1: { projectName: 'B' } };
    expect(metaDeOrden(boMeta, boDraft, 'BO1')).toEqual({ projectName: 'B', poAxis: 'P1' });
    expect(boMeta.BO1.projectName).toBe('A');
  });

  test('un borrador vacío ("") pisa a la meta; solo borrador también sirve', () => {
    expect(metaDeOrden({ BO1: { projectName: 'A' } }, { BO1: { projectName: '' } }, 'BO1').projectName).toBe('');
    expect(metaDeOrden({}, { BO1: { poAxis: 'X' } }, 'BO1')).toEqual({ poAxis: 'X' });
  });
});

describe('normalizarMesFacturacion / normalizarSemanaFacturacion', () => {
  test('mes: vacíos e inválidos dan ""', () => {
    expect(normalizarMesFacturacion(undefined)).toBe('');
    expect(normalizarMesFacturacion(null)).toBe('');
    expect(normalizarMesFacturacion('')).toBe('');
    expect(normalizarMesFacturacion('   ')).toBe('');
    expect(normalizarMesFacturacion('no es fecha')).toBe('');
  });

  test('mes: YYYY-MM se respeta (con espacios) y una fecha se reduce a su mes local', () => {
    expect(normalizarMesFacturacion('2026-03')).toBe('2026-03');
    expect(normalizarMesFacturacion(' 2026-11 ')).toBe('2026-11');
    expect(normalizarMesFacturacion('2026-03-15T12:00:00')).toBe('2026-03');
    // Rareza actual: la regex solo mira la forma, así que un mes 13 pasa tal cual.
    expect(normalizarMesFacturacion('2026-13')).toBe('2026-13');
  });

  test('semana: solo 1..4, devuelve string', () => {
    expect(normalizarSemanaFacturacion(undefined)).toBe('');
    expect(normalizarSemanaFacturacion(null)).toBe('');
    expect(normalizarSemanaFacturacion('')).toBe('');
    expect(normalizarSemanaFacturacion(0)).toBe('');
    expect(normalizarSemanaFacturacion(5)).toBe('');
    expect(normalizarSemanaFacturacion('abc')).toBe('');
    expect(normalizarSemanaFacturacion(1)).toBe('1');
    expect(normalizarSemanaFacturacion('4')).toBe('4');
    expect(normalizarSemanaFacturacion('2.9')).toBe('2');
  });
});

describe('mesFacturacionDeBo / semanaFacturacionDeBo', () => {
  test('prefiere estimatedInvoiceMonth, cae a estimatedInvoiceDate, y el borrador manda', () => {
    const boMeta = {
      A: { estimatedInvoiceMonth: '2026-05', estimatedInvoiceDate: '2026-09-10T12:00:00' },
      B: { estimatedInvoiceDate: '2026-09-10T12:00:00' },
      C: {}
    };
    const boDraft = { C: { estimatedInvoiceMonth: '2027-01', estimatedInvoiceWeek: '3' } };
    expect(mesFacturacionDeBo(boMeta, boDraft, 'A')).toBe('2026-05');
    expect(mesFacturacionDeBo(boMeta, boDraft, 'B')).toBe('2026-09');
    expect(mesFacturacionDeBo(boMeta, boDraft, 'C')).toBe('2027-01');
    expect(mesFacturacionDeBo(boMeta, boDraft, 'NOEXISTE')).toBe('');
    expect(semanaFacturacionDeBo(boMeta, boDraft, 'C')).toBe('3');
    expect(semanaFacturacionDeBo(boMeta, boDraft, 'A')).toBe('');
  });

  test('un mes de borrador inválido tapa la fecha guardada (el borrador pisa el campo)', () => {
    const boMeta = { A: { estimatedInvoiceMonth: '2026-05' } };
    const boDraft = { A: { estimatedInvoiceMonth: 'basura', estimatedInvoiceDate: '2026-07-01T12:00:00' } };
    expect(mesFacturacionDeBo(boMeta, boDraft, 'A')).toBe('2026-07');
  });
});

describe('metaSucia', () => {
  test('sin borrador no está sucia', () => {
    expect(metaSucia({ A: { projectName: 'x' } }, {}, 'A')).toBe(false);
    expect(metaSucia({}, { A: {} }, 'A')).toBe(false);
  });

  test('proyecto y PO: compara contra lo guardado, tratando ausente como ""', () => {
    expect(metaSucia({ A: { projectName: 'x' } }, { A: { projectName: 'x' } }, 'A')).toBe(false);
    expect(metaSucia({ A: { projectName: 'x' } }, { A: { projectName: 'y' } }, 'A')).toBe(true);
    expect(metaSucia({}, { A: { projectName: '' } }, 'A')).toBe(false);
    expect(metaSucia({}, { A: { projectName: 'nuevo' } }, 'A')).toBe(true);
    expect(metaSucia({ A: { poAxis: 'P' } }, { A: { poAxis: '' } }, 'A')).toBe(true);
    expect(metaSucia({ A: { poAxis: 'P' } }, { A: { poAxis: 'P' } }, 'A')).toBe(false);
  });

  test('mes: compara normalizado y cae a estimatedInvoiceDate', () => {
    expect(metaSucia({ A: { estimatedInvoiceMonth: '2026-05' } }, { A: { estimatedInvoiceMonth: '2026-05' } }, 'A')).toBe(false);
    expect(metaSucia({ A: { estimatedInvoiceMonth: '2026-05' } }, { A: { estimatedInvoiceMonth: '2026-06' } }, 'A')).toBe(true);
    expect(metaSucia({ A: { estimatedInvoiceDate: '2026-05-10T12:00:00' } }, { A: { estimatedInvoiceMonth: '2026-05' } }, 'A')).toBe(false);
    expect(metaSucia({}, { A: { estimatedInvoiceMonth: '' } }, 'A')).toBe(false);
    expect(metaSucia({}, { A: { estimatedInvoiceMonth: 'basura' } }, 'A')).toBe(false);
  });

  test('semana: compara normalizado', () => {
    expect(metaSucia({ A: { estimatedInvoiceWeek: 2 } }, { A: { estimatedInvoiceWeek: '2' } }, 'A')).toBe(false);
    expect(metaSucia({ A: { estimatedInvoiceWeek: 2 } }, { A: { estimatedInvoiceWeek: '3' } }, 'A')).toBe(true);
    expect(metaSucia({}, { A: { estimatedInvoiceWeek: '9' } }, 'A')).toBe(false);
    expect(metaSucia({}, { A: { estimatedInvoiceWeek: '1' } }, 'A')).toBe(true);
  });
});

describe('nombreClienteOrden', () => {
  test('prefiere el de la orden, luego el de la meta (con borrador), luego "Sin cliente"', () => {
    expect(nombreClienteOrden({ bo: 'A', customerName: '  ACME ' }, {}, {})).toBe('ACME');
    expect(nombreClienteOrden({ bo: 'A' }, { A: { customerName: 'Meta SA' } }, {})).toBe('Meta SA');
    expect(nombreClienteOrden({ bo: 'A' }, { A: { customerName: 'Meta SA' } }, { A: { customerName: 'Borr' } })).toBe('Borr');
    expect(nombreClienteOrden({ bo: 'A' }, {}, {})).toBe('Sin cliente');
    expect(nombreClienteOrden({ bo: 'A', customerName: '   ' }, {}, {})).toBe('Sin cliente');
    expect(nombreClienteOrden({ bo: 'A', customerName: '' }, { A: { customerName: '  ' } }, {})).toBe('Sin cliente');
  });

  test('tolera orden undefined', () => {
    expect(nombreClienteOrden(undefined, {}, {})).toBe('Sin cliente');
  });
});

describe('estadoSAndD', () => {
  test('solo "aplicado" es aplicado; todo lo demás es pendiente; ignora borradores', () => {
    expect(estadoSAndD({ A: { sAndDStatus: 'aplicado' } }, 'A')).toBe('aplicado');
    expect(estadoSAndD({ A: { sAndDStatus: 'Aplicado' } }, 'A')).toBe('pendiente');
    expect(estadoSAndD({ A: { sAndDStatus: 'pendiente' } }, 'A')).toBe('pendiente');
    expect(estadoSAndD({ A: {} }, 'A')).toBe('pendiente');
    expect(estadoSAndD({}, 'A')).toBe('pendiente');
  });
});

describe('totalesOrden', () => {
  test('suma cantidades, tolera líneas ausentes, strings y NaN', () => {
    expect(totalesOrden(undefined)).toEqual({ orderQty: 0, shippedQty: 0, allocQty: 0 });
    expect(totalesOrden({})).toEqual({ orderQty: 0, shippedQty: 0, allocQty: 0 });
    expect(totalesOrden({ lines: [linea(5, 2, 3), linea('4', '1', 'x'), {}] }))
      .toEqual({ orderQty: 9, shippedQty: 3, allocQty: 3 });
  });
});

describe('porcentajeAsignadoOrden', () => {
  test('order.allocPct manda, luego meta.allocPct', () => {
    const totals = { orderQty: 10, allocQty: 5 };
    expect(porcentajeAsignadoOrden({ allocPct: 80 }, totals, { allocPct: 10 })).toBe(80);
    expect(porcentajeAsignadoOrden({ allocPct: '42.5' }, totals, {})).toBe(42.5);
    expect(porcentajeAsignadoOrden({}, totals, { allocPct: 10 })).toBe(10);
    expect(porcentajeAsignadoOrden({ allocPct: 0 }, totals, { allocPct: 10 })).toBe(0);
  });

  test('sin valor numérico lo calcula con un decimal; sin cantidades da 0', () => {
    expect(porcentajeAsignadoOrden({}, { orderQty: 3, allocQty: 1 }, {})).toBe(33.3);
    expect(porcentajeAsignadoOrden({ allocPct: 'x' }, { orderQty: 8, allocQty: 8 }, undefined)).toBe(100);
    expect(porcentajeAsignadoOrden({}, { orderQty: 0, allocQty: 5 }, {})).toBe(0);
    expect(porcentajeAsignadoOrden({}, undefined, {})).toBe(0);
    expect(porcentajeAsignadoOrden(undefined, undefined, undefined)).toBe(0);
  });

  test('rareza actual: allocPct null/"" se convierte con Number y da 0 (no cae al cálculo)', () => {
    // ?? deja pasar "" (no es null) y Number('') = 0; null sí cae a meta.
    expect(porcentajeAsignadoOrden({ allocPct: '' }, { orderQty: 10, allocQty: 5 }, {})).toBe(0);
    expect(porcentajeAsignadoOrden({ allocPct: null }, { orderQty: 10, allocQty: 5 }, {})).toBe(50);
  });
});

describe('claveMes / sumarDiasIso / tramoAsignacion', () => {
  test('claveMes', () => {
    expect(claveMes('')).toBe('Sin fecha');
    expect(claveMes(null)).toBe('Sin fecha');
    expect(claveMes('zzz')).toBe('Sin fecha');
    expect(claveMes('2026-03-15T12:00:00')).toBe('2026-03');
    expect(claveMes('2026-12-31T12:00:00')).toBe('2026-12');
  });

  test('sumarDiasIso', () => {
    expect(sumarDiasIso('', 15)).toBe('');
    expect(sumarDiasIso(undefined, 15)).toBe('');
    expect(sumarDiasIso('basura', 15)).toBe('');
    expect(sumarDiasIso('2026-01-10', 15)).toBe('2026-01-25');
    expect(sumarDiasIso('2026-01-25', 15)).toBe('2026-02-09');
    expect(sumarDiasIso('2026-12-25', 15)).toBe('2027-01-09');
    expect(sumarDiasIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDiasIso('2026-01-10', 0)).toBe('2026-01-10');
  });

  test('tramoAsignacion: bordes de cada tramo', () => {
    expect(tramoAsignacion(NaN)).toBe('Sin %');
    expect(tramoAsignacion(Infinity)).toBe('Sin %');
    expect(tramoAsignacion(-5)).toBe('0-24%');
    expect(tramoAsignacion(0)).toBe('0-24%');
    expect(tramoAsignacion(24.9)).toBe('0-24%');
    expect(tramoAsignacion(25)).toBe('25-49%');
    expect(tramoAsignacion(49.9)).toBe('25-49%');
    expect(tramoAsignacion(50)).toBe('50-74%');
    expect(tramoAsignacion(74.9)).toBe('50-74%');
    expect(tramoAsignacion(75)).toBe('75-99%');
    expect(tramoAsignacion(99.9)).toBe('75-99%');
    expect(tramoAsignacion(100)).toBe('>=100%');
    expect(tramoAsignacion(250)).toBe('>=100%');
  });
});

describe('contarEstadosOrdenes', () => {
  test('lista vacía', () => {
    expect(contarEstadosOrdenes([])).toEqual({ total: 0, activa: 0, parcial: 0, completa: 0 });
  });

  test('cuenta por estado', () => {
    const orders = [
      { lines: [linea(5, 5)] },
      { lines: [linea(5, 1)] },
      { lines: [linea(5, 0)] },
      { lines: [] },
      {}
    ];
    expect(contarEstadosOrdenes(orders)).toEqual({ total: 5, activa: 3, parcial: 1, completa: 1 });
  });
});

describe('calcularEstadisticasOso', () => {
  const hoy = new Date(2026, 5, 15, 10, 0, 0); // 15 jun 2026 (local)

  test('sin órdenes: todo en cero', () => {
    expect(calcularEstadisticasOso([], {}, {}, hoy)).toEqual({
      total: 0, activa: 0, parcial: 0, completa: 0,
      totalOrderQty: 0, totalAllocQty: 0, totalShippedQty: 0,
      avgAllocPct: 0, etaOverdue: 0, etaSoon: 0
    });
  });

  test('salida completa con datos chicos (estados, cantidades, promedio y ETA)', () => {
    const orders = [
      // Completa, 100% calculado, ETA vencida (ayer)
      { bo: 'A', lines: [linea(10, 10, 10)], etaEstimated: '2026-06-14T12:00:00' },
      // Parcial, allocPct explícito 50, ETA hoy (diff 0 => pronto)
      { bo: 'B', allocPct: 50, lines: [linea(10, 4, 5)], etaEstimated: '2026-06-15T12:00:00' },
      // Activa, % desde la meta (20), ETA en 7 días (límite => pronto)
      { bo: 'C', lines: [linea(10, 0, 0)], etaEstimated: '2026-06-22T12:00:00' },
      // Activa, sin líneas => 0%, ETA en 8 días (ni vencida ni pronto)
      { bo: 'D', lines: [], etaEstimated: '2026-06-23T12:00:00' },
      // ETA inválida y sin ETA no cuentan
      { bo: 'E', lines: [linea(2, 0, 1)], etaEstimated: 'basura' },
      { bo: 'F', lines: [linea(2, 0, 0)] }
    ];
    const boMeta = { C: { allocPct: 20 } };
    // % = 100, 50, 20, 0, 50 (1/2), 0  => 220/6 = 36.666 => 36.7
    expect(calcularEstadisticasOso(orders, boMeta, {}, hoy)).toEqual({
      total: 6, activa: 4, parcial: 1, completa: 1,
      totalOrderQty: 34, totalAllocQty: 16, totalShippedQty: 14,
      avgAllocPct: 36.7, etaOverdue: 1, etaSoon: 2
    });
  });

  test('el borrador de la meta también cuenta para el %', () => {
    const orders = [{ bo: 'A', lines: [linea(10, 0, 0)] }];
    const stats = calcularEstadisticasOso(orders, { A: { allocPct: 10 } }, { A: { allocPct: 90 } }, hoy);
    expect(stats.avgAllocPct).toBe(90);
  });
});

describe('normalizarMarca / marcaDeOrden', () => {
  test('marcas conocidas sin importar mayúsculas ni lo que las rodee', () => {
    expect(normalizarMarca('AXIS Communications')).toBe('Axis');
    expect(normalizarMarca('  qnap systems ')).toBe('QNAP');
    expect(normalizarMarca('ISS')).toBe('ISS');
    expect(normalizarMarca('Neural Labs Inc')).toBe('Neural Labs');
    expect(normalizarMarca('MILESTONE')).toBe('Milestone');
  });

  test('desconocidas se devuelven recortadas; vacías dan ""', () => {
    expect(normalizarMarca('  Otra Marca ')).toBe('Otra Marca');
    expect(normalizarMarca(undefined)).toBe('');
    expect(normalizarMarca(null)).toBe('');
    expect(normalizarMarca(0)).toBe('');
  });

  test('marcaDeOrden: orden de preferencia de campos y primera línea', () => {
    expect(marcaDeOrden({ brand: 'axis', marca: 'qnap' })).toBe('Axis');
    expect(marcaDeOrden({ marca: 'qnap' })).toBe('QNAP');
    expect(marcaDeOrden({ manufBrand: 'milestone' })).toBe('Milestone');
    expect(marcaDeOrden({ manufacturer: 'neural' })).toBe('Neural Labs');
    expect(marcaDeOrden({ lines: [{ brand: 'iss' }, { brand: 'axis' }] })).toBe('ISS');
    expect(marcaDeOrden({ lines: [{ marca: 'axis' }] })).toBe('Axis');
    expect(marcaDeOrden({ lines: [] })).toBe('');
    expect(marcaDeOrden(undefined)).toBe('');
  });
});

describe('htmlSAndD', () => {
  test('arma el correo con BO, marca y proyecto (borrador antes que meta)', () => {
    const order = { bo: 'BO9', brand: 'axis' };
    const html = htmlSAndD(order, { BO9: { projectName: 'Guardado' } }, { BO9: { projectName: 'Borrador' } });
    expect(html).toBe([
      '<p>Estimados.</p>',
      '<p>Favor su apoyo gestionando la siguiente protección</p>',
      '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">',
      '<tr><th>Orden de Venta</th><td>BO9</td></tr>',
      '<tr><th>Usuario Final</th><td></td></tr>',
      '<tr><th>País</th><td>XCL</td></tr>',
      '<tr><th>Marca</th><td>Axis</td></tr>',
      '<tr><th>Número de proyecto</th><td>Borrador</td></tr>',
      '</table>',
      '<p>Muchas gracias<br>Quedo atento<br>Saludos.</p>'
    ].join(''));
  });

  test('usa la meta si no hay borrador; un borrador "" gana; sin nada queda vacío', () => {
    const order = { bo: 'BO9' };
    expect(htmlSAndD(order, { BO9: { projectName: 'G' } }, {})).toContain('<th>Número de proyecto</th><td>G</td>');
    expect(htmlSAndD(order, { BO9: { projectName: 'G' } }, { BO9: { projectName: '' } })).toContain('<th>Número de proyecto</th><td></td>');
    const vacio = htmlSAndD({}, {}, {});
    expect(vacio).toContain('<th>Orden de Venta</th><td></td>');
    expect(vacio).toContain('<th>Marca</th><td></td>');
  });
});

describe('ordenesFacturadasFueraDeLista', () => {
  test('solo facturados no borrados y que no están en la lista, por fecha de facturación desc', () => {
    const boMeta = {
      A: { invoiced: true, invoicedAt: '2026-01-01T12:00:00', customerName: 'a' },
      B: { invoiced: true, invoicedAt: '2026-03-01T12:00:00' },
      C: { invoiced: true, deleted: true, invoicedAt: '2026-05-01T12:00:00' },
      D: { invoiced: false, invoicedAt: '2026-06-01T12:00:00' },
      E: { invoiced: true, invoicedAt: '2026-02-01T12:00:00' },
      F: { invoiced: true },
      G: null
    };
    const res = ordenesFacturadasFueraDeLista(boMeta, [{ bo: 'E' }]);
    expect(res.map(r => r.bo)).toEqual(['B', 'A', 'F']);
    expect(res[1]).toEqual({ bo: 'A', invoiced: true, invoicedAt: '2026-01-01T12:00:00', customerName: 'a' });
  });

  test('sin meta o sin órdenes', () => {
    expect(ordenesFacturadasFueraDeLista({}, [])).toEqual([]);
    expect(ordenesFacturadasFueraDeLista({ A: { invoiced: true } }, [])).toEqual([{ bo: 'A', invoiced: true }]);
  });
});

describe('ordenarFacturadas', () => {
  const items = [
    { bo: 'BO2', customerName: 'Zeta', projectName: 'Proy Uno', poAxis: 'PO-9', invoicedAt: '2026-01-01T12:00:00', lastSeenAt: '2026-05-01T12:00:00' },
    { bo: 'BO1', customerName: 'Alfa', projectName: '', poAxis: '', invoicedAt: '2026-03-01T12:00:00', lastSeenAt: '2026-02-01T12:00:00' },
    { bo: 'BO3', customerName: '', projectName: 'Otro', poAxis: 'po-1', invoicedAt: '2026-02-01T12:00:00' }
  ];

  test('cada criterio de orden y el valor por defecto (invoicedAt desc)', () => {
    expect(bos(ordenarFacturadas(items, 'cliente', ''))).toEqual(['BO3', 'BO1', 'BO2']);
    expect(bos(ordenarFacturadas(items, 'bo', ''))).toEqual(['BO1', 'BO2', 'BO3']);
    expect(bos(ordenarFacturadas(items, 'lastSeen', ''))).toEqual(['BO2', 'BO1', 'BO3']);
    expect(bos(ordenarFacturadas(items, 'invoicedAt', ''))).toEqual(['BO1', 'BO3', 'BO2']);
    expect(bos(ordenarFacturadas(items, undefined, undefined))).toEqual(['BO1', 'BO3', 'BO2']);
  });

  test('filtra por texto en bo, cliente, proyecto y PO (sin importar mayúsculas)', () => {
    expect(bos(ordenarFacturadas(items, 'bo', ' alfa '))).toEqual(['BO1']);
    expect(bos(ordenarFacturadas(items, 'bo', 'proy'))).toEqual(['BO2']);
    expect(bos(ordenarFacturadas(items, 'bo', 'PO-'))).toEqual(['BO2', 'BO3']);
    expect(bos(ordenarFacturadas(items, 'bo', 'bo'))).toEqual(['BO1', 'BO2', 'BO3']);
    expect(ordenarFacturadas(items, 'bo', 'nada')).toEqual([]);
  });

  test('no muta la entrada', () => {
    const copia = items.map(i => i.bo);
    ordenarFacturadas(items, 'cliente', '');
    expect(items.map(i => i.bo)).toEqual(copia);
  });
});

describe('opcionesMesFacturacion', () => {
  const ahora = new Date(2026, 5, 15, 10, 0, 0); // jun 2026
  const etiqueta = (anio, mes, pasado) =>
    `${MONTH_LABEL_FORMATTER.format(new Date(anio, mes - 1, 1)).replace('.', '')}${pasado ? ' (pasado)' : ''}`;

  test('sin meta: 36 meses desde el actual, ninguno deshabilitado', () => {
    const res = opcionesMesFacturacion({}, {}, ahora);
    expect(res).toHaveLength(36);
    expect(res[0]).toEqual({ value: '2026-06', label: etiqueta(2026, 6, false), disabled: false });
    expect(res[35].value).toBe('2029-05');
    expect(res.every(o => o.disabled === false)).toBe(true);
  });

  test('incluye meses guardados y de borrador, pasados deshabilitados y ordenados', () => {
    const boMeta = {
      A: { estimatedInvoiceMonth: '2026-02' },
      B: { estimatedInvoiceDate: '2025-11-10T12:00:00' },
      C: { estimatedInvoiceMonth: '2026-08' }, // ya está entre los 36
      D: {},
      E: null
    };
    const boDraft = { A: { estimatedInvoiceMonth: '2030-01' }, F: { estimatedInvoiceMonth: 'basura' }, G: null };
    const res = opcionesMesFacturacion(boMeta, boDraft, ahora);
    expect(res).toHaveLength(36 + 3);
    expect(res.slice(0, 2)).toEqual([
      { value: '2025-11', label: etiqueta(2025, 11, true), disabled: true },
      { value: '2026-02', label: etiqueta(2026, 2, true), disabled: true }
    ]);
    expect(res[2]).toEqual({ value: '2026-06', label: etiqueta(2026, 6, false), disabled: false });
    expect(res[res.length - 1].value).toBe('2030-01');
    expect(res.filter(o => o.value === '2026-08')).toHaveLength(1);
  });

  test('tolera boMeta y boDraft nulos', () => {
    expect(opcionesMesFacturacion(null, null, ahora)).toHaveLength(36);
  });
});

describe('empresasOso', () => {
  test('agrupa por nombre efectivo (orden, meta, borrador, "Sin cliente") y ordena por nombre', () => {
    const orders = [
      { bo: 'A', customerName: 'Zeta' },
      { bo: 'B', customerName: 'Alfa' },
      { bo: 'C', customerName: 'Zeta' },
      { bo: 'D' },
      { bo: 'E' },
      { bo: 'F' }
    ];
    const boMeta = { D: { customerName: 'Alfa' } };
    const boDraft = { E: { customerName: 'Beta' } };
    expect(empresasOso(orders, boMeta, boDraft)).toEqual([
      { name: 'Alfa', count: 2 },
      { name: 'Beta', count: 1 },
      { name: 'Sin cliente', count: 1 },
      { name: 'Zeta', count: 2 }
    ]);
    expect(empresasOso([], {}, {})).toEqual([]);
  });
});

describe('filasReporteLineas', () => {
  const vacio = { boMeta: {}, boDraft: {}, axisDraft: {}, intcomexDraft: {} };

  test('sin órdenes o sin líneas no hay filas', () => {
    expect(filasReporteLineas([], vacio)).toEqual([]);
    expect(filasReporteLineas([{ bo: 'A' }, { bo: 'B', lines: [] }], vacio)).toEqual([]);
  });

  test('salida completa: meta, borrador de meta, montos guardados y borradores', () => {
    const orders = [{
      bo: 'BO1',
      customerName: 'ACME',
      customerPO: 'PO-CLI',
      lines: [
        { lineIndex: 3, sku: 'S1', mpn: 'M1', desc: 'Cámara', tiempoEntrega: '2026-01-10', orderQty: 4, shippedQty: 1, allocQty: 2, montoAxis: 100, montoIntcomex: 50 },
        { sku: 'S2', mpn: '', orderQty: 0 }
      ]
    }];
    const ctx = {
      boMeta: { BO1: { poAxis: 'PA', projectName: 'Guardado', estimatedInvoiceMonth: '2026-07', estimatedInvoiceWeek: '2' } },
      boDraft: { BO1: { projectName: 'Borrador' } },
      axisDraft: { BO1: { 's1||m1': '120.5' } },
      intcomexDraft: {}
    };
    expect(filasReporteLineas(orders, ctx)).toEqual([
      {
        key: 'BO1-3-S1-M1',
        lineIndex: 3,
        bo: 'BO1',
        customerPo: 'PO-CLI',
        poAxis: 'PA',
        projectName: 'Borrador',
        cliente: 'ACME',
        empresa: 'ACME',
        sku: 'S1',
        mpn: 'M1',
        desc: 'Cámara',
        entregaOor: '2026-01-10',
        etaEstimado: '2026-01-25',
        invoiceMonth: '2026-07',
        invoiceWeek: 2,
        allocQty: 2,
        orderQty: 4,
        shippedQty: 1,
        montoAxis: 120.5,
        montoFacturar: 482,
        montoIntcomex: 50,
        montoFacturarIntcomex: 200,
        notas: ''
      },
      {
        key: 'BO1-1-S2-',
        lineIndex: 1,
        bo: 'BO1',
        customerPo: 'PO-CLI',
        poAxis: 'PA',
        projectName: 'Borrador',
        cliente: 'ACME',
        empresa: 'ACME',
        sku: 'S2',
        mpn: '',
        desc: '',
        entregaOor: '',
        etaEstimado: '',
        invoiceMonth: '2026-07',
        invoiceWeek: 2,
        allocQty: 0,
        orderQty: 0,
        shippedQty: 0,
        montoAxis: 0,
        montoFacturar: 0,
        montoIntcomex: 0,
        montoFacturarIntcomex: 0,
        notas: ''
      }
    ]);
  });

  test('sin meta: cliente "Sin cliente", PO desde meta, semana y mes vacíos; borrador vacío pisa el guardado', () => {
    const orders = [{ bo: 'BO2', lines: [{ sku: 'X', mpn: 'Y', orderQty: 2, montoIntcomex: 10 }] }];
    const [fila] = filasReporteLineas(orders, {
      boMeta: { BO2: { customerPO: 'PO-META' } },
      boDraft: {},
      axisDraft: {},
      intcomexDraft: { BO2: { 'x||y': '' } }
    });
    expect(fila.cliente).toBe('Sin cliente');
    expect(fila.customerPo).toBe('PO-META');
    expect(fila.invoiceMonth).toBe('');
    expect(fila.invoiceWeek).toBe('');
    expect(fila.montoIntcomex).toBe(0);
    expect(fila.montoFacturarIntcomex).toBe(0);
  });

  test('orden sin bo: monto 0 aunque la línea traiga montos guardados', () => {
    const [fila] = filasReporteLineas([{ lines: [{ sku: 'X', mpn: 'Y', orderQty: 3, montoAxis: 99 }] }], vacio);
    expect(fila.bo).toBe('');
    expect(fila.montoAxis).toBe(0);
    expect(fila.montoFacturar).toBe(0);
  });

  test('entrega inválida deja etaEstimado vacía', () => {
    const [fila] = filasReporteLineas([{ bo: 'A', lines: [{ tiempoEntrega: 'pronto' }] }], vacio);
    expect(fila.entregaOor).toBe('pronto');
    expect(fila.etaEstimado).toBe('');
  });
});

describe('filtrarOrdenarOrdenesOso', () => {
  // Datos chicos y variados. Todas las fechas a mediodía local.
  const ordenes = [
    { bo: 'BO3', customerName: 'Zeta Ltda', allocPct: 10, etaEstimated: '2026-08-10T12:00:00', lines: [linea(10, 10, 0, { sku: 'SKU-C', mpn: 'MPN-C' })] }, // Completa
    { bo: 'BO1', customerName: 'alfa SA', allocPct: 90, etaEstimated: '2026-05-10T12:00:00', lines: [linea(10, 4, 0, { sku: 'SKU-A', mpn: 'MPN-A' })] }, // Parcial
    { bo: 'BO2', customerName: 'Alfa SA', allocPct: 90, lines: [linea(10, 0, 0, { sku: 'SKU-B', mpn: 'MPN-B' })] }, // Activa, sin ETA
    { bo: 'BO4', lines: [] }, // Activa, sin cliente, sin allocPct
    { bo: 'BO5', customerName: 'Beta', etaEstimated: 'basura', lines: [linea(5, 0)] } // ETA inválida
  ];
  const boMeta = {
    BO1: { projectName: 'Proyecto Norte', poAxis: 'PO-1', estimatedInvoiceMonth: '2026-09', estimatedInvoiceWeek: '2', sAndDStatus: 'aplicado' },
    BO2: { projectName: '   ', poAxis: 'PO-2', estimatedInvoiceMonth: '2026-09', estimatedInvoiceWeek: '1' },
    BO3: { projectName: 'Proyecto Sur', poAxis: '', estimatedInvoiceDate: '2026-10-05T12:00:00' },
    BO4: { customerName: 'Meta Cliente' }
  };
  const base = { boMeta, boDraft: {}, texto: '', esAdmin: false, empresa: '', estado: 'all', filtroRapido: 'all', mesFacturacion: '', orden: 'bo', busquedaGlobal: '' };
  const filtrar = (extra = {}) => bos(filtrarOrdenarOrdenesOso(ordenes, { ...base, ...extra }));

  test('sin filtros ordena por BO y no muta la entrada', () => {
    const antes = bos(ordenes);
    expect(filtrar()).toEqual(['BO1', 'BO2', 'BO3', 'BO4', 'BO5']);
    expect(bos(ordenes)).toEqual(antes);
    expect(filtrar({ orden: undefined })).toEqual(['BO1', 'BO2', 'BO3', 'BO4', 'BO5']);
    expect(filtrar({ orden: 'desconocido' })).toEqual(['BO1', 'BO2', 'BO3', 'BO4', 'BO5']);
  });

  test('lista vacía', () => {
    expect(bos(filtrarOrdenarOrdenesOso([], base))).toEqual([]);
  });

  describe('orden', () => {
    test('empresa: por customerName de la orden (no el efectivo), vacío primero, estable en empates', () => {
      // '' (BO4) < 'alfa SA' ... localeCompare ignora mayúsculas de forma estable: alfa vs Alfa empatan según ICU
      const res = filtrar({ orden: 'empresa' });
      expect(res[0]).toBe('BO4');
      expect(res.slice(1, 3).sort()).toEqual(['BO1', 'BO2']);
      expect(res.slice(3)).toEqual(['BO5', 'BO3']);
    });

    test('porcentaje: descendente por order.allocPct; ausente cuenta 0; empates conservan el orden de entrada', () => {
      expect(filtrar({ orden: 'porcentaje' })).toEqual(['BO1', 'BO2', 'BO3', 'BO4', 'BO5']);
      const invertidas = [ordenes[1], ordenes[0], ordenes[3], ordenes[2]]; // BO1, BO3, BO4, BO2
      const res = filtrarOrdenarOrdenesOso(invertidas, { ...base, orden: 'porcentaje' });
      expect(bos(res)).toEqual(['BO1', 'BO2', 'BO3', 'BO4']);
      const empate = [{ bo: 'X', allocPct: 50 }, { bo: 'Y', allocPct: '50' }, { bo: 'Z', allocPct: 'abc' }];
      expect(bos(filtrarOrdenarOrdenesOso(empate, { ...base, orden: 'porcentaje' }))).toEqual(['X', 'Y', 'Z']);
    });

    test('fact-month: mes efectivo asc (sin mes al final), luego semana (sin semana al final), luego BO', () => {
      // BO2: 2026-09 s1; BO1: 2026-09 s2; BO3: 2026-10 (de estimatedInvoiceDate) sin semana; BO4/BO5 sin mes
      expect(filtrar({ orden: 'fact-month' })).toEqual(['BO2', 'BO1', 'BO3', 'BO4', 'BO5']);
    });

    test('fact-month: empates de mes y semana se desempatan por BO; borrador cambia el lugar', () => {
      const lista = [{ bo: 'B' }, { bo: 'A' }, { bo: 'C' }];
      const meta = { A: { estimatedInvoiceMonth: '2026-05', estimatedInvoiceWeek: '3' }, B: { estimatedInvoiceMonth: '2026-05', estimatedInvoiceWeek: '3' }, C: { estimatedInvoiceMonth: '2026-05', estimatedInvoiceWeek: '3' } };
      expect(bos(filtrarOrdenarOrdenesOso(lista, { ...base, boMeta: meta, orden: 'fact-month' }))).toEqual(['A', 'B', 'C']);
      const res = filtrarOrdenarOrdenesOso(lista, { ...base, boMeta: meta, boDraft: { A: { estimatedInvoiceMonth: '2027-01' }, C: { estimatedInvoiceWeek: '1' } }, orden: 'fact-month' });
      expect(bos(res)).toEqual(['C', 'B', 'A']);
    });

    test('eta: ascendente; sin ETA o inválida al final conservando el orden de entrada', () => {
      // BO1 (may), BO3 (ago), luego BO2 (sin eta), BO4 (sin eta), BO5 (inválida) en orden de entrada
      expect(filtrar({ orden: 'eta' })).toEqual(['BO1', 'BO3', 'BO2', 'BO4', 'BO5']);
    });

    test('eta: todas sin fecha no revienta (Infinity - Infinity) y conserva el orden', () => {
      const lista = [{ bo: 'Q' }, { bo: 'P' }];
      expect(bos(filtrarOrdenarOrdenesOso(lista, { ...base, orden: 'eta' }))).toEqual(['Q', 'P']);
    });
  });

  describe('texto', () => {
    test('busca en BO y cliente de la orden, sin mayúsculas ni espacios en los extremos', () => {
      expect(filtrar({ texto: ' bo1 ' })).toEqual(['BO1']);
      expect(filtrar({ texto: 'ALFA' })).toEqual(['BO1', 'BO2']);
      expect(filtrar({ texto: 'zeta' })).toEqual(['BO3']);
      expect(filtrar({ texto: 'nada' })).toEqual([]);
    });

    test('no busca en el cliente de la meta ni en proyecto (solo BO y customerName)', () => {
      expect(filtrar({ texto: 'meta cliente' })).toEqual([]);
      expect(filtrar({ texto: 'norte' })).toEqual([]);
    });

    test('para admin el texto se ignora', () => {
      expect(filtrar({ texto: 'bo1', esAdmin: true })).toEqual(['BO1', 'BO2', 'BO3', 'BO4', 'BO5']);
    });
  });

  describe('busqueda global', () => {
    test('busca en BO, cliente, proyecto y PO Axis de la meta (incluye borrador), SKU y MPN', () => {
      expect(filtrar({ busquedaGlobal: 'bo2' })).toEqual(['BO2']);
      expect(filtrar({ busquedaGlobal: 'zeta' })).toEqual(['BO3']);
      expect(filtrar({ busquedaGlobal: 'proyecto' })).toEqual(['BO1', 'BO3']);
      expect(filtrar({ busquedaGlobal: 'po-2' })).toEqual(['BO2']);
      expect(filtrar({ busquedaGlobal: 'sku-c' })).toEqual(['BO3']);
      expect(filtrar({ busquedaGlobal: 'mpn-a' })).toEqual(['BO1']);
      expect(filtrar({ busquedaGlobal: 'xyz' })).toEqual([]);
      expect(filtrar({ busquedaGlobal: 'borrador-nuevo', boDraft: { BO5: { projectName: 'Borrador-Nuevo' } } })).toEqual(['BO5']);
    });

    test('se combina con el texto (AND)', () => {
      expect(filtrar({ texto: 'alfa', busquedaGlobal: 'sku-b' })).toEqual(['BO2']);
      expect(filtrar({ texto: 'zeta', busquedaGlobal: 'sku-b' })).toEqual([]);
    });
  });

  describe('empresa', () => {
    test('coincidencia exacta del nombre efectivo, sin mayúsculas ni espacios', () => {
      expect(filtrar({ empresa: ' ALFA sa ' })).toEqual(['BO1', 'BO2']);
      expect(filtrar({ empresa: 'alfa' })).toEqual([]);
      expect(filtrar({ empresa: 'meta cliente' })).toEqual(['BO4']);
      expect(filtrar({ empresa: 'Sin cliente' })).toEqual([]);
      expect(filtrar({ empresa: 'sin cliente' }, ordenes)).toEqual([]);
    });

    test('"Sin cliente" calza con órdenes sin nombre en orden ni meta', () => {
      const lista = [{ bo: 'X' }, { bo: 'Y', customerName: 'W' }];
      expect(bos(filtrarOrdenarOrdenesOso(lista, { ...base, boMeta: {}, empresa: 'sin cliente' }))).toEqual(['X']);
    });

    test('el borrador del cliente cuenta', () => {
      expect(filtrar({ empresa: 'borr', boDraft: { BO4: { customerName: 'Borr' } } })).toEqual(['BO4']);
    });
  });

  describe('estado', () => {
    test('activa / parcial / completa; all, vacío o undefined no filtran', () => {
      expect(filtrar({ estado: 'activa' })).toEqual(['BO2', 'BO4', 'BO5']);
      expect(filtrar({ estado: 'parcial' })).toEqual(['BO1']);
      expect(filtrar({ estado: 'completa' })).toEqual(['BO3']);
      expect(filtrar({ estado: 'all' })).toHaveLength(5);
      expect(filtrar({ estado: '' })).toHaveLength(5);
      expect(filtrar({ estado: undefined })).toHaveLength(5);
    });

    test('un estado con mayúsculas no calza (se espera en minúsculas)', () => {
      expect(filtrar({ estado: 'Activa' })).toEqual([]);
    });
  });

  describe('filtros rápidos', () => {
    test('sd-pending: todo lo que no sea "aplicado" en la meta guardada', () => {
      expect(filtrar({ filtroRapido: 'sd-pending' })).toEqual(['BO2', 'BO3', 'BO4', 'BO5']);
      // el borrador no cambia el estado S&D
      expect(filtrar({ filtroRapido: 'sd-pending', boDraft: { BO1: { sAndDStatus: 'pendiente' } } })).toEqual(['BO2', 'BO3', 'BO4', 'BO5']);
    });

    test('missing-project: proyecto vacío o solo espacios (borrador incluido)', () => {
      expect(filtrar({ filtroRapido: 'missing-project' })).toEqual(['BO2', 'BO4', 'BO5']);
      expect(filtrar({ filtroRapido: 'missing-project', boDraft: { BO2: { projectName: 'Ya tiene' }, BO1: { projectName: '' } } })).toEqual(['BO1', 'BO4', 'BO5']);
    });

    test('missing-po: PO Axis vacío', () => {
      expect(filtrar({ filtroRapido: 'missing-po' })).toEqual(['BO3', 'BO4', 'BO5']);
      expect(filtrar({ filtroRapido: 'missing-po', boDraft: { BO3: { poAxis: '  ' }, BO4: { poAxis: 'P' } } })).toEqual(['BO3', 'BO5']);
    });

    test('all, vacío y valores desconocidos no filtran', () => {
      expect(filtrar({ filtroRapido: 'all' })).toHaveLength(5);
      expect(filtrar({ filtroRapido: '' })).toHaveLength(5);
      expect(filtrar({ filtroRapido: undefined })).toHaveLength(5);
      expect(filtrar({ filtroRapido: 'inventado' })).toHaveLength(5);
    });
  });

  describe('mes de facturación', () => {
    test('calza el mes efectivo (estimatedInvoiceMonth, o fecha, o borrador)', () => {
      expect(filtrar({ mesFacturacion: '2026-09' })).toEqual(['BO1', 'BO2']);
      expect(filtrar({ mesFacturacion: '2026-10' })).toEqual(['BO3']);
      expect(filtrar({ mesFacturacion: '2027-01' })).toEqual([]);
      expect(filtrar({ mesFacturacion: '2026-10', boDraft: { BO1: { estimatedInvoiceMonth: '2026-10' } } })).toEqual(['BO1', 'BO3']);
    });

    test('vacío no filtra; las órdenes sin mes nunca calzan con un mes', () => {
      expect(filtrar({ mesFacturacion: '' })).toHaveLength(5);
      expect(filtrar({ mesFacturacion: '2026-09' })).not.toContain('BO4');
    });
  });

  describe('combinaciones', () => {
    test('estado + mes + rápido + orden', () => {
      expect(filtrar({ estado: 'parcial', mesFacturacion: '2026-09', filtroRapido: 'missing-po' })).toEqual([]);
      expect(filtrar({ mesFacturacion: '2026-09', filtroRapido: 'missing-project', orden: 'fact-month' })).toEqual(['BO2']);
      expect(filtrar({ estado: 'activa', filtroRapido: 'sd-pending', orden: 'porcentaje' })).toEqual(['BO2', 'BO4', 'BO5']);
      expect(filtrar({ empresa: 'alfa sa', orden: 'eta' })).toEqual(['BO1', 'BO2']);
    });

    test('el texto se aplica antes que empresa y estado', () => {
      expect(filtrar({ texto: 'bo2', empresa: 'alfa sa', estado: 'activa' })).toEqual(['BO2']);
      expect(filtrar({ texto: 'bo2', empresa: 'alfa sa', estado: 'parcial' })).toEqual([]);
    });
  });

  test('tolera órdenes sin bo ni líneas', () => {
    const lista = [{}, { bo: 'A' }];
    expect(filtrarOrdenarOrdenesOso(lista, { ...base, boMeta: {}, orden: 'bo' })).toHaveLength(2);
    expect(filtrarOrdenarOrdenesOso(lista, { ...base, boMeta: {}, filtroRapido: 'missing-po' })).toHaveLength(2);
  });
});
