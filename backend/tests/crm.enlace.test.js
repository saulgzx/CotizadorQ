/**
 * Enlace automatico, cambio de estado y migracion inicial del CRM, con el repositorio
 * en memoria (tests/helpers/crmMemoria.js): logica real del modulo, sin BD.
 */
const { crearCrmMemoria } = require('./helpers/crmMemoria');
const enlace = require('../src/crm/enlace');
const esquema = require('../src/crm/esquema');

const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

let mem;
beforeEach(() => {
  mem = crearCrmMemoria();
  log.info.mockClear();
  log.warn.mockClear();
  log.error.mockClear();
});

const enlazarNueva = (cotizacionId, extra = {}) =>
  enlace.enlazarCotizacionNueva(mem.cliente, { cotizacionId, repo: mem.repo, log, ...extra });

describe('enlace automatico de una cotizacion nueva', () => {
  // Una cotizacion nueva (estado 'revision') crea su oportunidad en etapa 'nueva'
  // (antes se caracterizaba como 'cotizada'; cambio por la tabla de equivalencias).
  test('crea empresa, contacto y oportunidad "nueva" con titulo y marca', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: 'SONDA S.A.', cliente_nombre: 'Ana Soto', cliente_email: 'Ana@Sonda.cl', cliente_telefono: '+56 9 1' });
    const v = await enlazarNueva(cot.id, { marca: 'AXIS' });

    expect(v).toEqual({ empresa_id: 1, contacto_id: 1, oportunidad_id: 1, oportunidad_creada: true });
    expect(mem.estado.empresas[0]).toMatchObject({ nombre: 'SONDA S.A.', nombre_normalizado: 'sonda' });
    expect(mem.estado.contactos[0]).toMatchObject({ empresa_id: 1, nombre: 'Ana Soto', email: 'ana@sonda.cl', telefono: '+56 9 1' });
    expect(mem.estado.oportunidades[0]).toMatchObject({
      empresa_id: 1, contacto_id: 1, etapa: 'nueva', marca: 'AXIS', titulo: `Cotización #${cot.numero}`, cerrada_en: null
    });
    expect(mem.estado.cotizaciones[0]).toMatchObject({ empresa_id: 1, contacto_id: 1, oportunidad_id: 1 });
    expect(mem.cliente.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'COMMIT']);
  });

  test('reutiliza la empresa ("Sonda SA" = "SONDA S.A.") y el contacto (mismo email en otra caja)', async () => {
    const a = mem.agregarCotizacion({ cliente_empresa: 'SONDA S.A.', cliente_nombre: 'Ana', cliente_email: 'ana@sonda.cl' });
    const b = mem.agregarCotizacion({ cliente_empresa: 'Sonda SA', cliente_nombre: 'Ana Soto', cliente_email: 'ANA@SONDA.CL', cliente_telefono: '22' });
    await enlazarNueva(a.id);
    const v = await enlazarNueva(b.id);
    expect(v).toMatchObject({ empresa_id: 1, contacto_id: 1, oportunidad_id: 2 });
    expect(mem.estado.empresas).toHaveLength(1);
    expect(mem.estado.contactos).toHaveLength(1);
    expect(mem.estado.contactos[0].telefono).toBe('22'); // completa lo que faltaba
    expect(mem.estado.oportunidades).toHaveLength(2); // una oportunidad por cotizacion
  });

  test('sin email busca el contacto por nombre; con otro email no reutiliza un homonimo que ya tiene email', async () => {
    const a = mem.agregarCotizacion({ cliente_empresa: 'Ingeniería Ltda.', cliente_nombre: 'Luis  Diaz' });
    const b = mem.agregarCotizacion({ cliente_empresa: 'ingenieria', cliente_nombre: 'luis diaz' });
    const c = mem.agregarCotizacion({ cliente_empresa: 'ingenieria', cliente_nombre: 'Luis Diaz', cliente_email: 'luis@ing.cl' });
    const d = mem.agregarCotizacion({ cliente_empresa: 'ingenieria', cliente_nombre: 'Luis Diaz', cliente_email: 'otro@ing.cl' });
    const va = await enlazarNueva(a.id);
    const vb = await enlazarNueva(b.id);
    const vc = await enlazarNueva(c.id);
    const vd = await enlazarNueva(d.id);
    expect(vb.contacto_id).toBe(va.contacto_id);
    expect(vc.contacto_id).toBe(va.contacto_id); // el homonimo sin email recibe el email
    expect(mem.estado.contactos[0].email).toBe('luis@ing.cl');
    expect(vd.contacto_id).not.toBe(va.contacto_id); // otro email => otra persona
    expect(mem.estado.empresas).toHaveLength(1);
  });

  test('empresa vacia o "N/A": usa el nombre del cliente como empresa', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: 'N/A', cliente_nombre: 'Juan Pérez' });
    const v = await enlazarNueva(cot.id);
    expect(v.empresa_id).toBe(1);
    expect(mem.estado.empresas[0]).toMatchObject({ nombre: 'Juan Pérez', nombre_normalizado: 'juan perez' });
  });

  test('sin empresa ni cliente util ("-", vacio) no enlaza nada', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: '-', cliente_nombre: '  ', cliente_email: 'N/A' });
    expect(await enlazarNueva(cot.id)).toBeNull();
    expect(mem.estado.empresas).toHaveLength(0);
    expect(mem.estado.cotizaciones[0].oportunidad_id).toBeNull();
  });

  test('cliente "N/A" con email: el contacto se llama como su email', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Globex', cliente_nombre: 'N/A', cliente_email: 'compras@globex.cl' });
    await enlazarNueva(cot.id);
    expect(mem.estado.contactos[0]).toMatchObject({ nombre: 'compras@globex.cl', email: 'compras@globex.cl' });
  });

  test('respeta oportunidad_id del body: no crea oportunidad, usa la empresa de la oportunidad y avanza "nueva" a "cotizada"', async () => {
    const empresa = await mem.repo.insertarEmpresa(null, { nombre: 'Sonda', nombre_normalizado: 'sonda' });
    const op = await mem.repo.insertarOportunidad(null, { empresa_id: empresa.id, titulo: 'Proyecto', etapa: 'nueva', marca: 'QNAP' });
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Otra Empresa', cliente_nombre: 'Ana', cliente_email: 'ana@sonda.cl' });

    const v = await enlazarNueva(cot.id, { oportunidadId: String(op.id), marca: 'AXIS' });

    expect(v).toEqual({ empresa_id: empresa.id, contacto_id: 1, oportunidad_id: op.id, oportunidad_creada: false });
    expect(mem.estado.oportunidades).toHaveLength(1);
    expect(mem.estado.oportunidades[0]).toMatchObject({ etapa: 'cotizada', marca: 'MIXTA', contacto_id: 1 });
    expect(mem.estado.cotizaciones[0].estado).toBe('enviada'); // derivado de la etapa de la oportunidad
    expect(mem.estado.empresas.map((e) => e.nombre)).toEqual(['Sonda']); // "Otra Empresa" no se crea
    expect(mem.estado.contactos[0].empresa_id).toBe(empresa.id);
  });

  test('oportunidad_id inexistente o invalido: crea una oportunidad nueva y lo registra', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Globex', cliente_nombre: 'Eva' });
    const v = await enlazarNueva(cot.id, { oportunidadId: 999 });
    expect(v.oportunidad_creada).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'crm_oportunidad_inexistente' }), expect.any(String));

    const otra = mem.agregarCotizacion({ cliente_empresa: 'Globex', cliente_nombre: 'Eva' });
    const v2 = await enlazarNueva(otra.id, { oportunidadId: 'abc' });
    expect(v2.oportunidad_creada).toBe(true);
  });

  test('una cotizacion ya enlazada (p. ej. por la migracion) no se vuelve a enlazar', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Globex', cliente_nombre: 'Eva' });
    await enlazarNueva(cot.id);
    expect(await enlazarNueva(cot.id)).toBeNull();
    expect(mem.estado.oportunidades).toHaveLength(1);
  });

  test('si el CRM falla a mitad de camino: devuelve null, registra el error, hace ROLLBACK y no deja nada a medias', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Globex', cliente_nombre: 'Eva', cliente_email: 'eva@globex.cl' });
    mem.fallarEn('insertarOportunidad');

    await expect(enlazarNueva(cot.id)).resolves.toBeNull();

    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'crm_enlace_error', cotizacion_id: cot.id }), expect.any(String));
    expect(mem.cliente.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(mem.estado.empresas).toHaveLength(0); // la empresa creada antes del fallo se deshizo
    expect(mem.estado.contactos).toHaveLength(0);
    expect(mem.estado.cotizaciones[0].empresa_id).toBeNull();
  });

  test('nunca lanza aunque falle el propio BEGIN', async () => {
    const cliente = { query: jest.fn().mockRejectedValue(new Error('conexion perdida')) };
    await expect(enlace.enlazarCotizacionNueva(cliente, { cotizacionId: 1, repo: mem.repo, log })).resolves.toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
});

