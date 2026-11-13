/**
 * CRM: las ordenes de la pestana OSO como oportunidades ganadas.
 *
 * Las ordenes no son cotizaciones: viven en la planilla OSO y GET /api/oso/orders las
 * persiste en `bo_meta` (cliente, PO, borrado logico). De ahi lee esta sincronizacion,
 * no de la planilla: asi no depende de Google Sheets ni duplica el parseo del endpoint.
 * El monto NO sale de la base: bo_line_meta guarda el precio unitario y la cantidad vive
 * solo en la planilla, asi que el endpoint calcula los totales (totalesPorBo) y los pasa.
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
 * Una oportunidad ya ganada sin cotizacion vinculada recibe el total como monto_manual
 * cuando cambia (los precios suelen cargarse dias despues de que llega la orden). Si tiene
 * cotizacion, su monto sale de ella y monto_manual no se toca.
 *
 * Cada orden que necesita escribir va en su propia transaccion: una que falle no arrastra
 * a las demas. Las que ya estan al dia se cuentan sin tocar la base.
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

/** Un total solo se usa si es un numero positivo; 0 o basura se deja en null. */
const montoDe = (total) => {
  const monto = Number(total);
  return Number.isFinite(monto) && monto > 0 ? monto : null;
};

const redondear2 = (n) => Math.round(n * 100) / 100;

/**
 * Total por BO a partir de las ordenes que lee GET /api/oso/orders:
 * suma de montoIntcomex (precio UNITARIO) x orderQty (cantidad de la orden) por linea.
 * La cantidad vive solo en la planilla, por eso el monto no puede salir de la base.
 * Una linea sin monto o sin cantidad valida aporta 0. Si ninguna linea de la orden tiene
 * monto, el BO no aparece (no se quiere escribir 0). Redondeado a 2 decimales.
 */
const totalesPorBo = (orders) => {
  const totales = {};
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order?.bo) continue;
    let hayMonto = false;
    let total = 0;
    for (const linea of order.lines || []) {
      const monto = Number(linea?.montoIntcomex);
      if (!Number.isFinite(monto) || monto <= 0) continue;
      hayMonto = true;
      const cantidad = Number(linea?.orderQty);
      if (Number.isFinite(cantidad) && cantidad > 0) total += monto * cantidad;
    }
    if (hayMonto) totales[order.bo] = redondear2(total);
  }
  return totales;
};

/**
 * Una oportunidad ya existente necesita nuevo monto si hay total conocido (> 0), no tiene
 * ninguna cotizacion vinculada (si la tiene, su monto sale de la cotizacion y monto_manual
 * no se toca nunca) y su monto_manual difiere del total.
 */
const necesitaMonto = (existente, total) => {
  if (!existente || existente.con_cotizacion) return false;
  const nuevo = montoDe(total);
  if (nuevo === null) return false;
  const actual = existente.monto_manual;
  return (
    actual === null ||
    actual === undefined ||
    redondear2(Number(actual)) !== nuevo
  );
};

const RESUMEN_VACIO = () => ({
  ordenes: 0,
  creadas: 0,
  enlazadas: 0,
  ganadas: 0,
  montosActualizados: 0,
  sinCambio: 0,
  sinCliente: 0,
  errores: 0
});

/**
 * Sincroniza una orden ya leida. Espera estar dentro de una transaccion.
 * Devuelve la lista de claves del resumen que corresponde incrementar (casi siempre una;
 * dos cuando ademas de ganar se corrige el monto).
 */
const sincronizarOrden = async (
  db,
  orden,
  { repo = repositorio, total = null } = {}
) => {
  const existente = await repo.buscarOportunidadPorBo(db, orden.bo);
  if (existente) {
    const claves = [];
    if (existente.etapa !== 'ganada') {
      await aplicarEtapaOportunidad(db, {
        oportunidadId: existente.id,
        etapa: 'ganada',
        repo
      });
      claves.push('ganadas');
    }
    if (necesitaMonto(existente, total)) {
      await repo.actualizarOportunidad(db, existente.id, {
        monto_manual: montoDe(total)
      });
      claves.push('montosActualizados');
    }
    return claves.length ? claves : ['sinCambio'];
  }

  // Sin nombre de cliente no hay empresa que resolver: se informa y no se inventa.
  if (!orden.cliente) return ['sinCliente'];

  const empresa = await resolverEmpresa(repo, db, orden.cliente);
  if (!empresa) return ['sinCliente'];

  const abiertas = await repo.oportunidadesAbiertasSinBo(db, empresa.id);
  if (abiertas.length === 1) {
    const enganchada = await repo.asignarBo(db, abiertas[0].id, orden.bo);
    if (enganchada) {
      await aplicarEtapaOportunidad(db, {
        oportunidadId: enganchada.id,
        etapa: 'ganada',
        repo
      });
      return ['enlazadas'];
    }
  }

  const creada = await repo.insertarOportunidad(db, {
    empresa_id: empresa.id,
    titulo: tituloPara(orden),
    etapa: 'ganada',
    monto_manual: montoDe(total),
    cerrada_en: AHORA,
    bo: orden.bo
  });
  // Sin fila: otra transaccion creo el mismo BO entre medio. Queda cubierto.
  if (!creada) return ['sinCambio'];
  await repo.derivarEstadoCotizaciones(db, creada.id);
  return ['creadas'];
};

/**
 * Recorre las ordenes vigentes y las refleja en el embudo. Nunca lanza: un BO que
 * falla queda contado en `errores` y el resto sigue.
 *
 * `montos` ({ [bo]: total }, ver totalesPorBo) es opcional: solo lo trae el endpoint de
 * ordenes, que tiene las cantidades. Sin el, las oportunidades nuevas quedan con monto null
 * y las existentes no se tocan.
 *
 * Una sola consulta previa (oportunidadesConBo) decide en memoria que ordenes necesitan
 * escribir algo; solo esas abren transaccion. Si esa consulta falla se cae al camino
 * orden por orden.
 */
const sincronizarOrdenes = async (
  pool,
  { repo = repositorio, log = loggerApp, limite = 5000, montos = {} } = {}
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

  let porBo = null;
  try {
    porBo = new Map(
      (await repo.oportunidadesConBo(pool)).map((fila) => [fila.bo, fila])
    );
  } catch (error) {
    log.warn(
      { event: 'crm_ordenes_previa_fallo', err: error?.message },
      'No se pudo leer el estado previo del CRM; se sincroniza orden por orden'
    );
  }

  const montosPorBo = montos || {};
  for (const orden of ordenes) {
    const total = montosPorBo[orden.bo] ?? null;
    if (porBo) {
      const previa = porBo.get(orden.bo);
      if (
        previa &&
        previa.etapa === 'ganada' &&
        !necesitaMonto(previa, total)
      ) {
        resumen.sinCambio += 1;
        continue;
      }
      // Sin oportunidad y sin nombre de cliente no hay nada que se pueda crear: se
      // cuenta sin abrir transaccion, o esas ordenes costarian 3 consultas cada vez.
      if (!previa && !orden.cliente) {
        resumen.sinCliente += 1;
        continue;
      }
    }
    try {
      const claves = await repo.conTransaccion(pool, (client) =>
        sincronizarOrden(client, orden, { repo, total })
      );
      for (const clave of claves) resumen[clave] += 1;
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
  totalesPorBo,
  necesitaMonto,
  sincronizarOrden,
  sincronizarOrdenes
};
