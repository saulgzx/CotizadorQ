/**
 * CRM: las ordenes de OSO reflejadas como oportunidades ganadas.
 * Usa el repositorio en memoria (helpers/crmMemoria), sin PostgreSQL.
 */
const { crearCrmMemoria } = require('./helpers/crmMemoria');
const { sincronizarOrdenes, tituloPara, montoDe, totalesPorBo } = require('../src/crm/ordenes');

const logMudo = { info: () => {}, warn: () => {}, error: () => {} };

const sincronizar = (memoria, montos) =>
  sincronizarOrdenes(memoria.pool, { repo: memoria.repo, log: logMudo, montos });

const nuevaEmpresa = (memoria, nombre = 'Dimerc', normalizado = 'dimerc') =>
  memoria.repo.insertarEmpresa(memoria.pool, { nombre, nombre_normalizado: normalizado });

describe('titulo y monto de una orden', () => {
  test('el titulo incluye la OC del cliente cuando viene', () => {
    expect(tituloPara({ bo: 'BO-1', customer_po: '4500123' })).toBe('Orden BO-1 · OC 4500123');
    expect(tituloPara({ bo: 'BO-1', customer_po: null })).toBe('Orden BO-1');
  });

  test('un monto de 0 o no numerico queda en null, no en 0', () => {
    expect(montoDe('1250.50')).toBe(1250.5);
    expect(montoDe(0)).toBeNull();
    expect(montoDe(null)).toBeNull();
    expect(montoDe('x')).toBeNull();
  });
});

describe('totalesPorBo', () => {
  test('suma monto unitario por cantidad de cada linea', () => {
    const totales = totalesPorBo([
      {
        bo: 'BO-1',
        lines: [
          { montoIntcomex: 500, orderQty: 50 },
          { montoIntcomex: 10.5, orderQty: 2 }
        ]
      }
    ]);
    expect(totales).toEqual({ 'BO-1': 25021 });
  });

  test('una linea sin monto o sin cantidad valida aporta 0', () => {
    const totales = totalesPorBo([
      {
        bo: 'BO-2',
        lines: [
          { montoIntcomex: 100, orderQty: 3 },
          { montoIntcomex: null, orderQty: 9 },
          { montoIntcomex: 50, orderQty: 0 },
          { montoIntcomex: 70, orderQty: 'x' },
          { orderQty: 4 }
        ]
      }
    ]);
    expect(totales).toEqual({ 'BO-2': 300 });
  });

  test('una orden sin ningun monto no aparece en el resultado', () => {
    const totales = totalesPorBo([
      { bo: 'BO-3', lines: [{ orderQty: 5 }, { montoIntcomex: 0, orderQty: 5 }] },
      { bo: 'BO-4', lines: [] },
      { bo: 'BO-5' }
    ]);
    expect(totales).toEqual({});
  });

  test('redondea a 2 decimales', () => {
    const totales = totalesPorBo([
      { bo: 'BO-6', lines: [{ montoIntcomex: 0.335, orderQty: 3 }, { montoIntcomex: 1.111, orderQty: 1 }] }
    ]);
    expect(totales['BO-6']).toBe(2.12);
  });

  test('tolera entradas vacias', () => {
    expect(totalesPorBo(undefined)).toEqual({});
    expect(totalesPorBo([])).toEqual({});
  });
});