describe('cambio de etapa desde la cotizacion (PATCH /api/cotizaciones/:id/estado)', () => {
  // La etapa de la oportunidad manda; cotizaciones.estado se deriva de ella.
  const conOportunidad = async (etapa = 'nueva', extra = {}) => {
    const empresa = await mem.repo.insertarEmpresa(null, { nombre: 'Sonda', nombre_normalizado: 'sonda' });
    const op = await mem.repo.insertarOportunidad(null, { empresa_id: empresa.id, titulo: 'X', etapa, ...extra });
    const a = mem.agregarCotizacion({ cliente_empresa: 'Sonda', estado: 'revision' });
    const b = mem.agregarCotizacion({ cliente_empresa: 'Sonda', estado: 'revision' });
    for (const c of [a, b]) await mem.repo.vincularCotizacion(null, c.id, { empresa_id: empresa.id, contacto_id: null, oportunidad_id: op.id });
    return { op, a, b };
  };
  const cambiar = (cotizacionId, opciones) =>
    enlace.cambiarEtapaDeCotizacion(mem.pool, { cotizacionId, repo: mem.repo, log, ...opciones });

  test('forma nueva: cambia la etapa con las reglas del CRM y deriva el estado de TODAS sus cotizaciones', async () => {
    const { a, b } = await conOportunidad('nueva');
    const res = await cambiar(a.id, { etapa: 'negociacion' });
    expect(res).toMatchObject({ id: a.id, estado: 'enviada', etapa: 'negociacion', motivo_perdida: null });
    expect(mem.estado.oportunidades[0]).toMatchObject({ etapa: 'negociacion', cerrada_en: null });
    expect(mem.estado.cotizaciones.find((c) => c.id === b.id).estado).toBe('enviada');
  });

  test('perdida con motivo: cierra; luego reabrir (perdida -> nueva) borra motivo y cerrada_en', async () => {
    const { a } = await conOportunidad('cotizada');
    const perdida = await cambiar(a.id, { etapa: 'perdida', motivoPerdida: 'Precio' });
    expect(perdida).toMatchObject({ estado: 'rechazada', etapa: 'perdida', motivo_perdida: 'Precio' });
    expect(mem.estado.oportunidades[0].cerrada_en).toBeInstanceOf(Date);

    const reabierta = await cambiar(a.id, { etapa: 'nueva' });
    expect(reabierta).toMatchObject({ estado: 'revision', etapa: 'nueva', motivo_perdida: null });
    expect(mem.estado.oportunidades[0]).toMatchObject({ etapa: 'nueva', cerrada_en: null, motivo_perdida: null });
  });

  test('ganada -> cotizada tambien reabre', async () => {
    const { a } = await conOportunidad('ganada', { cerrada_en: new Date('2026-01-01T00:00:00Z') });
    const res = await cambiar(a.id, { etapa: 'cotizada' });
    expect(res).toMatchObject({ estado: 'enviada', etapa: 'cotizada' });
    expect(mem.estado.oportunidades[0].cerrada_en).toBeNull();
  });

  test('las reglas del CRM siguen valiendo: perdida sin ningun motivo => 400', async () => {
    const { a } = await conOportunidad('cotizada');
    await expect(cambiar(a.id, { etapa: 'perdida' })).rejects.toMatchObject({ status: 400 });
    expect(mem.estado.oportunidades[0].etapa).toBe('cotizada'); // ROLLBACK
  });

  test('forma heredada: rechazada usa el motivo por defecto; si la etapa ya deriva ese estado no se toca', async () => {
    const { a } = await conOportunidad('negociacion');
    // 'enviada' con la oportunidad en negociacion: no retrocede a cotizada.
    await cambiar(a.id, { etapa: 'cotizada', estadoHeredado: 'enviada', motivoPorDefecto: 'Rechazada en el cotizador' });
    expect(mem.estado.oportunidades[0].etapa).toBe('negociacion');
    expect(mem.estado.cotizaciones[0].estado).toBe('enviada');

    await cambiar(a.id, { etapa: 'perdida', estadoHeredado: 'rechazada', motivoPorDefecto: 'Rechazada en el cotizador' });
    expect(mem.estado.oportunidades[0]).toMatchObject({ etapa: 'perdida', motivo_perdida: 'Rechazada en el cotizador' });
  });

  test('forma heredada sobre una perdida con motivo propio: no lo pisa', async () => {
    const { a } = await conOportunidad('perdida', { motivo_perdida: 'Plazo' });
    await cambiar(a.id, { etapa: 'perdida', estadoHeredado: 'rechazada', motivoPorDefecto: 'Rechazada en el cotizador' });
    expect(mem.estado.oportunidades[0].motivo_perdida).toBe('Plazo');
  });

  test('sin oportunidad: la enlaza (crea la oportunidad) y luego aplica la etapa pedida', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: 'Globex', cliente_nombre: 'Eva', estado: 'revision' });
    const res = await cambiar(cot.id, { etapa: 'negociacion' });
    expect(res).toMatchObject({ oportunidad_id: 1, etapa: 'negociacion', estado: 'enviada' });
    expect(mem.estado.oportunidades).toHaveLength(1);
  });

  test('sin oportunidad y sin datos para enlazar: guarda solo el estado derivado', async () => {
    const cot = mem.agregarCotizacion({ cliente_empresa: '-', cliente_nombre: '', estado: 'revision' });
    const res = await cambiar(cot.id, { etapa: 'ganada' });
    expect(res).toMatchObject({ oportunidad_id: null, estado: 'aprobada', etapa: 'ganada', motivo_perdida: null });
    expect(mem.estado.oportunidades).toHaveLength(0);
  });

  test('cotizacion inexistente: null', async () => {
    expect(await cambiar(999, { etapa: 'nueva' })).toBeNull();
  });

  test('aplicarEtapaOportunidad dentro de una transaccion ajena: oportunidad inexistente => null', async () => {
    expect(await enlace.aplicarEtapaOportunidad(null, { oportunidadId: 42, etapa: 'ganada', repo: mem.repo })).toBeNull();
  });

  test('derivarEstadoSinFallar: si la BD falla, registra y devuelve null', async () => {
    mem.fallarEn('derivarEstadoCotizaciones');
    await expect(enlace.derivarEstadoSinFallar(null, 1, { repo: mem.repo, log })).resolves.toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'crm_estado_error' }), expect.any(String));
  });
});

