/**
 * OOR: esquema (DDL idempotente) de las versiones del reporte y de las revisiones del dueno.
 *
 * oor_snapshots: una fila por cada version DISTINTA del OOR que la app ha visto.
 * oor_revisiones: cada vez que el dueno da por revisado un cambio (o la base inicial).
 * Las revisiones son globales, no por usuario: la app tiene un solo admin.
 */
const { logger: loggerApp } = require('../utils/logger');

const SENTENCIAS = [
  `CREATE TABLE IF NOT EXISTS oor_snapshots (
     id SERIAL PRIMARY KEY,
     tomado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     huella VARCHAR(64) NOT NULL,
     total INTEGER NOT NULL,
     lineas JSONB NOT NULL,
     avisos JSONB NOT NULL DEFAULT '[]'
   )`,
  `CREATE TABLE IF NOT EXISTS oor_revisiones (
     id SERIAL PRIMARY KEY,
     desde_snapshot_id INTEGER REFERENCES oor_snapshots(id),
     hasta_snapshot_id INTEGER NOT NULL REFERENCES oor_snapshots(id),
     usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
     visto_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     automatica BOOLEAN NOT NULL DEFAULT false,
     resumen JSONB
   )`,
  `CREATE INDEX IF NOT EXISTS oor_revisiones_hasta_idx ON oor_revisiones(hasta_snapshot_id)`,
  `CREATE INDEX IF NOT EXISTS oor_revisiones_desde_idx ON oor_revisiones(desde_snapshot_id)`
];

/** Crea las tablas del OOR. true si quedo todo listo; nunca lanza. */
const prepararEsquema = async (pool, { log = loggerApp } = {}) => {
  try {
    for (const sql of SENTENCIAS) await pool.query(sql);
    log.info({ event: 'oor_esquema_listo' }, 'Esquema del OOR listo');
    return true;
  } catch (error) {
    log.error(
      { event: 'oor_esquema_error', err: { message: error?.message, code: error?.code } },
      'Error preparando el esquema del OOR'
    );
    return false;
  }
};

module.exports = { SENTENCIAS, prepararEsquema };
