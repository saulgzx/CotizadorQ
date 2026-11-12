// Único punto de contacto del seguimiento con el CRM (tablas crm_* y columnas
// cotizaciones.empresa_id/contacto_id/oportunidad_id, contrato CRM v1). Si el esquema
// del CRM cambia, se ajusta solo este archivo.
//
// Monto de una oportunidad (contrato CRM): monto_manual, si no el total de la cotización
// vinculada más reciente, si no 0.

const MONTO_SQL = `COALESCE(o.monto_manual, (
    SELECT c2.total FROM cotizaciones c2
     WHERE c2.oportunidad_id = o.id
     ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1
  ), 0)`;

const ETAPAS_ALTA = ['nueva', 'cotizada'];

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Alta automática: toda oportunidad abierta (nueva/cotizada) con cotización vinculada
 * creada desde `desde` y sin seguimiento entra en buscando_envio. Idempotente.
 * Devuelve las filas creadas ({ oportunidad_id, cotizacion_id }).
 */
const altaAutomatica = async (db, { desde }) => {
  const { rows } = await db.query(
    `INSERT INTO crm_seguimientos (oportunidad_id, cotizacion_id, estado, busqueda_desde)
     SELECT o.id, c.id, 'buscando_envio', NOW()
       FROM crm_oportunidades o
       JOIN LATERAL (
         SELECT c1.id, c1.created_at FROM cotizaciones c1
          WHERE c1.oportunidad_id = o.id
          ORDER BY c1.created_at DESC, c1.id DESC LIMIT 1
       ) c ON TRUE
      WHERE o.etapa = ANY($1::text[])
        AND c.created_at >= $2
        AND NOT EXISTS (SELECT 1 FROM crm_seguimientos s WHERE s.oportunidad_id = o.id)
     ON CONFLICT (oportunidad_id) DO NOTHING
     RETURNING oportunidad_id, cotizacion_id`,
    [ETAPAS_ALTA, desde]
  );
  return rows;
};

/**
 * Seguimientos con los datos de su oportunidad, empresa, contacto y cotización.
 * filtro: { estados?: string[], oportunidadIds?: number[], cotizacionIds?: number[] }
 */
const oportunidadesParaSeguimiento = async (db, { estados = null, oportunidadIds = null, cotizacionIds = null } = {}) => {
  const where = [];
  const params = [];
  if (estados) {
    params.push(estados);
    where.push(`s.estado = ANY($${params.length}::text[])`);
  }
  if (oportunidadIds) {
    params.push(oportunidadIds.map(Number));
    where.push(`s.oportunidad_id = ANY($${params.length}::int[])`);
  }
  if (cotizacionIds) {
    params.push(cotizacionIds.map(Number));
    where.push(`s.cotizacion_id = ANY($${params.length}::int[])`);
  }
  const { rows } = await db.query(
    `SELECT s.*,
            o.etapa, o.motivo_perdida, o.titulo, o.created_at AS oportunidad_creada_en, o.cerrada_en AS oportunidad_cerrada_en,
            ${MONTO_SQL} AS monto,
            e.nombre AS empresa_nombre,
            ct.nombre AS contacto_nombre, ct.email AS contacto_email,
            cot.numero, cot.total, cot.created_at AS cotizacion_creada_en,
            cot.cliente_nombre, cot.cliente_empresa, cot.cliente_email, cot.cliente_telefono
       FROM crm_seguimientos s
       JOIN crm_oportunidades o ON o.id = s.oportunidad_id
       LEFT JOIN crm_empresas e ON e.id = o.empresa_id
       LEFT JOIN crm_contactos ct ON ct.id = o.contacto_id
       LEFT JOIN cotizaciones cot ON cot.id = s.cotizacion_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.id`,
    params
  );
  return rows.map((r) => ({ ...r, monto: num(r.monto), total: num(r.total) }));
};

/**
 * Cambia la etapa de una oportunidad siguiendo las reglas del contrato CRM:
 * perdida exige motivo; ganada/perdida fijan cerrada_en y una etapa abierta lo limpia;
 * el cambio actualiza etapa_desde. Devuelve true si cambió algo.
 */
const cambiarEtapa = async (db, oportunidadId, etapa, motivo = null) => {
  if (etapa === 'perdida' && !motivo) throw new Error('pasar a perdida exige motivo');
  const { rowCount } = await db.query(
    `UPDATE crm_oportunidades
        SET etapa = $2::text,
            motivo_perdida = CASE WHEN $2::text = 'perdida' THEN $3::text ELSE NULL END,
            etapa_desde = NOW(),
            cerrada_en = CASE WHEN $2::text IN ('ganada', 'perdida') THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id = $1 AND etapa <> $2::text`,
    [Number(oportunidadId), etapa, motivo]
  );
  return rowCount > 0;
};

/**
 * Oportunidades cerradas (ganadas o perdidas) entre dos fechas, con su monto y si
 * estuvieron en seguimiento.
 */
const oportunidadesCerradasEntre = async (db, { desde, hasta }) => {
  const { rows } = await db.query(
    `SELECT o.id, o.etapa, o.motivo_perdida, o.created_at, o.cerrada_en, o.titulo,
            ${MONTO_SQL} AS monto,
            e.nombre AS empresa_nombre,
            (SELECT c3.id FROM cotizaciones c3 WHERE c3.oportunidad_id = o.id
              ORDER BY c3.created_at DESC, c3.id DESC LIMIT 1) AS cotizacion_id,
            EXISTS (SELECT 1 FROM crm_seguimientos s WHERE s.oportunidad_id = o.id) AS en_seguimiento
       FROM crm_oportunidades o
       LEFT JOIN crm_empresas e ON e.id = o.empresa_id
      WHERE o.etapa IN ('ganada', 'perdida')
        AND o.cerrada_en >= $1 AND o.cerrada_en < $2
      ORDER BY o.cerrada_en`,
    [desde, hasta]
  );
  return rows.map((r) => ({ ...r, monto: num(r.monto), cotizacion_id: num(r.cotizacion_id) }));
};

/** Las n oportunidades abiertas de mayor monto. */
const abiertasMasGrandes = async (db, n = 5) => {
  const { rows } = await db.query(
    `SELECT o.id, o.titulo, o.etapa, e.nombre AS empresa_nombre, ${MONTO_SQL} AS monto
       FROM crm_oportunidades o
       LEFT JOIN crm_empresas e ON e.id = o.empresa_id
      WHERE o.etapa IN ('nueva', 'cotizada', 'negociacion')
      ORDER BY monto DESC, o.id
      LIMIT $1`,
    [n]
  );
  return rows.map((r) => ({ ...r, monto: num(r.monto) }));
};

module.exports = {
  ETAPAS_ALTA,
  altaAutomatica,
  oportunidadesParaSeguimiento,
  cambiarEtapa,
  oportunidadesCerradasEntre,
  abiertasMasGrandes
};
