/**
 * OOR: servicio (versiones, revisiones, estabilidad, limpieza) con el repositorio en memoria.
 * La comparacion y el cruce con BO ya se prueban en oor.comparar.test.js; aqui se prueba
 * CUANDO se guarda, CUANDO se anuncia y como avanza la base.
 */
const servicio = require('../src/oor/servicio');
const { crearOorMemoria } = require('./helpers/oorMemoria');

const CABECERA = ['Order Confirmation', 'Del No', 'Order No', 'Line No', 'Customer PO No', 'Created', 'Order Status', 'Status',
  'Sales Part', 'Sales Part Description', 'Sales Qty', 'Planned Ship Date', 'Planned Delivery Date', 'Days changed',
  'Previous Planned Deliver Date', 'Project Description'];
const fila = ({ orden = 9001, linea = 1, po = 575740, parte = '02317-004', cant = 1, despacho, estado = 'Released' }) =>
  ['Confirmed', 1, orden, linea, po, '09-04-2026', estado, estado, parte, 'AXIS Q6225-LE', cant, despacho, '', 0, '', ''];
const hoja = (...filas) => [[...CABECERA], ...filas.map(fila)];

const BO_SICE = {
  bo: 'BO-100', po_axis: '575740', customer_name: 'SICE', project_name: 'Metro', customer_po: 'OC-77',
  estimated_invoice_month: '2026-02', estimated_invoice_date: null, estimated_invoice_week: 2,
  deleted: false, invoiced: false
};

const T0 = new Date('2026-05-01T10:00:00Z');
const despues = (seg, desde = T0) => new Date(desde.getTime() + seg * 1000);

let mem;
const registrar = (filas, ahora) => servicio.registrarLectura(mem.pool, filas, { ahora, repo: mem.repo });
const pendiente = (ahora, extra = {}) => servicio.pendiente(mem.pool, { ahora, repo: mem.repo, ...extra });

beforeEach(() => {
  mem = crearOorMemoria({ bos: [BO_SICE] });
});

describe('registrarLectura', () => {
  test('guarda la primera version y devuelve la vigente', async () => {
    const r = await registrar(hoja({ despacho: '15-1-2026' }), T0);
    expect(r).toMatchObject({ id: 1, total: 1, nuevo: true, tomado_en: T0.toISOString() });
    expect(mem.estado.snapshots).toHaveLength(1);
    expect(mem.estado.snapshots[0].lineas[0]).toMatchObject({ orden: '9001', po: '575740', despacho: '2026-01-15' });
  });

  test('la misma version no se guarda dos veces (aunque cambie el orden de las filas)', async () => {
    const a = fila({ linea: 1, despacho: '15-1-2026' });
    const b = fila({ linea: 2, despacho: '20-1-2026' });
    await registrar([CABECERA, a, b], T0);
    const r = await registrar([CABECERA, b, a], despues(60));
    expect(r).toMatchObject({ id: 1, nuevo: false });
    expect(mem.estado.snapshots).toHaveLength(1);
  });

  test('una version distinta inserta otro snapshot', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    const r = await registrar(hoja({ despacho: '10-6-2026' }), despues(300));
    expect(r).toMatchObject({ id: 2, nuevo: true });
    expect(mem.estado.snapshots).toHaveLength(2);
  });

  test('un OOR vacio (o sin cabecera valida) jamas se guarda ni borra nada', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    for (const vacio of [[], [[...CABECERA]], [['otra', 'cosa']], null, undefined]) {
      expect(await registrar(vacio, despues(500))).toEqual({ motivo: 'sin_datos' });
    }
    expect(mem.estado.snapshots).toHaveLength(1);
    expect(mem.estado.snapshots[0].total).toBe(1);
  });

  test('limpieza: quedan los 10 snapshots mas recientes y los que una revision referencia', async () => {
    const dia = (n) => `${String((n % 27) + 1)}-${(n % 12) + 1}-2027`;
    await registrar(hoja({ despacho: '15-1-2026' }), T0); // snapshot 1
    await pendiente(despues(1000)); // primera vez: revision automatica sobre el 1
    for (let i = 2; i <= 15; i += 1) await registrar(hoja({ despacho: dia(i * 3), cant: i }), despues(i * 600));
    const ids = mem.estado.snapshots.map((s) => s.id);
    // El 1 se conserva por la revision; luego los 10 mas recientes (6..15).
    expect(ids).toEqual([1, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  test('limpieza: solo se conservan las 60 revisiones mas recientes', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(1000));
    for (let i = 2; i <= 70; i += 1) {
      const r = await registrar(hoja({ despacho: '15-1-2026', cant: i }), despues(i * 1000));
      await servicio.marcarVisto(mem.pool, { hastaId: r.id, usuarioId: 1, ahora: despues(i * 1000 + 1), repo: mem.repo });
    }
    // La limpieza corre al guardar una version nueva: la ultima revision aun no se ha podado (61).
    expect(mem.estado.revisiones).toHaveLength(61);
    await registrar(hoja({ despacho: '15-1-2026', cant: 999 }), despues(80000));
    expect(mem.estado.revisiones).toHaveLength(60);
    expect(mem.estado.revisiones[0].id).toBe(11); // las 10 mas viejas se fueron
    // Ningun snapshot referenciado por una revision conservada se perdio.
    const ids = new Set(mem.estado.snapshots.map((s) => s.id));
    for (const r of mem.estado.revisiones) {
      expect(ids.has(r.hasta_snapshot_id)).toBe(true);
      if (r.desde_snapshot_id) expect(ids.has(r.desde_snapshot_id)).toBe(true);
    }
  });
});

