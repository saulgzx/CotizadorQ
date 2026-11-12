/**
 * CRM: las ordenes de OSO reflejadas como oportunidades ganadas.
 * Usa el repositorio en memoria (helpers/crmMemoria), sin PostgreSQL.
 */
const { crearCrmMemoria } = require('./helpers/crmMemoria');
const { sincronizarOrdenes, tituloPara, montoDe } = require('../src/crm/ordenes');

const logMudo = { info: () => {}, warn: () => {}, error: () => {} };

const sincronizar = (memoria) =>
  sincronizarOrdenes(memoria.pool, { repo: memoria.repo, log: logMudo });

describe('titulo y monto de una orden', () => {
  test('el titulo incluye la OC del cliente cuando viene', () => {
    expect(tituloPara({ bo: 'BO-1', customer_po: '4500123' })).toBe('Orden BO-1 · OC 4500123');
    expect(tituloPara({ bo: 'BO-1', customer_po: null })).toBe('Orden BO-1');
  });

  test('un monto de 0 o no numerico queda en null, no en 0', () => {
    expect(montoDe({ monto: '1250.50' })).toBe(1250.5);
    expect(montoDe({ monto: 0 })).toBeNull();
    expect(montoDe({ monto: null })).toBeNull();
    expect(montoDe({ monto: 'x' })).toBeNull();
  });
});

describe('sincronizarOrdenes', () => {
  test('crea empresa y oportunidad ganada cuando el cliente no existe en el CRM', async () => {
    const memoria = crearCrmMemoria();
    memoria.agregarOrden({ bo: 'BO-100', cliente: 'SONDA S.A.', customer_po: '4500999', monto: 3200 });

    const resumen = await sincronizar(memoria);

    expect(resumen).toMatchObject({ ordenes: 1, creadas: 1, errores: 0 });
    const [empresa] = memoria.estado.empresas;
    expect(empresa.nombre).toBe('SONDA S.A.');
    expect(empresa.nombre_normalizado).toBe('sonda');
    const [oportunidad] = memoria.estado.oportunidades;
    expect(oportunidad).toMatchObject({
      empresa_id: empresa.id,
      etapa: 'ganada',
      bo: 'BO-100',
      monto_manual: 3200,
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
});
