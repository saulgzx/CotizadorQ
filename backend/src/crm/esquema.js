/**
 * CRM: esquema (DDL idempotente) y migracion inicial de las cotizaciones existentes.
 *
 * prepararEsquema: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, seguro de
 * repetir en cada arranque. Las columnas nuevas de cotizaciones son nullable y sin
 * DEFAULT, asi que el ALTER no reescribe la tabla.
 *
 * migrarCotizaciones: enlaza las cotizaciones que aun no tienen empresa ni oportunidad,
 * en lotes chicos (una transaccion por lote, un SAVEPOINT por cotizacion). Es
 * idempotente porque solo toma cotizaciones sin enlazar, y sirve de reconciliador: una
 * cotizacion cuyo enlace automatico fallo se enlaza en el siguiente arranque. Nunca
 * lanza: registra el error y termina.
 */
const repositorio = require('./repositorio');
const { enlazarCotizacion } = require('./enlace');
const { marcaDesdeOrigenes } = require('./normalizar');
const { logger: loggerApp } = require('../utils/logger');

const SENTENCIAS = [
  `CREATE TABLE IF NOT EXISTS crm_empresas (
     id SERIAL PRIMARY KEY,
     nombre VARCHAR(200) NOT NULL,
     nombre_normalizado VARCHAR(200) NOT NULL,
     rut VARCHAR(30),
     sitio VARCHAR(300),
     notas TEXT,
     archivada BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_empresas_nombre_normalizado_idx ON crm_empresas(nombre_normalizado)`,
  // Nombres normalizados de empresas fusionadas o renombradas: el enlace automatico los
  // sigue resolviendo a la empresa que quedo, en vez de volver a crear la vieja.
  `CREATE TABLE IF NOT EXISTS crm_empresas_alias (
     nombre_normalizado VARCHAR(200) PRIMARY KEY,
     empresa_id INTEGER NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS crm_empresas_alias_empresa_idx ON crm_empresas_alias(empresa_id)`,
  `CREATE TABLE IF NOT EXISTS crm_contactos (
     id SERIAL PRIMARY KEY,
     empresa_id INTEGER NOT NULL REFERENCES crm_empresas(id) ON DELETE CASCADE,
     nombre VARCHAR(200) NOT NULL,
     email VARCHAR(200),
     telefono VARCHAR(60),
     cargo VARCHAR(120),
     notas TEXT,
     archivado BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS crm_contactos_empresa_idx ON crm_contactos(empresa_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_contactos_empresa_email_idx
     ON crm_contactos(empresa_id, LOWER(email)) WHERE email IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS crm_oportunidades (
     id SERIAL PRIMARY KEY,
     empresa_id INTEGER NOT NULL REFERENCES crm_empresas(id),
     contacto_id INTEGER REFERENCES crm_contactos(id) ON DELETE SET NULL,
     titulo VARCHAR(200) NOT NULL,
     etapa VARCHAR(20) NOT NULL DEFAULT 'nueva'
       CHECK (etapa IN ('nueva', 'cotizada', 'negociacion', 'ganada', 'perdida')),
     marca VARCHAR(10) CHECK (marca IN ('AXIS', 'QNAP', 'MIXTA')),
     es_proyecto BOOLEAN NOT NULL DEFAULT false,
     monto_manual NUMERIC(14,2),
     fecha_cierre_estimada DATE,
     motivo_perdida TEXT,
     etapa_desde TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     cerrada_en TIMESTAMP,
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS crm_oportunidades_empresa_idx ON crm_oportunidades(empresa_id)`,
  `CREATE INDEX IF NOT EXISTS crm_oportunidades_contacto_idx ON crm_oportunidades(contacto_id)`,
  `CREATE INDEX IF NOT EXISTS crm_oportunidades_etapa_idx ON crm_oportunidades(etapa)`,
  `ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES crm_empresas(id) ON DELETE SET NULL`,
  `ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS contacto_id INTEGER REFERENCES crm_contactos(id) ON DELETE SET NULL`,
  `ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS oportunidad_id INTEGER REFERENCES crm_oportunidades(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS cotizaciones_empresa_id_idx ON cotizaciones(empresa_id)`,
  `CREATE INDEX IF NOT EXISTS cotizaciones_contacto_id_idx ON cotizaciones(contacto_id)`,
  `CREATE INDEX IF NOT EXISTS cotizaciones_oportunidad_id_idx ON cotizaciones(oportunidad_id)`
];

const LOCK_TIMEOUT = '10s';

