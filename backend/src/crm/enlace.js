/**
 * CRM: enlace de una cotizacion con empresa, contacto y oportunidad.
 *
 * - enlazarCotizacion: el nucleo (busca o crea), sobre un cliente que ya esta en una
 *   transaccion. Lo usan el enlace automatico y la migracion inicial.
 * - enlazarCotizacionNueva: el enlace automatico de POST /api/cotizaciones. Corre
 *   DESPUES del COMMIT de la cotizacion, en su propia transaccion, y nunca lanza: si el
 *   CRM falla, la cotizacion ya esta guardada y solo queda el error en el log (la
 *   migracion del siguiente arranque la enlaza, porque busca cotizaciones sin empresa).
 * - sincronizarEstadoCotizacion: aprobada/rechazada cierran la oportunidad abierta.
 */
const repositorio = require('./repositorio');
const {
  MOTIVO_MIGRADO,
  MOTIVO_COTIZADOR,
  esValorBasura,
  limpiarTexto,
  normalizarNombreEmpresa,
  normalizarEmail,
  combinarMarcas,
  etapaDesdeEstado,
  esEtapaCerrada
} = require('./normalizar');
const { logger: loggerApp } = require('../utils/logger');

const { AHORA } = repositorio;

/** Texto util o null (descarta 'N/A', '-', vacio). */
const textoUtil = (valor, max) =>
  esValorBasura(valor) ? null : limpiarTexto(valor, max);

/** Nombre de empresa de una cotizacion: cliente_empresa, o cliente_nombre si no hay empresa. */
const nombreEmpresaDe = (cotizacion) =>
  textoUtil(cotizacion.cliente_empresa, 200) ||
  textoUtil(cotizacion.cliente_nombre, 200);

/** Busca la empresa por nombre normalizado (o alias) y si no existe la crea. */
const resolverEmpresa = async (repo, db, nombreVisible) => {
  const nombre = textoUtil(nombreVisible, 200);
  if (!nombre) return null;
  const nombreNormalizado = normalizarNombreEmpresa(nombre);
  if (!nombreNormalizado) return null;
  const existente = await repo.buscarEmpresaPorNormalizado(
    db,
    nombreNormalizado
  );
  if (existente) return existente;
  const creada = await repo.insertarEmpresa(db, {
    nombre,
    nombre_normalizado: nombreNormalizado
  });
  // null = otra transaccion la creo entre medio (ON CONFLICT DO NOTHING): se reutiliza.
  return creada || repo.buscarEmpresaPorNormalizado(db, nombreNormalizado);
};

/**
 * Busca el contacto dentro de la empresa (por email; sin email, por nombre) y si no
 * existe lo crea. Completa el telefono o el email que le falten. null si no hay datos.
 */
const resolverContacto = async (
  repo,
  db,
  empresaId,
  { nombre, email, telefono }
) => {
  const emailNormalizado = normalizarEmail(email);
  const nombreLimpio = textoUtil(nombre, 200);
  const telefonoLimpio = textoUtil(telefono, 60);
  if (!emailNormalizado && !nombreLimpio) return null;

  let contacto = null;
  if (emailNormalizado)
    contacto = await repo.buscarContactoPorEmail(
      db,
      empresaId,
      emailNormalizado
    );
  if (!contacto && nombreLimpio) {
    const porNombre = await repo.buscarContactoPorNombre(
      db,
      empresaId,
      nombreLimpio
    );
    // Con email, el mismo nombre solo se reutiliza si ese contacto no tiene otro email.
    if (porNombre && (!emailNormalizado || !porNombre.email))
      contacto = porNombre;
  }

  if (contacto) {
    const completar = {};
    if (emailNormalizado && !contacto.email) completar.email = emailNormalizado;
    if (telefonoLimpio && !contacto.telefono)
      completar.telefono = telefonoLimpio;
    if (Object.keys(completar).length === 0) return contacto;
    return (
      (await repo.actualizarContacto(db, contacto.id, completar)) || contacto
    );
  }

  const creado = await repo.insertarContacto(db, {
    empresa_id: empresaId,
    nombre: nombreLimpio || emailNormalizado,
    email: emailNormalizado,
    telefono: telefonoLimpio
  });
  if (creado) return creado;
  return emailNormalizado
    ? repo.buscarContactoPorEmail(db, empresaId, emailNormalizado)
    : null;
};

const datosContactoDe = (cotizacion) => ({
  nombre: cotizacion.cliente_nombre,
  email: cotizacion.cliente_email,
  telefono: cotizacion.cliente_telefono
});

const tituloPara = (cotizacion) =>
  `Cotización #${cotizacion.numero ?? cotizacion.id}`;

/** Vincula la cotizacion a una oportunidad existente (y la avanza de 'nueva' a 'cotizada'). */
const enlazarAOportunidad = async (
  repo,
  db,
  { cotizacion, oportunidad, marca }
) => {
  const contacto = await resolverContacto(
    repo,
    db,
    oportunidad.empresa_id,
    datosContactoDe(cotizacion)
  );
  const contactoId = contacto?.id ?? oportunidad.contacto_id ?? null;
  const cambios = {};
  if (oportunidad.etapa === 'nueva') {
    cambios.etapa = 'cotizada';
    cambios.etapa_desde = AHORA;
  }
  const marcaFinal = combinarMarcas(oportunidad.marca, marca);
  if (marcaFinal !== oportunidad.marca) cambios.marca = marcaFinal;
  if (!oportunidad.contacto_id && contactoId) cambios.contacto_id = contactoId;
  await repo.actualizarOportunidad(db, oportunidad.id, cambios);
  const vinculo = {
    empresa_id: oportunidad.empresa_id,
    contacto_id: contactoId,
    oportunidad_id: oportunidad.id
  };
  await repo.vincularCotizacion(db, cotizacion.id, vinculo);
  return { ...vinculo, oportunidad_creada: false };
};