describe('pendiente', () => {
  test('sin ninguna version: sin_datos', async () => {
    expect(await pendiente(T0)).toEqual({ hay: false, motivo: 'sin_datos' });
    expect(mem.estado.revisiones).toHaveLength(0);
  });

  test('primera vez: no hay pop-up y se crea la revision automatica que sirve de base', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    expect(await pendiente(despues(10))).toEqual({ hay: false, motivo: 'primera_vez' });
    expect(mem.estado.revisiones).toEqual([
      expect.objectContaining({ desde_snapshot_id: null, hasta_snapshot_id: 1, automatica: true })
    ]);
    // La segunda consulta ya no es "primera vez".
    expect(await pendiente(despues(20))).toEqual({ hay: false, motivo: 'sin_cambios' });
    expect(mem.estado.revisiones).toHaveLength(1);
  });

  test('sin cambios: la version vigente es la misma que la base', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '15-1-2026' }), despues(400));
    expect(await pendiente(despues(500))).toEqual({ hay: false, motivo: 'sin_cambios' });
  });

  test('atraso cruzado con una BO: SICE, PO 575740, de 15-1-2026 a 10-6-2026 afecta la facturacion de 2026-02', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
    const r = await pendiente(despues(400 + 120));
    expect(r.hay).toBe(true);
    expect(r.desde).toEqual({ id: 1, tomado_en: T0.toISOString() });
    expect(r.hasta).toEqual({ id: 2, tomado_en: despues(400).toISOString() });
    expect(r.resumen).toMatchObject({ cambios: 1, atraso: 1, bos: 1, bosAtrasadas: 1, bosConFacturacionAfectada: 1, lineasSinBo: 0 });
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0]).toMatchObject({
      bo: 'BO-100',
      cliente: 'SICE',
      poAxis: '575740',
      poCliente: 'OC-77',
      mes: { antes: '2026-01', ahora: '2026-06' },
      dias: 146,
      facturacion: { mes: '2026-02', semana: 2, afectada: true }
    });
    expect(r.grupos[0].lineas[0]).toMatchObject({ tipo: 'atraso', dias: 146 });
    expect(r.sinBo).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  test('estabilizando: menos de 90 s no se anuncia; revisar_en_seg es lo que falta (minimo 15); luego estable', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
    expect(await pendiente(despues(400 + 30))).toEqual({ hay: false, motivo: 'estabilizando', revisar_en_seg: 60 });
    expect(await pendiente(despues(400 + 80))).toEqual({ hay: false, motivo: 'estabilizando', revisar_en_seg: 15 });
    expect(await pendiente(despues(400))).toMatchObject({ motivo: 'estabilizando', revisar_en_seg: 90 });
    expect((await pendiente(despues(400 + 89))).motivo).toBe('estabilizando');
    expect((await pendiente(despues(400 + 90))).hay).toBe(true);
  });

  test('si el OOR cambia otra vez mientras se estabiliza, el reloj arranca de nuevo', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026', cant: 1 }, { linea: 2, despacho: '1-1-2026' }), despues(400));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(460)); // segundo paso del pegado
    expect((await pendiente(despues(460 + 60))).motivo).toBe('estabilizando');
    expect((await pendiente(despues(460 + 90))).hay).toBe(true);
  });

  test('cambio que solo toca lineas cerradas: avanza la base sin avisar', async () => {
    const v1 = [[...CABECERA], fila({ despacho: '15-1-2026' }), fila({ linea: 2, despacho: '1-3-2026', estado: 'Invoiced' })];
    const v2 = [[...CABECERA], fila({ despacho: '15-1-2026' }), fila({ linea: 2, despacho: '9-9-2026', estado: 'Invoiced' })];
    await registrar(v1, T0);
    await pendiente(despues(10));
    await registrar(v2, despues(400));
    expect(await pendiente(despues(600))).toEqual({ hay: false, motivo: 'sin_cambios' });
    expect(mem.estado.revisiones).toHaveLength(2);
    expect(mem.estado.revisiones[1]).toMatchObject({ desde_snapshot_id: 1, hasta_snapshot_id: 2, automatica: true });
    // La base ya avanzo: otra consulta no crea mas revisiones.
    expect(await pendiente(despues(700))).toEqual({ hay: false, motivo: 'sin_cambios' });
    expect(mem.estado.revisiones).toHaveLength(2);
  });

  test('sin BO asociada, el cambio sale en sinBo', async () => {
    mem.ponerBos([]);
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
    const r = await pendiente(despues(600));
    expect(r.hay).toBe(true);
    expect(r.grupos).toEqual([]);
    expect(r.sinBo).toHaveLength(1);
    expect(r.sinBo[0].po).toBe('575740');
    expect(r.resumen.lineasSinBo).toBe(1);
  });

  test('BO eliminadas o facturadas no cruzan', async () => {
    mem.ponerBos([
      { ...BO_SICE, bo: 'BO-ELIM', deleted: true },
      { ...BO_SICE, bo: 'BO-FACT', invoiced: true },
      { ...BO_SICE, bo: 'BO-SINPO', po_axis: '  ' }
    ]);
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
    const r = await pendiente(despues(600));
    expect(r.grupos).toEqual([]);
    expect(r.sinBo[0].po).toBe('575740');
  });

  test('mes de facturacion: se deriva de la fecha estimada si el mes esta vacio; el mes guardado manda', async () => {
    mem.ponerBos([{ ...BO_SICE, estimated_invoice_month: null, estimated_invoice_date: '2026-03-20' }]);
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
    let r = await pendiente(despues(600));
    expect(r.grupos[0].facturacion).toMatchObject({ mes: '2026-03', afectada: true });

    mem.ponerBos([{ ...BO_SICE, estimated_invoice_month: '2026-08', estimated_invoice_date: '2026-03-20' }]);
    r = await pendiente(despues(600));
    expect(r.grupos[0].facturacion).toMatchObject({ mes: '2026-08', afectada: false });

    mem.ponerBos([{ ...BO_SICE, estimated_invoice_month: '', estimated_invoice_date: null }]);
    r = await pendiente(despues(600));
    expect(r.grupos[0].facturacion).toMatchObject({ mes: null, afectada: null });
  });

  test('bos pasadas a mano tambien se normalizan', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
    const r = await pendiente(despues(600), { bos: [{ ...BO_SICE, estimated_invoice_month: '', estimated_invoice_date: '2026-02-10' }] });
    expect(r.grupos[0].facturacion.mes).toBe('2026-02');
  });
});

