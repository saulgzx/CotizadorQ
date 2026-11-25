/**
 * OOR de MyQuote: cambios del reporte de ordenes abiertas de Axis cruzados con las BO.
 * Contrato y notas en docs/OOR.md.
 */
const { prepararEsquema } = require('./esquema');
const { crearRutasOor } = require('./rutas');
const servicio = require('./servicio');

module.exports = {
  prepararEsquema,
  iniciarOor: prepararEsquema,
  crearRutasOor,
  registrarLectura: servicio.registrarLectura,
  pendiente: servicio.pendiente,
  marcarVisto: servicio.marcarVisto,
  historial: servicio.historial,
  detalle: servicio.detalle
};