/**
 * Enlaza una cotizacion (fila de la BD, ya bloqueada por el llamador) con el CRM.
 * modo 'nueva': oportunidad con etapa_desde = ahora. modo 'migracion': fechas de la
 * cotizacion (etapa_desde, cerrada_en y created_at = created_at de la cotizacion).
 * Devuelve { empresa_id, contacto_id, oportunidad_id, oportunidad_creada } o null si la
 * cotizacion no trae un nombre de empresa ni de cliente util.
 */
const enlazarCotizacion = async (
  db,
  {
    cotizacion,
    marca = null,
    oportunidadId = null,
    modo = 'nueva',
    repo = repositorio,
    log = loggerApp
  }
) => {
  if (oportunidadId) {
    const oportunidad = await repo.obtenerOportunidad(db, oportunidadId, {
      bloquear: true
    });
    if (oportunidad)
      return enlazarAOportunidad(repo, db, { cotizacion, oportunidad, marca });
    log.warn(
      {
        event: 'crm_oportunidad_inexistente',
        cotizacion_id: cotizacion.id,
        oportunidad_id: oportunidadId
      },
      'oportunidad_id no existe: se crea una oportunidad nueva'
    );
  }

  const empresa = await resolverEmpresa(repo, db, nombreEmpresaDe(cotizacion));
  if (!empresa) return null;
  const contacto = await resolverContacto(
    repo,
    db,
    empresa.id,
    datosContactoDe(cotizacion)
  );
  const etapa = etapaDesdeEstado(cotizacion.estado);
  const migracion = modo === 'migracion';
  const fecha = migracion ? cotizacion.created_at || null : null;
  const oportunidad = await repo.insertarOportunidad(db, {
    empresa_id: empresa.id,
    contacto_id: contacto?.id ?? null,
    titulo: tituloPara(cotizacion),
    etapa,
    marca,
    motivo_perdida:
      etapa === 'perdida'
        ? migracion
          ? MOTIVO_MIGRADO
          : MOTIVO_COTIZADOR
        : null,
    etapa_desde: fecha,
    cerrada_en: esEtapaCerrada(etapa) ? fecha || AHORA : null,
    created_at: fecha
  });
  const vinculo = {
    empresa_id: empresa.id,
    contacto_id: contacto?.id ?? null,
    oportunidad_id: oportunidad.id
  };
  await repo.vincularCotizacion(db, cotizacion.id, vinculo);
  return { ...vinculo, oportunidad_creada: true };
};

/**
 * Enlace automatico de una cotizacion recien guardada (POST /api/cotizaciones), con el
 * mismo cliente de la ruta, despues de su COMMIT. Transaccion propia; nunca lanza.
 */
const enlazarCotizacionNueva = async (
  client,
  {
    cotizacionId,
    marca = null,
    oportunidadId = null,
    repo = repositorio,
    log = loggerApp
  }
) => {
  const idOportunidad = Number.parseInt(oportunidadId, 10);
  try {
    await client.query('BEGIN');
    // FOR UPDATE + "sin enlace": si la migracion de arranque ya la tomo, no se duplica.
    const cotizacion = await repo.bloquearCotizacionSinEnlace(
      client,
      cotizacionId
    );
    const vinculo = cotizacion
      ? await enlazarCotizacion(client, {
          cotizacion,
          marca,
          oportunidadId:
            Number.isInteger(idOportunidad) && idOportunidad > 0
              ? idOportunidad
              : null,
          modo: 'nueva',
          repo,
          log
        })
      : null;
    await client.query('COMMIT');
    return vinculo;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // la conexion ya no sirve; se registra el error original
    }
    log.error(
      {
        event: 'crm_enlace_error',
        cotizacion_id: cotizacionId,
        err: { message: error?.message, code: error?.code }
      },
      'No se pudo enlazar la cotizacion con el CRM (la cotizacion quedo guardada)'
    );
    return null;
  }
};

const ETAPA_POR_ESTADO = { aprobada: 'ganada', rechazada: 'perdida' };

/**
 * Cotizacion aprobada => su oportunidad abierta pasa a ganada; rechazada => perdida
 * ("Rechazada en el cotizador"). Best-effort: nunca lanza. Devuelve la fila cerrada o null.
 */
const sincronizarEstadoCotizacion = async (
  db,
  { oportunidadId, estado, repo = repositorio, log = loggerApp }
) => {
  const etapa = ETAPA_POR_ESTADO[estado];
  if (!etapa || !oportunidadId) return null;
  try {
    return await repo.cerrarOportunidadAbierta(
      db,
      oportunidadId,
      etapa,
      etapa === 'perdida' ? MOTIVO_COTIZADOR : null
    );
  } catch (error) {
    log.error(
      {
        event: 'crm_estado_error',
        oportunidad_id: oportunidadId,
        err: { message: error?.message, code: error?.code }
      },
      'No se pudo actualizar la oportunidad tras el cambio de estado'
    );
    return null;
  }
};

module.exports = {
  nombreEmpresaDe,
  resolverEmpresa,
  resolverContacto,
  enlazarCotizacion,
  enlazarCotizacionNueva,
  sincronizarEstadoCotizacion
};