describe('mesFacturacion', () => {
  test('mes valido, fecha texto, objeto Date y basura', () => {
    expect(servicio.mesFacturacion({ estimated_invoice_month: '2026-04' })).toBe('2026-04');
    expect(servicio.mesFacturacion({ estimated_invoice_month: '', estimated_invoice_date: '2026-11-30' })).toBe('2026-11');
    expect(servicio.mesFacturacion({ estimated_invoice_date: new Date(2026, 6, 15) })).toBe('2026-07');
    expect(servicio.mesFacturacion({ estimated_invoice_month: 'abc', estimated_invoice_date: null })).toBe('');
    expect(servicio.mesFacturacion({})).toBe('');
  });
});

describe('marcarVisto', () => {
  const llegaCambio = async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
  };
  const visto = (hastaId, extra = {}) =>
    servicio.marcarVisto(mem.pool, { hastaId, usuarioId: 1, ahora: despues(700), repo: mem.repo, ...extra });

  test('crea la revision con la base actual como desde y el resumen; despues ya no hay pendiente', async () => {
    await llegaCambio();
    const p = await pendiente(despues(600));
    const r = await visto(p.hasta.id);
    expect(r).toEqual({ revision_id: 2 });
    expect(mem.estado.revisiones[1]).toMatchObject({
      desde_snapshot_id: 1,
      hasta_snapshot_id: 2,
      usuario_id: 1,
      automatica: false,
      resumen: expect.objectContaining({ cambios: 1, atraso: 1, bosConFacturacionAfectada: 1 })
    });
    expect(await pendiente(despues(800))).toEqual({ hay: false, motivo: 'sin_cambios' });
  });

  test('es idempotente: marcar dos veces lo mismo no crea otra revision', async () => {
    await llegaCambio();
    const a = await visto(2);
    const b = await visto(2);
    expect(b).toEqual(a);
    expect(mem.estado.revisiones).toHaveLength(2);
  });

  test('doble clic simultaneo tampoco duplica', async () => {
    await llegaCambio();
    const [a, b] = await Promise.all([visto(2), visto(2)]);
    expect(a).toEqual(b);
    expect(mem.estado.revisiones).toHaveLength(2);
  });

  test('400 si la version no existe o es anterior a la base', async () => {
    await llegaCambio();
    await expect(visto(99)).rejects.toMatchObject({ status: 400 });
    await expect(visto(0)).rejects.toMatchObject({ status: 400 });
    await expect(visto(undefined)).rejects.toMatchObject({ status: 400 });
    await visto(2);
    await expect(visto(1)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/anterior/) });
    expect(mem.estado.revisiones).toHaveLength(2);
  });

  test('dos cambios seguidos sin revisar se informan JUNTOS (base -> vigente)', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '1-4-2026' }), despues(400));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(5000));
    const r = await pendiente(despues(5200));
    expect(r.desde.id).toBe(1);
    expect(r.hasta.id).toBe(3);
    expect(r.grupos[0]).toMatchObject({ mes: { antes: '2026-01', ahora: '2026-06' }, dias: 146 });
    expect(r.resumen.cambios).toBe(1); // una linea, un cambio: de 15-1 a 10-6
  });

  test('revisar una version intermedia deja pendiente solo lo que vino despues', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '1-4-2026' }), despues(400));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(5000));
    await visto(2);
    const r = await pendiente(despues(5200));
    expect(r).toMatchObject({ hay: true, desde: { id: 2 }, hasta: { id: 3 } });
    expect(r.grupos[0]).toMatchObject({ mes: { antes: '2026-04', ahora: '2026-06' } });
  });
});

