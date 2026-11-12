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
  sincronizarEstadoCotizacion
} = require('./enlace');
const { crearRutasCrm } = require('./rutas');
const { marcaDesdeOrigenes } = require('./normalizar');

module.exports = {
  iniciarCrm,
  prepararEsquema,
  migrarCotizaciones,
  enlazarCotizacionNueva,
  sincronizarEstadoCotizacion,
  crearRutasCrm,
  marcaDesdeOrigenes
};
