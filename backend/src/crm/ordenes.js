/**
 * CRM: las ordenes de la pestana OSO como oportunidades ganadas.
 *
 * Las ordenes no son cotizaciones: viven en la planilla OSO y GET /api/oso/orders las
 * persiste en `bo_meta` (cliente, PO, borrado logico) y en `bo_line_meta` (monto por
 * linea). De ahi lee esta sincronizacion, no de la planilla: asi no depende de Google
 * Sheets ni duplica el parseo del endpoint.
 *
 * Por cada BO vigente:
 *  - Si ese BO ya tiene oportunidad (columna `bo`, unica), se asegura que este en
 *    'ganada' y no se crea nada: eso hace la sincronizacion idempotente y repetible.
 *  - Si no, se resuelve la empresa por nombre normalizado (se crea si no existe) y:
 *    - si la empresa tiene EXACTAMENTE una oportunidad abierta sin BO, la orden es su
 *      cierre: se le engancha el BO y se gana. Evita dejar el negocio duplicado en el
 *      embudo (la cotizacion por un lado, la orden por otro).
 *    - si tiene cero o varias, no hay forma de saber cual cerro: se crea una
 *      oportunidad nueva para ese BO.
 *
 * Ganar una oportunidad deriva `cotizaciones.estado = 'aprobada'` en todas sus
 * cotizaciones, igual que cualquier otro cambio de etapa del CRM.
 *
 * Cada orden va en su propia transaccion: una que falle no arrastra a las demas.
 */
const repositorio = require('./repositorio');
const { resolverEmpresa, aplicarEtapaOportunidad } = require('./enlace');
const { logger: loggerApp } = require('../utils/logger');

const { AHORA } = repositorio;

/** Titulo visible de la oportunidad que nace de una orden. */
const tituloPara = (orden) =>
  orden.customer_po
    ? `Orden ${orden.bo} · OC ${orden.customer_po}`
    : `Orden ${orden.bo}`;

/** El monto de bo_line_meta solo se usa si hay algo cargado; 0 se deja en null. */
const montoDe = (orden) => {
  const monto = Number(orden.monto);
  return Number.isFinite(monto) && monto > 0 ? monto : null;
};

const RESUMEN_VACIO = () => ({
  ordenes: 0,
  creadas: 0,
  enlazadas: 0,
  ganadas: 0,
  sinCambio: 0,
  sinCliente: 0,
  errores: 0
});

/**
 * Sincroniza una orden ya leida. Espera estar dentro de una transaccion.
 * Devuelve la clave del resumen que corresponde incrementar.
 */
const sincronizarOrden = async (db, orden, { repo = repositorio } = {}) => {
  const existente = await repo.buscarOportunidadPorBo(db, orden.bo);
  if (existente) {
    if (existente.etapa === 'ganada') return 'sinCambio';
    await aplicarEtapaOportunidad(db, {
      oportunidadId: existente.id,
      etapa: 'ganada',
      repo
    });
    return 'ganadas';
  }

  // Sin nombre de cliente no hay empresa que resolver: se informa y no se inventa.
  if (!orden.cliente) return 'sinCliente';

  const empresa = await resolverEmpresa(repo, db, orden.cliente);
  if (!empresa) return 'sinCliente';

  const abiertas = await repo.oportunidadesAbiertasSinBo(db, empresa.id);
  if (abiertas.length === 1) {
    const enganchada = await repo.asignarBo(db, abiertas[0].id, orden.bo);
    if (enganchada) {
      await aplicarEtapaOportunidad(db, {
        oportunidadId: enganchada.id,
        etapa: 'ganada',
        repo
      });
      return 'enlazadas';
    }
  }

  const creada = await repo.insertarOportunidad(db, {
    empresa_id: empresa.id,
    titulo: tituloPara(orden),
    etapa: 'ganada',
    monto_manual: montoDe(orden),
    cerrada_en: AHORA,
    bo: orden.bo
  });
  // Sin fila: otra transaccion creo el mismo BO entre medio. Queda cubierto.
  if (!creada) return 'sinCambio';
  await repo.derivarEstadoCotizaciones(db, creada.id);
  return 'creadas';
};

/**
 * Recorre las ordenes vigentes y las refleja en el embudo. Nunca lanza: un BO que
 * falla queda contado en `errores` y el resto sigue.
 */
const sincronizarOrdenes = async (
  pool,
  { repo = repositorio, log = loggerApp, limite = 5000 } = {}
) => {
  const inicio = Date.now();
  const resumen = RESUMEN_VACIO();
  let ordenes = [];
  try {
    ordenes = await repo.ordenesVigentes(pool, { limite });
  } catch (error) {
    log.error(
      { event: 'crm_ordenes_lectura_fallo', err: error?.message },
      'No se pudieron leer las ordenes para el CRM'
    );
    return { ...resumen, ms: Date.now() - inicio };
  }
  resumen.ordenes = ordenes.length;

  for (const orden of ordenes) {
    try {
      const clave = await repo.conTransaccion(pool, (client) =>
        sincronizarOrden(client, orden, { repo })
      );
      resumen[clave] += 1;
    } catch (error) {
      resumen.errores += 1;
      log.warn(
        { event: 'crm_orden_fallo', bo: orden.bo, err: error?.message },
        'No se pudo reflejar la orden en el CRM'
      );
    }
  }

  const ms = Date.now() - inicio;
  log.info(
    { event: 'crm_ordenes_sincronizadas', ...resumen, ms },
    'Ordenes reflejadas en el CRM'
  );
  return { ...resumen, ms };
};

module.exports = {
  tituloPara,
  montoDe,
  sincronizarOrden,
  sincronizarOrdenes
};