describe('historial y detalle', () => {
  const escenario = async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
    await servicio.marcarVisto(mem.pool, { hastaId: 2, usuarioId: 1, ahora: despues(700), repo: mem.repo });
    await registrar(hoja({ despacho: '10-7-2026' }), despues(5000));
    await servicio.marcarVisto(mem.pool, { hastaId: 3, usuarioId: 1, ahora: despues(5200), repo: mem.repo });
  };

  test('historial: solo revisiones no automaticas, de la mas reciente a la mas antigua', async () => {
    await escenario();
    const items = await servicio.historial(mem.pool, { repo: mem.repo });
    expect(items.map((i) => i.id)).toEqual([3, 2]);
    expect(items[1]).toEqual({
      id: 2,
      visto_en: despues(700).toISOString(),
      desde: { id: 1, tomado_en: T0.toISOString() },
      hasta: { id: 2, tomado_en: despues(400).toISOString() },
      resumen: expect.objectContaining({ cambios: 1, atraso: 1 })
    });
    expect(await servicio.historial(mem.pool, { limite: 1, repo: mem.repo })).toHaveLength(1);
  });

  test('detalle: recalcula desde los dos snapshots, con la configuracion actual de las BO', async () => {
    await escenario();
    const d = await servicio.detalle(mem.pool, 2, { repo: mem.repo });
    expect(d).toMatchObject({
      hay: true,
      visto_en: despues(700).toISOString(),
      desde: { id: 1 },
      hasta: { id: 2 }
    });
    expect(d.grupos[0]).toMatchObject({ bo: 'BO-100', dias: 146, mes: { antes: '2026-01', ahora: '2026-06' } });
    // Si el dueno cambio la facturacion despues, el detalle muestra la configuracion de hoy.
    mem.ponerBos([{ ...BO_SICE, estimated_invoice_month: '2026-12' }]);
    expect((await servicio.detalle(mem.pool, 2, { repo: mem.repo })).grupos[0].facturacion).toMatchObject({ mes: '2026-12', afectada: false });
  });

  test('detalle: 404 si no existe, si es la base inicial (sin version anterior) o si ya no estan los snapshots', async () => {
    await escenario();
    await expect(servicio.detalle(mem.pool, 999, { repo: mem.repo })).rejects.toMatchObject({ status: 404 });
    await expect(servicio.detalle(mem.pool, 1, { repo: mem.repo })).rejects.toMatchObject({ status: 404 });
    mem.estado.snapshots = mem.estado.snapshots.filter((s) => s.id !== 1);
    await expect(servicio.detalle(mem.pool, 2, { repo: mem.repo })).rejects.toMatchObject({ status: 404 });
  });
});

describe('marcarVisto sin base previa', () => {
  test('si nunca hubo revision, la crea con desde null y sin resumen', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    const r = await servicio.marcarVisto(mem.pool, { hastaId: 1, usuarioId: 1, ahora: T0, repo: mem.repo });
    expect(r).toEqual({ revision_id: 1 });
    expect(mem.estado.revisiones[0]).toMatchObject({ desde_snapshot_id: null, automatica: false, resumen: null });
  });
});


describe('pendiente con sinEspera', () => {
  test('no aplica la espera de estabilidad (boton Actualizar OOR)', async () => {
    await registrar(hoja({ despacho: '15-1-2026' }), T0);
    await pendiente(despues(10));
    await registrar(hoja({ despacho: '10-6-2026' }), despues(400));
    expect((await pendiente(despues(405))).motivo).toBe('estabilizando');
    expect((await pendiente(despues(405), { sinEspera: true })).hay).toBe(true);
  });
});
