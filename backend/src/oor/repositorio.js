/**
 * OOR: acceso a datos (SQL). Todas las funciones reciben `db` (pool o cliente) como primer
 * argumento. La logica vive en servicio.js; los tests la ejercitan con un repositorio en
 * memoria (tests/helpers/oorMemoria.js) con esta misma interfaz.
 */

const COLUMNAS_SNAPSHOT = 'id, tomado_en, huella, total, lineas, avisos';

const ultimoSnapshot = async (db) => {
  const { rows } = await db.query(`SELECT ${COLUMNAS_SNAPSHOT} FROM oor_snapshots ORDER BY id DESC LIMIT 1`);
  return rows[0] || null;
};

const snapshotPorId = async (db, id) => {
  const { rows } = await db.query(`SELECT ${COLUMNAS_SNAPSHOT} FROM oor_snapshots WHERE id = $1`, [id]);
  return rows[0] || null;
};

const insertarSnapshot = async (db, { tomadoEn, huella, total, lineas, avisos }) => {
  const { rows } = await db.query(
    `INSERT INTO oor_snapshots (tomado_en, huella, total, lineas, avisos)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING id, tomado_en, huella, total`,
    [tomadoEn, huella, total, JSON.stringify(lineas), JSON.stringify(avisos || [])]
  );
  return rows[0];
};

const ultimaRevision = async (db) => {
  const { rows } = await db.query(
    `SELECT id, desde_snapshot_id, hasta_snapshot_id, usuario_id, visto_en, automatica, resumen
       FROM oor_revisiones ORDER BY id DESC LIMIT 1`
  );
  return rows[0] || null;
};

const revisionPorId = async (db, id) => {
  const { rows } = await db.query(
    `SELECT id, desde_snapshot_id, hasta_snapshot_id, usuario_id, visto_en, automatica, resumen
       FROM oor_revisiones WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
};

const insertarRevision = async (db, { desdeId, hastaId, usuarioId, vistoEn, automatica, resumen }) => {
  const { rows } = await db.query(
    `INSERT INTO oor_revisiones (desde_snapshot_id, hasta_snapshot_id, usuario_id, visto_en, automatica, resumen)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, desde_snapshot_id, hasta_snapshot_id, usuario_id, visto_en, automatica, resumen`,
    [desdeId ?? null, hastaId, usuarioId ?? null, vistoEn, Boolean(automatica), resumen ? JSON.stringify(resumen) : null]
  );
  return rows[0];
};

/** Revisiones NO automaticas, de la mas reciente a la mas antigua, con la fecha de sus dos snapshots. */
const listarRevisiones = async (db, { limite }) => {
  const { rows } = await db.query(
    `SELECT r.id, r.visto_en, r.desde_snapshot_id, r.hasta_snapshot_id, r.resumen,
            d.tomado_en AS desde_tomado_en, h.tomado_en AS hasta_tomado_en
       FROM oor_revisiones r
       LEFT JOIN oor_snapshots d ON d.id = r.desde_snapshot_id
       JOIN oor_snapshots h ON h.id = r.hasta_snapshot_id
      WHERE r.automatica = false
      ORDER BY r.id DESC
      LIMIT $1`,
    [limite]
  );
  return rows;
};

/**
 * Deja las `maxRevisiones` revisiones mas recientes y borra los snapshots que ninguna
 * revision referencia, salvo los `maxSnapshots` mas recientes.
 */
const limpiar = async (db, { maxSnapshots, maxRevisiones }) => {
  await db.query(
    `DELETE FROM oor_revisiones
      WHERE id NOT IN (SELECT id FROM oor_revisiones ORDER BY id DESC LIMIT $1)`,
    [maxRevisiones]
  );
  await db.query(
    `DELETE FROM oor_snapshots
      WHERE id NOT IN (SELECT id FROM oor_snapshots ORDER BY id DESC LIMIT $1)
        AND id NOT IN (SELECT desde_snapshot_id FROM oor_revisiones WHERE desde_snapshot_id IS NOT NULL)
        AND id NOT IN (SELECT hasta_snapshot_id FROM oor_revisiones)`,
    [maxSnapshots]
  );
};

/**
 * Configuracion ACTUAL de las BO que importan: no eliminadas, no facturadas y con PO Axis.
 * La fecha de facturacion sale como texto 'YYYY-MM-DD' (sin zona horaria de por medio).
 */
const listarBos = async (db) => {
  const { rows } = await db.query(
    `SELECT bo, po_axis, customer_name, project_name, customer_po,
            estimated_invoice_month,
            to_char(estimated_invoice_date, 'YYYY-MM-DD') AS estimated_invoice_date,
            estimated_invoice_week
       FROM bo_meta
      WHERE COALESCE(deleted, false) = false
        AND COALESCE(invoiced, false) = false
        AND COALESCE(TRIM(po_axis), '') <> ''
      ORDER BY bo`
  );
  return rows;
};

module.exports = {
  ultimoSnapshot,
  snapshotPorId,
  insertarSnapshot,
  ultimaRevision,
  revisionPorId,
  insertarRevision,
  listarRevisiones,
  limpiar,
  listarBos
};
