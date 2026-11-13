/**
 * CRM de MyQuote (empresas, contactos, oportunidades y embudo). Lo que usa legacyRoutes.
 * Contrato y notas en docs/CRM.md.
 */
const {
  iniciarCrm,
  prepararEsquema,
  migrarCotizaciones
} = require('./esquema');
const {
  enlazarCotizacionNueva,
  aplicarEtapaOportunidad,
  cambiarEtapaDeCotizacion,
  derivarEstadoSinFallar
} = require('./enlace');
const { crearRutasCrm } = require('./rutas');
const { sincronizarOrdenes, totalesPorBo } = require('./ordenes');
const normalizar = require('./normalizar');
const repositorio = require('./repositorio');

module.exports = {
  iniciarCrm,
  prepararEsquema,
  migrarCotizaciones,
  enlazarCotizacionNueva,
  aplicarEtapaOportunidad,
  cambiarEtapaDeCotizacion,
  derivarEstadoSinFallar,
  crearRutasCrm,
  sincronizarOrdenes,
  totalesPorBo,
  marcaDesdeOrigenes: normalizar.marcaDesdeOrigenes,
  // Equivalencias estado <-> etapa (unico lugar: normalizar.js).
  ETAPAS: normalizar.ETAPAS,
  ESTADOS_COTIZACION: normalizar.ESTADOS_COTIZACION,
  MOTIVO_COTIZADOR: normalizar.MOTIVO_COTIZADOR,
  etapaDesdeEstado: normalizar.etapaDesdeEstado,
  estadoDesdeEtapa: normalizar.estadoDesdeEtapa,
  etapaDesdeEstadoSql: normalizar.etapaDesdeEstadoSql,
  // Archivado de cotizaciones y oportunidades (POST /api/cotizaciones/archivar, etc.).
  conTransaccion: repositorio.conTransaccion,
  archivarCotizaciones: repositorio.archivarCotizaciones,
  previaArchivado: repositorio.previaArchivado,
  restaurarCotizaciones: repositorio.restaurarCotizaciones
};
