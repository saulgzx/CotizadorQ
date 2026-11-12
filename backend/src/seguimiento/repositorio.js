// SQL propio del seguimiento: esquema (idempotente), estado de cada seguimiento,
// eventos de auditoría, estado del planificador y datos de la cotización para los
// borradores. Lo que toca tablas del CRM vive en crmAdaptador.js.

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS crm_seguimientos (
     id SERIAL PRIMARY KEY,
     oportunidad_id INTEGER NOT NULL,
     cotizacion_id INTEGER,
     estado VARCHAR(30) NOT NULL DEFAULT 'buscando_envio',
     paso SMALLINT NOT NULL DEFAULT 0,
     conversation_id TEXT,
     message_id TEXT,
     enviado_en TIMESTAMPTZ,
     ultimo_envio_mio_en TIMESTAMPTZ,
     proxima_accion VARCHAR(30),
     proxima_accion_en TIMESTAMPTZ,
     borrador_id TEXT,
     borrador_creado_en TIMESTAMPTZ,
     respuesta_en TIMESTAMPTZ,
     respuesta_resumen VARCHAR(400),
     intentos_busqueda INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Columnas internas del motor (no forman parte del contrato visible).
  `ALTER TABLE crm_seguimientos ADD COLUMN IF NOT EXISTS borrador_paso SMALLINT`,
  `ALTER TABLE crm_seguimientos ADD COLUMN IF NOT EXISTS borrador_fallos INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE crm_seguimientos ADD COLUMN IF NOT EXISTS borrador_fallo_en TIMESTAMPTZ`,
  `ALTER TABLE crm_seguimientos ADD COLUMN IF NOT EXISTS ultima_revision_en TIMESTAMPTZ`,
  `ALTER TABLE crm_seguimientos ADD COLUMN IF NOT EXISTS estado_antes_pausa VARCHAR(30)`,
  `ALTER TABLE crm_seguimientos ADD COLUMN IF NOT EXISTS busqueda_desde TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE crm_seguimientos ADD COLUMN IF NOT EXISTS cerrada_en TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crm_seguimientos_oportunidad_uidx ON crm_seguimientos(oportunidad_id)`,
  `CREATE INDEX IF NOT EXISTS crm_seguimientos_estado_idx ON crm_seguimientos(estado)`,
  `CREATE TABLE IF NOT EXISTS crm_seguimiento_eventos (
     id BIGSERIAL PRIMARY KEY,
     oportunidad_id INTEGER,
     tipo VARCHAR(40) NOT NULL,
     detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS crm_seguimiento_eventos_op_idx ON crm_seguimiento_eventos(oportunidad_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS crm_seguimiento_eventos_tipo_idx ON crm_seguimiento_eventos(tipo, created_at)`,
  `CREATE TABLE IF NOT EXISTS crm_seguimiento_tareas (
     id SERIAL PRIMARY KEY,
     tipo VARCHAR(30) NOT NULL,
     estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
     items JSONB NOT NULL DEFAULT '[]'::jsonb,
     intentos INTEGER NOT NULL DEFAULT 0,
     disponible_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     tomada_en TIMESTAMPTZ,
     terminada_en TIMESTAMPTZ,
     error TEXT,
     metricas JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS crm_seguimiento_tareas_estado_idx ON crm_seguimiento_tareas(estado, disponible_desde)`,
  `CREATE TABLE IF NOT EXISTS crm_seguimiento_estado (
     clave VARCHAR(60) PRIMARY KEY,
     valor TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`
];

// Claves foráneas al CRM: solo si sus tablas ya existen (el CRM se crea en otro módulo
// y puede inicializarse después). Se reintenta en cada arranque.
const FOREIGN_KEYS = `DO $$
BEGIN
  IF to_regclass('public.crm_oportunidades') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_seguimientos_oportunidad_fk'
  ) THEN
    ALTER TABLE crm_seguimientos ADD CONSTRAINT crm_seguimientos_oportunidad_fk
      FOREIGN KEY (oportunidad_id) REFERENCES crm_oportunidades(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_seguimientos_cotizacion_fk') THEN
    ALTER TABLE crm_seguimientos ADD CONSTRAINT crm_seguimientos_cotizacion_fk
      FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id) ON DELETE SET NULL;
  END IF;
END $$;`;

const crearEsquema = async (db, logger = console) => {
  for (const sql of ESQUEMA) await db.query(sql);
  try {
    await db.query(FOREIGN_KEYS);
  } catch (error) {
    logger.warn?.({ event: 'seguimiento_fk_pendiente', msg: error?.message }, 'Claves foráneas del seguimiento pendientes');
  }
};