describe('migracion inicial', () => {
  const sembrar = () => {
    mem.agregarCotizacion({ cliente_empresa: 'SONDA S.A.', cliente_nombre: 'Ana', cliente_email: 'ana@sonda.cl', estado: 'aprobada', origenes: ['AXIS'], created_at: new Date('2026-01-05T10:00:00Z') });
    mem.agregarCotizacion({ cliente_empresa: 'Sonda SA', cliente_nombre: 'Ana', cliente_email: 'ANA@sonda.cl', estado: 'rechazada', origenes: ['QNAP'], created_at: new Date('2026-02-05T10:00:00Z') });
    mem.agregarCotizacion({ cliente_empresa: 'sonda', cliente_nombre: 'Pedro', estado: 'enviada', origenes: ['AXIS', 'QNAP'] });
    mem.agregarCotizacion({ cliente_empresa: 'N/A', cliente_nombre: 'Juan Pérez', estado: 'pendiente' });
    mem.agregarCotizacion({ cliente_empresa: '', cliente_nombre: '-', estado: 'revision' });
    mem.agregarCotizacion({ cliente_empresa: 'Ingeniería Ltda.', cliente_nombre: 'Luis', estado: 'revision' });
    mem.agregarCotizacion({ cliente_empresa: 'ingenieria', cliente_nombre: 'Luis', estado: 'revision' });
  };
  const migrar = (opciones = {}) => esquema.migrarCotizaciones(mem.pool, { repo: mem.repo, log, tamanoLote: 2, ...opciones });

  test('agrupa empresas por nombre normalizado y mapea estado -> etapa con las fechas de la cotizacion', async () => {
    sembrar();
    const resumen = await migrar();
    expect(resumen).toMatchObject({ procesadas: 7, enlazadas: 6, omitidas: 1, errores: 0, lotes: 4 });
    expect(mem.estado.empresas.map((e) => e.nombre_normalizado)).toEqual(['sonda', 'juan perez', 'ingenieria']);
    expect(mem.estado.contactos.map((c) => c.nombre)).toEqual(['Ana', 'Pedro', 'Juan Pérez', 'Luis']);

    const ops = mem.estado.oportunidades;
    expect(ops.map((o) => [o.etapa, o.marca, o.motivo_perdida])).toEqual([
      ['ganada', 'AXIS', null],
      ['perdida', 'QNAP', 'Rechazada (migrado)'],
      ['cotizada', 'MIXTA', null], // enviada
      ['nueva', null, null], // pendiente
      ['nueva', null, null], // revision
      ['nueva', null, null] // revision
    ]);
    expect(ops[0].etapa_desde).toEqual(new Date('2026-01-05T10:00:00Z'));
    expect(ops[0].cerrada_en).toEqual(new Date('2026-01-05T10:00:00Z'));
    expect(ops[0].created_at).toEqual(new Date('2026-01-05T10:00:00Z'));
    expect(ops[1].cerrada_en).toEqual(new Date('2026-02-05T10:00:00Z'));
    expect(ops[2].cerrada_en).toBeNull();
  });

  test('es idempotente: la segunda corrida no crea nada', async () => {
    sembrar();
    await migrar();
    const antes = JSON.stringify(mem.estado);
    const segunda = await migrar();
    expect(segunda).toMatchObject({ procesadas: 1, enlazadas: 0, omitidas: 1 }); // solo la que no tiene nombre
    expect(JSON.stringify(mem.estado)).toBe(antes);
  });

  test('una cotizacion que falla se salta (ROLLBACK TO SAVEPOINT) y el resto sigue', async () => {
    sembrar();
    let llamadas = 0;
    const original = mem.repo.insertarOportunidad;
    mem.repo.insertarOportunidad = async (...args) => {
      llamadas += 1;
      if (llamadas === 2) throw new Error('fallo puntual');
      return original(...args);
    };
    const resumen = await migrar();
    expect(resumen).toMatchObject({ enlazadas: 5, errores: 1, omitidas: 1 });
    expect(mem.estado.cotizaciones[1].oportunidad_id).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'crm_migracion_cotizacion_error', cotizacion_id: 2 }), expect.any(String));
    // En la siguiente corrida se completa.
    mem.repo.insertarOportunidad = original;
    expect(await migrar()).toMatchObject({ enlazadas: 1 });
  });

  test('si se cae la BD a mitad: registra el error y no lanza', async () => {
    sembrar();
    mem.fallarEn('loteCotizacionesSinEnlace');
    await expect(migrar()).resolves.toMatchObject({ procesadas: 0 });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'crm_migracion_error' }), expect.any(String));
  });

  test('prepararEsquema: corre todo el DDL y si algo falla devuelve false sin lanzar', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    expect(await esquema.prepararEsquema(pool, { log })).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(esquema.SENTENCIAS.length);
    expect(esquema.SENTENCIAS.every((sql) => /IF NOT EXISTS/.test(sql))).toBe(true);

    // Con pool.connect: conexion propia con lock_timeout, que se resetea antes de devolverla.
    const cliente = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    const conConexion = { connect: jest.fn().mockResolvedValue(cliente), query: jest.fn() };
    expect(await esquema.prepararEsquema(conConexion, { log })).toBe(true);
    const sqls = cliente.query.mock.calls.map(([sql]) => sql);
    expect(sqls[0]).toBe("SET lock_timeout = '10s'");
    expect(sqls[sqls.length - 1]).toBe('RESET lock_timeout');
    expect(sqls).toHaveLength(esquema.SENTENCIAS.length + 2);
    expect(cliente.release).toHaveBeenCalledTimes(1);
    expect(conConexion.query).not.toHaveBeenCalled();

    const rota = { query: jest.fn().mockRejectedValue(new Error('permission denied')) };
    expect(await esquema.prepararEsquema(rota, { log })).toBe(false);
    const inicio = await esquema.iniciarCrm(rota, { log });
    expect(inicio).toEqual({ esquema: false, migracion: null });
  });
});