/** Crea o completa las tablas del CRM. true si todo quedo listo; nunca lanza. */
const prepararEsquema = async (pool, { log = loggerApp } = {}) => {
  // Conexion propia con lock_timeout: si una transaccion larga tiene tomada la tabla
  // cotizaciones, el ALTER se rinde a los 10 s (y se reintenta en el proximo arranque)
  // en vez de quedar esperando y encolar detras a todas las consultas de cotizaciones.
  let client = null;
  try {
    client = typeof pool.connect === 'function' ? await pool.connect() : null;
  } catch {
    client = null;
  }
  const db = client || pool;
  try {
    if (client) await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const sql of SENTENCIAS) await db.query(sql);
    log.info({ event: 'crm_esquema_listo' }, 'Esquema del CRM listo');
    return true;
  } catch (error) {
    log.error(
      {
        event: 'crm_esquema_error',
        err: { message: error?.message, code: error?.code }
      },
      'Error preparando el esquema del CRM'
    );
    return false;
  } finally {
    if (client) {
      try {
        await client.query('RESET lock_timeout');
      } catch {
        // la conexion vuelve al pool igual
      }
      client.release();
    }
  }
};

const TAMANO_LOTE = Math.max(
  1,
  parseInt(process.env.CRM_MIGRACION_LOTE || '200', 10) || 200
);

/**
 * Enlaza todas las cotizaciones sin empresa ni oportunidad. Devuelve el resumen
 * { procesadas, enlazadas, omitidas, errores, lotes, ms }. Nunca lanza.
 */
const migrarCotizaciones = async (
  pool,
  { repo = repositorio, log = loggerApp, tamanoLote = TAMANO_LOTE } = {}
) => {
  const inicio = Date.now();
  const resumen = {
    procesadas: 0,
    enlazadas: 0,
    omitidas: 0,
    errores: 0,
    lotes: 0,
    ms: 0
  };
  let desdeId = 0;
  try {
    for (;;) {
      const lote = await repo.conTransaccion(pool, async (client) => {
        const filas = await repo.loteCotizacionesSinEnlace(client, {
          desdeId,
          limite: tamanoLote
        });
        const parcial = { enlazadas: 0, omitidas: 0, errores: 0 };
        for (const cotizacion of filas) {
          await client.query('SAVEPOINT crm_migracion');
          try {
            const vinculo = await enlazarCotizacion(client, {
              cotizacion,
              marca: marcaDesdeOrigenes(cotizacion.origenes),
              modo: 'migracion',
              repo,
              log
            });
            await client.query('RELEASE SAVEPOINT crm_migracion');
            if (vinculo) parcial.enlazadas += 1;
            else parcial.omitidas += 1; // sin nombre de empresa ni de cliente util
          } catch (error) {
            await client.query('ROLLBACK TO SAVEPOINT crm_migracion');
            parcial.errores += 1;
            log.warn(
              {
                event: 'crm_migracion_cotizacion_error',
                cotizacion_id: cotizacion.id,
                err: { message: error?.message, code: error?.code }
              },
              'No se pudo migrar una cotizacion al CRM'
            );
          }
        }
        return { filas, parcial };
      });
      resumen.lotes += 1;
      resumen.procesadas += lote.filas.length;
      resumen.enlazadas += lote.parcial.enlazadas;
      resumen.omitidas += lote.parcial.omitidas;
      resumen.errores += lote.parcial.errores;
      if (lote.filas.length > 0) desdeId = lote.filas[lote.filas.length - 1].id;
      if (lote.filas.length < tamanoLote) break;
    }
    resumen.ms = Date.now() - inicio;
    log.info(
      { event: 'crm_migracion_lista', ...resumen },
      'Migracion de cotizaciones al CRM terminada'
    );
  } catch (error) {
    resumen.ms = Date.now() - inicio;
    log.error(
      {
        event: 'crm_migracion_error',
        ...resumen,
        err: { message: error?.message, code: error?.code }
      },
      'La migracion de cotizaciones al CRM se detuvo (se reintenta en el proximo arranque)'
    );
  }
  return resumen;
};

/** Esquema y luego migracion en segundo plano. Para startServer: no bloquea ni lanza. */
const iniciarCrm = async (pool, opciones = {}) => {
  const listo = await prepararEsquema(pool, opciones);
  if (!listo) return { esquema: false, migracion: null };
  const migracion = migrarCotizaciones(pool, opciones);
  return { esquema: true, migracion };
};

module.exports = {
  SENTENCIAS,
  prepararEsquema,
  migrarCotizaciones,
  iniciarCrm
};
