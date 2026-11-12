// Seguimiento automático de cotizaciones (contrato v1). Punto de entrada que usa
// legacyRoutes.js: crea el servicio, monta las rutas y expone esquema y planificador.

const { crearServicioSeguimiento } = require('./servicio');
const { crearRutasAdmin, crearRutasAgente } = require('./rutas');
const { leerConfigSeguimiento } = require('./config');
const { crearCalendario } = require('./calendario');
const { leerFeriados } = require('./feriados');

/**
 * Monta /api/seguimiento/agente (auth del agente) y /api/seguimiento (admin).
 * El router del agente va primero para que la auth admin no lo intercepte.
 */
const montarSeguimiento = ({
  app,
  db,
  authAdmin = [],
  authAgente = [],
  whatsapp = null,
  leerStock = null,
  pdfNombre = null,
  logger = console,
  env = process.env,
  ahora
}) => {
  const config = leerConfigSeguimiento(env);
  const servicio = crearServicioSeguimiento({
    db,
    calendario: crearCalendario({ feriados: leerFeriados(env) }),
    config,
    whatsapp,
    leerStock,
    pdfNombre,
    logger,
    ...(ahora ? { ahora } : {})
  });
  app.use('/api/seguimiento/agente', ...authAgente, crearRutasAgente(servicio, { logger }));
  app.use('/api/seguimiento', ...authAdmin, crearRutasAdmin(servicio, { logger, ...(ahora ? { ahora } : {}) }));
  return servicio;
};

module.exports = { montarSeguimiento, crearServicioSeguimiento, leerConfigSeguimiento };