// Columnas que el motor puede cambiar.
const COLUMNAS = new Set([
  'estado', 'paso', 'conversation_id', 'message_id', 'enviado_en', 'ultimo_envio_mio_en',
  'proxima_accion', 'proxima_accion_en', 'borrador_id', 'borrador_creado_en', 'respuesta_en',
  'respuesta_resumen', 'intentos_busqueda', 'borrador_paso', 'borrador_fallos', 'borrador_fallo_en',
  'ultima_revision_en', 'estado_antes_pausa', 'busqueda_desde', 'cerrada_en'
]);

const crearRepositorio = (db) => ({
  crearEsquema: (logger) => crearEsquema(db, logger),

  /**
   * Actualiza un seguimiento solo si sigue en `estadoEsperado` (evita pisar un cambio
   * concurrente). Devuelve la fila actualizada o null.
   */
  async actualizar(id, estadoEsperado, cambios) {
    const cols = Object.keys(cambios).filter((c) => COLUMNAS.has(c));
    const params = [id, estadoEsperado];
    const sets = cols.map((c) => {
      params.push(cambios[c]);
      return `${c} = $${params.length}`;
    });
    sets.push('updated_at = NOW()');
    const { rows } = await db.query(
      `UPDATE crm_seguimientos SET ${sets.join(', ')} WHERE id = $1 AND estado = $2 RETURNING *`,
      params
    );
    return rows[0] || null;
  },

  async registrarEventos(oportunidadId, eventos) {
    for (const e of eventos || []) {
      await db.query(
        'INSERT INTO crm_seguimiento_eventos (oportunidad_id, tipo, detalle) VALUES ($1, $2, $3::jsonb)',
        [oportunidadId ?? null, e.tipo, JSON.stringify(e.detalle || {})]
      );
    }
  },

  async eventosDe(oportunidadId, limite = 200) {
    const { rows } = await db.query(
      `SELECT id, oportunidad_id, tipo, detalle, created_at FROM crm_seguimiento_eventos
        WHERE oportunidad_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [oportunidadId, limite]
    );
    return rows;
  },

  async eventosEntre(desde, hasta, tipos = null) {
    const params = [desde, hasta];
    let filtro = '';
    if (tipos) {
      params.push(tipos);
      filtro = 'AND tipo = ANY($3::text[])';
    }
    const { rows } = await db.query(
      `SELECT id, oportunidad_id, tipo, detalle, created_at FROM crm_seguimiento_eventos
        WHERE created_at >= $1 AND created_at < $2 ${filtro} ORDER BY created_at, id`,
      params
    );
    return rows;
  },

  /** Eventos `respuesta` de estas oportunidades (cualquier fecha). */
  async respuestasDe(oportunidadIds) {
    if (!oportunidadIds.length) return [];
    const { rows } = await db.query(
      `SELECT oportunidad_id, detalle, created_at FROM crm_seguimiento_eventos
        WHERE tipo = 'respuesta' AND oportunidad_id = ANY($1::int[])`,
      [oportunidadIds]
    );
    return rows;
  },

  async leerEstado(clave) {
    const { rows } = await db.query('SELECT valor FROM crm_seguimiento_estado WHERE clave = $1', [clave]);
    return rows[0]?.valor ?? null;
  },

  async guardarEstado(clave, valor) {
    await db.query(
      `INSERT INTO crm_seguimiento_estado (clave, valor, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
      [clave, valor === null || valor === undefined ? null : String(valor)]
    );
  },

  /**
   * Líneas de la cotización con la entrega VIGENTE del catálogo (productos.tiempo_entrega,
   * que el sync recalcula con la ETA de Axis) y, si no hay producto, la de la cotización.
   */
  async lineasCotizacion(cotizacionId) {
    const { rows } = await db.query(
      `SELECT ci.descripcion, ci.cantidad, ci.sku, ci.mpn, ci.precio_total, ci.costo_unitario,
              COALESCE(NULLIF(p.tiempo_entrega, ''), ci.tiempo_entrega) AS entrega
         FROM cotizacion_items ci
         LEFT JOIN productos p ON p.id = ci.producto_id
        WHERE ci.cotizacion_id = $1
        ORDER BY ci.orden NULLS LAST, ci.id`,
      [cotizacionId]
    );
    return rows;
  },

  /** Margen (precio - costo) de varias cotizaciones; null si ninguna línea tiene costo. */
  async margenCotizaciones(cotizacionIds) {
    if (!cotizacionIds.length) return new Map();
    const { rows } = await db.query(
      `SELECT cotizacion_id,
              SUM(precio_total - costo_unitario * cantidad) FILTER (WHERE costo_unitario IS NOT NULL) AS margen,
              COUNT(*) FILTER (WHERE costo_unitario IS NOT NULL) AS con_costo
         FROM cotizacion_items WHERE cotizacion_id = ANY($1::int[])
        GROUP BY cotizacion_id`,
      [cotizacionIds]
    );
    return new Map(
      rows.map((r) => [Number(r.cotizacion_id), Number(r.con_costo) > 0 ? Number(r.margen) : null])
    );
  }
});

module.exports = { ESQUEMA, crearEsquema, crearRepositorio };