describe('sincronizarOrdenes', () => {
  test('crea empresa y oportunidad ganada cuando el cliente no existe en el CRM', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-100', cliente: 'SONDA S.A.', customer_po: '4500999' });

    const resumen = await sincronizar(memoria, { 'BO-100': 3200 });

    expect(resumen).toMatchObject({ ordenes: 1, creadas: 1, errores: 0 });
    const [empresa] = memoria.estado.empresas;
    expect(empresa.nombre).toBe('SONDA S.A.');
    expect(empresa.nombre_normalizado).toBe('sonda');
    const [oportunidad] = memoria.estado.oportunidades;
    expect(oportunidad).toMatchObject({
      empresa_id: empresa.id,
      etapa: 'ganada',
      bo: 'BO-100',
      monto_orden: 3200,
      titulo: 'Orden BO-100 · OC 4500999'
    });
    expect(oportunidad.cerrada_en).toBeTruthy();
  });

  test('reusa la empresa existente aunque el nombre venga con otro sufijo legal', async () => {
    const memoria = crearCrmMemoria();
    await memoria.repo.insertarEmpresa(memoria.pool, {
      nombre: 'Sonda SpA',
      nombre_normalizado: 'sonda'
    });
    memoria.agregarOrden({ bo: 'BO-101', cliente: 'SONDA S.A.' });

    await sincronizar(memoria);

    expect(memoria.estado.empresas).toHaveLength(1);
    expect(memoria.estado.oportunidades).toHaveLength(1);
    expect(memoria.estado.oportunidades[0].empresa_id).toBe(memoria.estado.empresas[0].id);
  });

  test('es idempotente: correrla dos veces no duplica nada', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-102', cliente: 'Dimerc' });

    const primera = await sincronizar(memoria);
    const segunda = await sincronizar(memoria);

    expect(primera).toMatchObject({ creadas: 1 });
    expect(segunda).toMatchObject({ creadas: 0, sinCambio: 1 });
    expect(memoria.estado.oportunidades).toHaveLength(1);
    expect(memoria.estado.empresas).toHaveLength(1);
  });

  test('engancha la orden a la unica oportunidad abierta de la empresa en vez de duplicarla', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await memoria.repo.insertarEmpresa(memoria.pool, {
      nombre: 'Dimerc',
      nombre_normalizado: 'dimerc'
    });
    const abierta = await memoria.repo.insertarOportunidad(memoria.pool, {
      empresa_id: empresa.id,
      titulo: 'Cotización #65423',
      etapa: 'cotizada'
    });
    memoria.agregarOrden({ bo: 'BO-103', cliente: 'Dimerc' });

    const resumen = await sincronizar(memoria);

    expect(resumen).toMatchObject({ enlazadas: 1, creadas: 0 });
    expect(memoria.estado.oportunidades).toHaveLength(1);
    expect(memoria.estado.oportunidades[0]).toMatchObject({
      id: abierta.id,
      etapa: 'ganada',
      bo: 'BO-103',
      titulo: 'Cotización #65423'
    });
  });

  test('con dos oportunidades abiertas no adivina: crea una nueva para el BO', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await memoria.repo.insertarEmpresa(memoria.pool, {
      nombre: 'Dimerc',
      nombre_normalizado: 'dimerc'
    });
    for (const titulo of ['Cotización #1', 'Cotización #2']) {
      await memoria.repo.insertarOportunidad(memoria.pool, {
        empresa_id: empresa.id,
        titulo,
        etapa: 'cotizada'
      });
    }
    memoria.agregarOrden({ bo: 'BO-104', cliente: 'Dimerc' });

    const resumen = await sincronizar(memoria);

    expect(resumen).toMatchObject({ creadas: 1, enlazadas: 0 });
    expect(memoria.estado.oportunidades).toHaveLength(3);
    expect(memoria.estado.oportunidades.filter((o) => o.etapa === 'ganada')).toHaveLength(1);
  });

  test('una oportunidad ya cerrada no se toma como la que cerro la orden', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await memoria.repo.insertarEmpresa(memoria.pool, {
      nombre: 'Dimerc',
      nombre_normalizado: 'dimerc'
    });
    await memoria.repo.insertarOportunidad(memoria.pool, {
      empresa_id: empresa.id,
      titulo: 'Perdida vieja',
      etapa: 'perdida'
    });
    memoria.agregarOrden({ bo: 'BO-105', cliente: 'Dimerc' });

    const resumen = await sincronizar(memoria);

    expect(resumen).toMatchObject({ creadas: 1, enlazadas: 0 });
    expect(memoria.estado.oportunidades.find((o) => o.bo === 'BO-105').titulo).toBe('Orden BO-105');
  });

  test('ganar la oportunidad aprueba las cotizaciones ligadas', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await memoria.repo.insertarEmpresa(memoria.pool, {
      nombre: 'Dimerc',
      nombre_normalizado: 'dimerc'
    });
    const abierta = await memoria.repo.insertarOportunidad(memoria.pool, {
      empresa_id: empresa.id,
      titulo: 'Cotización #65423',
      etapa: 'cotizada'
    });
    const cotizacion = memoria.agregarCotizacion({ cliente_empresa: 'Dimerc', estado: 'enviada' });
    await memoria.repo.vincularCotizacion(memoria.pool, cotizacion.id, {
      empresa_id: empresa.id,
      contacto_id: null,
      oportunidad_id: abierta.id
    });
    memoria.agregarOrden({ bo: 'BO-106', cliente: 'Dimerc' });

    await sincronizar(memoria);

    expect(memoria.estado.cotizaciones[0].estado).toBe('aprobada');
  });

  test('una oportunidad de BO que quedo abierta se gana sin crear otra', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await memoria.repo.insertarEmpresa(memoria.pool, {
      nombre: 'Dimerc',
      nombre_normalizado: 'dimerc'
    });
    await memoria.repo.insertarOportunidad(memoria.pool, {
      empresa_id: empresa.id,
      titulo: 'Orden BO-107',
      etapa: 'negociacion',
      bo: 'BO-107'
    });
    memoria.agregarOrden({ bo: 'BO-107', cliente: 'Dimerc' });

    const resumen = await sincronizar(memoria);

    expect(resumen).toMatchObject({ ganadas: 1, creadas: 0 });
    expect(memoria.estado.oportunidades).toHaveLength(1);
    expect(memoria.estado.oportunidades[0].etapa).toBe('ganada');
  });

  test('una orden sin nombre de cliente se cuenta aparte y no inventa empresa', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-108', cliente: null });
    memoria.agregarOrden({ bo: 'BO-109', cliente: '   ' });

    const resumen = await sincronizar(memoria);

    expect(resumen).toMatchObject({ ordenes: 2, sinCliente: 2, creadas: 0 });
    expect(memoria.estado.empresas).toHaveLength(0);
    expect(memoria.estado.oportunidades).toHaveLength(0);
  });

  test('una orden que falla no arrastra a las demas', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-110', cliente: 'Dimerc' });
    memoria.agregarOrden({ bo: 'BO-111', cliente: 'Sonda' });
    const original = memoria.repo.buscarOportunidadPorBo;
    memoria.repo.buscarOportunidadPorBo = async (db, bo) => {
      if (bo === 'BO-110') throw new Error('fallo simulado');
      return original(db, bo);
    };

    const resumen = await sincronizar(memoria);

    expect(resumen).toMatchObject({ ordenes: 2, errores: 1, creadas: 1 });
    expect(memoria.estado.oportunidades).toHaveLength(1);
    expect(memoria.estado.oportunidades[0].bo).toBe('BO-111');
  });

  test('si no se pueden leer las ordenes devuelve resumen vacio sin lanzar', async () => {
    const memoria = crearCrmMemoria();
    memoria.repo.ordenesVigentes = async () => {
      throw new Error('sin base');
    };

    await expect(sincronizar(memoria)).resolves.toMatchObject({ ordenes: 0, errores: 0 });
  });

  test('sin mapa de montos la oportunidad nueva queda con monto null', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-120', cliente: 'Dimerc' });

    await sincronizar(memoria);

    expect(memoria.estado.oportunidades[0].monto_orden).toBeNull();
  });

  test('actualiza el monto de una oportunidad existente sin cotizacion cuando cambia', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-121', cliente: 'Dimerc' });
    await sincronizar(memoria); // la orden llega primero, sin precios

    const resumen = await sincronizar(memoria, { 'BO-121': 25000 });

    expect(resumen).toMatchObject({ montosActualizados: 1, sinCambio: 0, creadas: 0, errores: 0 });
    expect(memoria.estado.oportunidades).toHaveLength(1);
    expect(memoria.estado.oportunidades[0].monto_orden).toBe(25000);

    const otra = await sincronizar(memoria, { 'BO-121': 30000 });
    expect(otra).toMatchObject({ montosActualizados: 1 });
    expect(memoria.estado.oportunidades[0].monto_orden).toBe(30000);
  });

  test('con el mismo monto no cuenta ni escribe nada', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-122', cliente: 'Dimerc' });
    await sincronizar(memoria, { 'BO-122': 25000 });
    const espia = jest.spyOn(memoria.repo, 'guardarMontoOrden');

    const resumen = await sincronizar(memoria, { 'BO-122': 25000 });

    expect(resumen).toMatchObject({ montosActualizados: 0, sinCambio: 1 });
    expect(espia).not.toHaveBeenCalled();
  });

  test('sin total conocido o con total 0 no pisa el monto existente', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-123', cliente: 'Dimerc' });
    await sincronizar(memoria, { 'BO-123': 800 });

    await sincronizar(memoria);
    const resumen = await sincronizar(memoria, { 'BO-123': 0 });

    expect(resumen).toMatchObject({ montosActualizados: 0, sinCambio: 1 });
    expect(memoria.estado.oportunidades[0].monto_orden).toBe(800);
  });

  test('con cotizacion vinculada guarda monto_orden pero no toca monto_manual ni el monto visible', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await nuevaEmpresa(memoria);
    const oportunidad = await memoria.repo.insertarOportunidad(memoria.pool, {
      empresa_id: empresa.id,
      titulo: 'Orden BO-124',
      etapa: 'ganada',
      bo: 'BO-124'
    });
    const cotizacion = memoria.agregarCotizacion({ cliente_empresa: 'Dimerc', total: 999 });
    await memoria.repo.vincularCotizacion(memoria.pool, cotizacion.id, {
      empresa_id: empresa.id,
      contacto_id: null,
      oportunidad_id: oportunidad.id
    });
    memoria.agregarOrden({ bo: 'BO-124', cliente: 'Dimerc' });

    const resumen = await sincronizar(memoria, { 'BO-124': 5000 });

    expect(resumen).toMatchObject({ montosActualizados: 1 });
    expect(memoria.estado.oportunidades[0].monto_manual).toBeNull();
    expect(memoria.estado.oportunidades[0].monto_orden).toBe(5000);
    expect((await memoria.repo.obtenerResumenOportunidad(memoria.pool, oportunidad.id)).monto).toBe(999);
  });

  test('ganar una oportunidad abierta con cotizacion tampoco toca monto_manual', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await nuevaEmpresa(memoria);
    const oportunidad = await memoria.repo.insertarOportunidad(memoria.pool, {
      empresa_id: empresa.id,
      titulo: 'Orden BO-125',
      etapa: 'negociacion',
      bo: 'BO-125'
    });
    const cotizacion = memoria.agregarCotizacion({ cliente_empresa: 'Dimerc', total: 999 });
    await memoria.repo.vincularCotizacion(memoria.pool, cotizacion.id, {
      empresa_id: empresa.id,
      contacto_id: null,
      oportunidad_id: oportunidad.id
    });
    memoria.agregarOrden({ bo: 'BO-125', cliente: 'Dimerc' });

    const resumen = await sincronizar(memoria, { 'BO-125': 5000 });

    expect(resumen).toMatchObject({ ganadas: 1, montosActualizados: 1 });
    expect(memoria.estado.oportunidades[0].monto_manual).toBeNull();
  });

  test('la sincronizacion nunca pisa un monto_manual escrito por una persona', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-126', cliente: 'Dimerc' });
    await sincronizar(memoria, { 'BO-126': 100 });
    const [op] = memoria.estado.oportunidades;
    await memoria.repo.actualizarOportunidad(memoria.pool, op.id, { monto_manual: 777 });

    await sincronizar(memoria, { 'BO-126': 900 });

    expect(memoria.estado.oportunidades[0].monto_manual).toBe(777);
    expect(memoria.estado.oportunidades[0].monto_orden).toBe(900);
    expect((await memoria.repo.obtenerResumenOportunidad(memoria.pool, op.id)).monto).toBe(777);
  });

  test('precedencia del monto visible: manual, cotizacion, orden, 0', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await nuevaEmpresa(memoria);
    const op = await memoria.repo.insertarOportunidad(memoria.pool, {
      empresa_id: empresa.id,
      titulo: 'x',
      etapa: 'ganada'
    });
    const visible = async () => (await memoria.repo.obtenerResumenOportunidad(memoria.pool, op.id)).monto;

    expect(await visible()).toBe(0);
    await memoria.repo.guardarMontoOrden(memoria.pool, op.id, 500);
    expect(await visible()).toBe(500);
    const cot = memoria.agregarCotizacion({ cliente_empresa: 'Dimerc', total: 300 });
    await memoria.repo.vincularCotizacion(memoria.pool, cot.id, {
      empresa_id: empresa.id,
      contacto_id: null,
      oportunidad_id: op.id
    });
    expect(await visible()).toBe(300);
    await memoria.repo.actualizarOportunidad(memoria.pool, op.id, { monto_manual: 100 });
    expect(await visible()).toBe(100);
  });

  test('enganchar una orden a una oportunidad abierta guarda monto_orden', async () => {
    const memoria = crearCrmMemoria();
    const empresa = await nuevaEmpresa(memoria);
    await memoria.repo.insertarOportunidad(memoria.pool, {
      empresa_id: empresa.id,
      titulo: 'Cotización #1',
      etapa: 'cotizada'
    });
    memoria.agregarOrden({ bo: 'BO-127', cliente: 'Dimerc' });

    const resumen = await sincronizar(memoria, { 'BO-127': 4200 });

    expect(resumen).toMatchObject({ enlazadas: 1 });
    expect(memoria.estado.oportunidades[0]).toMatchObject({ bo: 'BO-127', monto_orden: 4200, monto_manual: null });
  });

  test('todo al dia: cero transacciones y cero busquedas por BO', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-130', cliente: 'Dimerc' });
    memoria.agregarOrden({ bo: 'BO-131', cliente: 'Sonda' });
    await sincronizar(memoria, { 'BO-130': 100, 'BO-131': 200 });
    const transacciones = jest.spyOn(memoria.repo, 'conTransaccion');
    const busquedas = jest.spyOn(memoria.repo, 'buscarOportunidadPorBo');

    const resumen = await sincronizar(memoria, { 'BO-130': 100, 'BO-131': 200 });

    expect(resumen).toMatchObject({ ordenes: 2, sinCambio: 2, creadas: 0, errores: 0 });
    expect(transacciones).not.toHaveBeenCalled();
    expect(busquedas).not.toHaveBeenCalled();
  });

  test('solo las ordenes con algo que escribir abren transaccion', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-132', cliente: 'Dimerc' });
    await sincronizar(memoria);
    memoria.agregarOrden({ bo: 'BO-133', cliente: 'Sonda' });
    const transacciones = jest.spyOn(memoria.repo, 'conTransaccion');

    const resumen = await sincronizar(memoria);

    expect(resumen).toMatchObject({ ordenes: 2, creadas: 1, sinCambio: 1 });
    expect(transacciones).toHaveBeenCalledTimes(1);
  });

  test('si la consulta previa falla, sincroniza igual orden por orden', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-140', cliente: 'Dimerc' });
    memoria.agregarOrden({ bo: 'BO-141', cliente: 'Sonda' });
    await sincronizar(memoria);
    memoria.agregarOrden({ bo: 'BO-142', cliente: 'Entel' });
    memoria.fallarEn('oportunidadesConBo');

    const resumen = await sincronizar(memoria, { 'BO-140': 700 });

    expect(resumen).toMatchObject({ ordenes: 3, creadas: 1, sinCambio: 1, montosActualizados: 1, errores: 0 });
    expect(memoria.estado.oportunidades).toHaveLength(3);
    expect(memoria.estado.oportunidades.find((o) => o.bo === 'BO-140').monto_orden).toBe(700);
  });
});
