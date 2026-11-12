/**
 * CRM: todas las consultas SQL del modulo. Cada funcion recibe `db` (el pool o un
 * cliente de una transaccion) como primer argumento. Los datos del usuario siempre
 * van como parametros ($n); lo unico que se arma con texto son nombres de columna
 * de listas fijas definidas aca.
 */
const {
  ETAPAS_ABIERTAS,
  estadoDesdeEtapaSql,
  etapaDesdeEstadoSql
} = require('./normalizar');

const ABIERTAS_SQL = `('${ETAPAS_ABIERTAS.join("','")}')`;

/** Valor especial para actualizarFila: la columna toma CURRENT_TIMESTAMP. */
const AHORA = Symbol('crm.ahora');

const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const numeroONull = (valor) =>
  valor === null || valor === undefined ? null : numero(valor);

/** Escapa %, _ y \ para usar el texto del usuario dentro de un patron ILIKE. */
const patronIlike = (texto) => `%${String(texto).replace(/[\\%_]/g, '\\$&')}%`;

// ---------------------------------------------------------------- transacciones

/** Corre `fn(client)` en una transaccion con un cliente propio del pool. */
const conTransaccion = async (pool, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // la conexion ya no sirve; el error original es el que importa
    }
    throw error;
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------- empresas

const COLUMNAS_EMPRESA =
  'id, nombre, nombre_normalizado, rut, sitio, notas, archivada, created_at, updated_at';

/** Empresa por nombre normalizado, propio o como alias de una empresa fusionada/renombrada. */
const buscarEmpresaPorNormalizado = async (db, nombreNormalizado) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_EMPRESA}, 0 AS prioridad FROM crm_empresas WHERE nombre_normalizado = $1
     UNION ALL
     SELECT ${COLUMNAS_EMPRESA.split(', ')
       .map((c) => `e.${c}`)
       .join(', ')}, 1 AS prioridad
       FROM crm_empresas_alias a JOIN crm_empresas e ON e.id = a.empresa_id
      WHERE a.nombre_normalizado = $1
     ORDER BY prioridad
     LIMIT 1`,
    [nombreNormalizado]
  );
  if (!rows[0]) return null;
  const empresa = { ...rows[0] };
  delete empresa.prioridad;
  return empresa;
};

/** Inserta la empresa; si el nombre normalizado ya existe (carrera), devuelve null. */
const insertarEmpresa = async (
  db,
  { nombre, nombre_normalizado, rut = null, sitio = null, notas = null }
) => {
  const { rows } = await db.query(
    `INSERT INTO crm_empresas (nombre, nombre_normalizado, rut, sitio, notas)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (nombre_normalizado) DO NOTHING
     RETURNING ${COLUMNAS_EMPRESA}`,
    [nombre, nombre_normalizado, rut, sitio, notas]
  );
  return rows[0] || null;
};

const obtenerEmpresa = async (db, id, { bloquear = false } = {}) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_EMPRESA} FROM crm_empresas WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0] || null;
};

const CAMPOS_EMPRESA = [
  'nombre',
  'nombre_normalizado',
  'rut',
  'sitio',
  'notas',
  'archivada'
];
const CAMPOS_CONTACTO = [
  'nombre',
  'email',
  'telefono',
  'cargo',
  'notas',
  'archivado'
];
const CAMPOS_OPORTUNIDAD = [
  'titulo',
  'etapa',
  'contacto_id',
  'marca',
  'es_proyecto',
  'monto_manual',
  'fecha_cierre_estimada',
  'motivo_perdida',
  'etapa_desde',
  'cerrada_en'
];

/** UPDATE con solo los campos presentes (de una lista fija) + updated_at. */
const actualizarFila = async (
  db,
  tabla,
  columnasPermitidas,
  columnasRetorno,
  id,
  campos
) => {
  const sets = [];
  const valores = [];
  for (const columna of columnasPermitidas) {
    if (!Object.prototype.hasOwnProperty.call(campos, columna)) continue;
    const valor = campos[columna];
    if (valor === AHORA) {
      sets.push(`${columna} = CURRENT_TIMESTAMP`);
      continue;
    }
    valores.push(valor);
    sets.push(`${columna} = $${valores.length}`);
  }
  sets.push('updated_at = CURRENT_TIMESTAMP');
  valores.push(id);
  const { rows } = await db.query(
    `UPDATE ${tabla} SET ${sets.join(', ')} WHERE id = $${valores.length} RETURNING ${columnasRetorno}`,
    valores
  );
  return rows[0] || null;
};

const actualizarEmpresa = (db, id, campos) =>
  actualizarFila(
    db,
    'crm_empresas',
    CAMPOS_EMPRESA,
    COLUMNAS_EMPRESA,
    id,
    campos
  );

const borrarEmpresa = async (db, id) => {
  await db.query('DELETE FROM crm_empresas WHERE id = $1', [id]);
};

/** Registra un nombre normalizado viejo como alias de una empresa (idempotente). */
const agregarAlias = async (db, nombreNormalizado, empresaId) => {
  await db.query(
    `INSERT INTO crm_empresas_alias (nombre_normalizado, empresa_id) VALUES ($1, $2)
     ON CONFLICT (nombre_normalizado) DO UPDATE SET empresa_id = EXCLUDED.empresa_id`,
    [nombreNormalizado, empresaId]
  );
};

const quitarAlias = async (db, nombreNormalizado) => {
  await db.query(
    'DELETE FROM crm_empresas_alias WHERE nombre_normalizado = $1',
    [nombreNormalizado]
  );
};

const moverAlias = async (db, origenId, destinoId) => {
  await db.query(
    'UPDATE crm_empresas_alias SET empresa_id = $2 WHERE empresa_id = $1',
    [origenId, destinoId]
  );
};

/**
 * Montos de oportunidad: monto_manual, o total de la cotizacion vinculada mas reciente
 * (prefiriendo las no archivadas), o 0.
 */
const MONTO_OPORTUNIDAD_SQL = `COALESCE(o.monto_manual, (
  SELECT c.total FROM cotizaciones c WHERE c.oportunidad_id = o.id
   ORDER BY (c.archivada_en IS NULL) DESC, c.created_at DESC NULLS LAST, c.id DESC LIMIT 1
), 0)`;

const listarEmpresas = async (
  db,
  {
    q = '',
    qNormalizado = '',
    archivadas = false,
    limite = 50,
    offset = 0
  } = {}
) => {
  const params = [];
  const condiciones = [];
  if (!archivadas) condiciones.push('NOT e.archivada');
  if (q) {
    params.push(patronIlike(q));
    const p = `$${params.length}`;
    const partes = [
      `e.nombre ILIKE ${p}`,
      `e.rut ILIKE ${p}`,
      `EXISTS (SELECT 1 FROM crm_contactos ct WHERE ct.empresa_id = e.id AND (ct.nombre ILIKE ${p} OR ct.email ILIKE ${p}))`
    ];
    if (qNormalizado) {
      params.push(patronIlike(qNormalizado));
      partes.push(`e.nombre_normalizado ILIKE $${params.length}`);
    }
    condiciones.push(`(${partes.join(' OR ')})`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const total = await db.query(
    `SELECT COUNT(*)::int AS total FROM crm_empresas e ${where}`,
    params
  );
  params.push(limite, offset);
  const { rows } = await db.query(
    `SELECT e.id, e.nombre, e.rut, e.archivada,
            (SELECT COUNT(*)::int FROM crm_contactos ct WHERE ct.empresa_id = e.id AND NOT ct.archivado) AS contactos,
            COALESCE(op.abiertas, 0) AS oportunidades_abiertas,
            COALESCE(op.monto, 0) AS monto_abierto,
            (SELECT MAX(c.created_at) FROM cotizaciones c WHERE c.empresa_id = e.id) AS ultima_cotizacion_en
       FROM crm_empresas e
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS abiertas, SUM(${MONTO_OPORTUNIDAD_SQL}) AS monto
           FROM crm_oportunidades o
          WHERE o.empresa_id = e.id AND o.etapa IN ${ABIERTAS_SQL} AND o.archivada_en IS NULL
       ) op ON true
       ${where}
      ORDER BY ultima_cotizacion_en DESC NULLS LAST, e.nombre ASC, e.id ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    items: rows.map((r) => ({ ...r, monto_abierto: numero(r.monto_abierto) })),
    total: total.rows[0]?.total || 0
  };
};

/** Todas las empresas con su cantidad de cotizaciones, para buscar duplicados. */
const listarEmpresasParaDuplicados = async (db) => {
  const { rows } = await db.query(
    `SELECT e.id, e.nombre, e.nombre_normalizado,
            (SELECT COUNT(*)::int FROM cotizaciones c WHERE c.empresa_id = e.id) AS cotizaciones
       FROM crm_empresas e
      WHERE NOT e.archivada
      ORDER BY e.nombre_normalizado, e.id`
  );
  return rows;
};

// ---------------------------------------------------------------- contactos

const COLUMNAS_CONTACTO =
  'id, empresa_id, nombre, email, telefono, cargo, notas, archivado, created_at, updated_at';

const buscarContactoPorEmail = async (db, empresaId, email) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_CONTACTO} FROM crm_contactos
      WHERE empresa_id = $1 AND LOWER(email) = LOWER($2)
      ORDER BY id LIMIT 1`,
    [empresaId, email]
  );
  return rows[0] || null;
};

/** Contacto por nombre (sin distinguir mayusculas ni espacios de mas) dentro de la empresa. */
const buscarContactoPorNombre = async (db, empresaId, nombre) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_CONTACTO} FROM crm_contactos
      WHERE empresa_id = $1 AND LOWER(REGEXP_REPLACE(TRIM(nombre), '\\s+', ' ', 'g')) = LOWER($2)
      ORDER BY (email IS NULL) DESC, id LIMIT 1`,
    [empresaId, nombre]
  );
  return rows[0] || null;
};

/** Inserta el contacto; si choca el email dentro de la empresa, devuelve null. */
const insertarContacto = async (
  db,
  {
    empresa_id,
    nombre,
    email = null,
    telefono = null,
    cargo = null,
    notas = null
  }
) => {
  const { rows } = await db.query(
    `INSERT INTO crm_contactos (empresa_id, nombre, email, telefono, cargo, notas)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING ${COLUMNAS_CONTACTO}`,
    [empresa_id, nombre, email, telefono, cargo, notas]
  );
  return rows[0] || null;
};

const obtenerContacto = async (db, id) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_CONTACTO} FROM crm_contactos WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
};

const actualizarContacto = (db, id, campos) =>
  actualizarFila(
    db,
    'crm_contactos',
    CAMPOS_CONTACTO,
    COLUMNAS_CONTACTO,
    id,
    campos
  );

const listarContactosDeEmpresa = async (db, empresaId) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_CONTACTO} FROM crm_contactos WHERE empresa_id = $1 ORDER BY archivado, nombre, id`,
    [empresaId]
  );
  return rows;
};

/** Repunta cotizaciones y oportunidades de un contacto a otro y borra el primero. */
const reemplazarContacto = async (db, origenId, destinoId) => {
  await db.query(
    'UPDATE cotizaciones SET contacto_id = $2 WHERE contacto_id = $1',
    [origenId, destinoId]
  );
  await db.query(
    'UPDATE crm_oportunidades SET contacto_id = $2, updated_at = CURRENT_TIMESTAMP WHERE contacto_id = $1',
    [origenId, destinoId]
  );
  await db.query('DELETE FROM crm_contactos WHERE id = $1', [origenId]);
};

const moverContactos = async (db, origenEmpresaId, destinoEmpresaId) => {
  const res = await db.query(
    'UPDATE crm_contactos SET empresa_id = $2, updated_at = CURRENT_TIMESTAMP WHERE empresa_id = $1',
    [origenEmpresaId, destinoEmpresaId]
  );
  return res.rowCount || 0;
};

// ---------------------------------------------------------------- oportunidades

const COLUMNAS_OPORTUNIDAD = `id, empresa_id, contacto_id, titulo, etapa, marca, es_proyecto, monto_manual, bo,
  to_char(fecha_cierre_estimada, 'YYYY-MM-DD') AS fecha_cierre_estimada, motivo_perdida, etapa_desde, cerrada_en,
  created_at, updated_at`;

const SELECT_RESUMEN = `
  SELECT o.id, o.titulo, o.etapa, o.empresa_id, e.nombre AS empresa_nombre, o.contacto_id,
         ct.nombre AS contacto_nombre, o.marca, o.es_proyecto,
         ${MONTO_OPORTUNIDAD_SQL} AS monto,
         to_char(o.fecha_cierre_estimada, 'YYYY-MM-DD') AS fecha_cierre_estimada, o.motivo_perdida,
         (SELECT COUNT(*)::int FROM cotizaciones c WHERE c.oportunidad_id = o.id) AS cotizaciones,
         cv.id AS cotizacion_id, cv.numero AS cotizacion_numero,
         GREATEST(0, (CURRENT_TIMESTAMP::date - o.etapa_desde::date))::int AS dias_en_etapa,
         o.cerrada_en, o.archivada_en, o.created_at, o.updated_at
    FROM crm_oportunidades o
    JOIN crm_empresas e ON e.id = o.empresa_id
    LEFT JOIN crm_contactos ct ON ct.id = o.contacto_id
    LEFT JOIN LATERAL (
      SELECT c.id, c.numero FROM cotizaciones c
       WHERE c.oportunidad_id = o.id AND c.archivada_en IS NULL
       ORDER BY c.created_at DESC NULLS LAST, c.id DESC LIMIT 1
    ) cv ON true`;

const aResumen = (row) => ({ ...row, monto: numero(row.monto) });

const insertarOportunidad = async (db, datos) => {
  const {
    empresa_id,
    contacto_id = null,
    titulo,
    etapa = 'nueva',
    marca = null,
    es_proyecto = false,
    monto_manual = null,
    fecha_cierre_estimada = null,
    motivo_perdida = null,
    etapa_desde = null,
    cerrada_en = null,
    created_at = null,
    bo = null
  } = datos;
  const { rows } = await db.query(
    `INSERT INTO crm_oportunidades (
       empresa_id, contacto_id, titulo, etapa, marca, es_proyecto, monto_manual, fecha_cierre_estimada,
       motivo_perdida, etapa_desde, cerrada_en, created_at, updated_at, bo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             COALESCE($10::timestamp, CURRENT_TIMESTAMP),
             CASE WHEN $13::boolean THEN CURRENT_TIMESTAMP ELSE $11::timestamp END,
             COALESCE($12::timestamp, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, $14)
     ON CONFLICT (bo) WHERE bo IS NOT NULL DO NOTHING
     RETURNING ${COLUMNAS_OPORTUNIDAD}`,
    [
      empresa_id,
      contacto_id,
      titulo,
      etapa,
      marca,
      es_proyecto,
      monto_manual,
      fecha_cierre_estimada,
      motivo_perdida,
      etapa_desde === AHORA ? null : etapa_desde,
      cerrada_en === AHORA ? null : cerrada_en,
      created_at,
      cerrada_en === AHORA,
      bo
    ]
  );
  // undefined = otra transaccion inserto el mismo BO entre medio: lo resuelve quien llama.
  return rows[0];
};

/** La oportunidad de un BO, o null. Clave de idempotencia de la sincronizacion. */
const buscarOportunidadPorBo = async (db, bo) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_OPORTUNIDAD} FROM crm_oportunidades WHERE bo = $1`,
    [bo]
  );
  return rows[0] || null;
};

/**
 * Oportunidades abiertas (no cerradas ni archivadas) de una empresa que aun no tienen
 * BO. Si hay exactamente una, la orden que llega es su cierre y se le engancha en vez
 * de crear una oportunidad nueva y duplicar el negocio en el embudo.
 */
const oportunidadesAbiertasSinBo = async (db, empresaId) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_OPORTUNIDAD} FROM crm_oportunidades
      WHERE empresa_id = $1 AND bo IS NULL AND archivada_en IS NULL
        AND etapa IN ('nueva', 'cotizada', 'negociacion')
      ORDER BY created_at ASC`,
    [empresaId]
  );
  return rows;
};

/** Marca el BO en una oportunidad existente. No pisa un BO ya puesto. */
const asignarBo = async (db, oportunidadId, bo) => {
  const { rows } = await db.query(
    `UPDATE crm_oportunidades SET bo = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND bo IS NULL
      RETURNING ${COLUMNAS_OPORTUNIDAD}`,
    [oportunidadId, bo]
  );
  return rows[0] || null;
};

/**
 * Ordenes vigentes de la pestana OSO, ya persistidas en bo_meta por
 * GET /api/oso/orders, con el monto que suman sus lineas en bo_line_meta.
 * Se excluyen las borradas logicamente.
 */
const ordenesVigentes = async (db, { limite = 5000 } = {}) => {
  const { rows } = await db.query(
    `SELECT m.bo,
            NULLIF(TRIM(COALESCE(m.customer_name, '')), '') AS cliente,
            NULLIF(TRIM(COALESCE(m.customer_po, '')), '')   AS customer_po,
            m.last_seen_at,
            (SELECT COALESCE(SUM(l.monto_intcomex), 0) FROM bo_line_meta l WHERE l.bo = m.bo) AS monto
       FROM bo_meta m
      WHERE m.deleted IS NOT TRUE
      ORDER BY m.bo
      LIMIT $1`,
    [limite]
  );
  return rows;
};

const obtenerOportunidad = async (db, id, { bloquear = false } = {}) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_OPORTUNIDAD} FROM crm_oportunidades WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0] || null;
};

const actualizarOportunidad = (db, id, campos) =>
  actualizarFila(
    db,
    'crm_oportunidades',
    CAMPOS_OPORTUNIDAD,
    COLUMNAS_OPORTUNIDAD,
    id,
    campos
  );

const obtenerResumenOportunidad = async (db, id) => {
  const { rows } = await db.query(`${SELECT_RESUMEN} WHERE o.id = $1`, [id]);
  return rows[0] ? aResumen(rows[0]) : null;
};

const listarOportunidades = async (
  db,
  { etapa, empresa_id, q, abiertas, limite = 500, offset = 0 } = {}
) => {
  const params = [];
  // Las archivadas no se listan (tampoco en la ficha de la empresa).
  const condiciones = ['o.archivada_en IS NULL'];
  if (etapa) {
    params.push(etapa);
    condiciones.push(`o.etapa = $${params.length}`);
  }
  if (empresa_id) {
    params.push(empresa_id);
    condiciones.push(`o.empresa_id = $${params.length}`);
  }
  if (abiertas) condiciones.push(`o.etapa IN ${ABIERTAS_SQL}`);
  if (q) {
    params.push(patronIlike(q));
    const p = `$${params.length}`;
    condiciones.push(
      `(o.titulo ILIKE ${p} OR e.nombre ILIKE ${p} OR ct.nombre ILIKE ${p})`
    );
  }
  params.push(limite, offset);
  const where = `WHERE ${condiciones.join(' AND ')}`;
  const { rows } = await db.query(
    `${SELECT_RESUMEN} ${where}
      ORDER BY o.updated_at DESC, o.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(aResumen);
};

/** Totales por etapa y del mes en curso (en una consulta). Sin las archivadas. */
const totalesEmbudo = async (db) => {
  const { rows } = await db.query(
    `WITH ops AS (
       SELECT o.etapa, o.cerrada_en, ${MONTO_OPORTUNIDAD_SQL} AS monto FROM crm_oportunidades o
        WHERE o.archivada_en IS NULL
     ),
     mes AS (SELECT date_trunc('month', CURRENT_TIMESTAMP)::timestamp AS desde)
     SELECT 'etapa' AS tipo, etapa AS clave, COUNT(*)::int AS cantidad, COALESCE(SUM(monto), 0) AS monto
       FROM ops GROUP BY etapa
     UNION ALL
     SELECT 'mes', etapa, COUNT(*)::int, COALESCE(SUM(monto), 0)
       FROM ops, mes
      WHERE etapa IN ('ganada', 'perdida') AND cerrada_en >= mes.desde
      GROUP BY etapa`
  );
  return rows.map((r) => ({ ...r, monto: numero(r.monto) }));
};

const moverOportunidades = async (db, origenEmpresaId, destinoEmpresaId) => {
  const res = await db.query(
    'UPDATE crm_oportunidades SET empresa_id = $2, updated_at = CURRENT_TIMESTAMP WHERE empresa_id = $1',
    [origenEmpresaId, destinoEmpresaId]
  );
  return res.rowCount || 0;
};

/**
 * Deriva cotizaciones.estado de la etapa ACTUAL de la oportunidad, en todas sus
 * cotizaciones. Se llama siempre que cambia la etapa. Devuelve cuantas cambiaron.
 */
const derivarEstadoCotizaciones = async (db, oportunidadId) => {
  const res = await db.query(
    `UPDATE cotizaciones c
        SET estado = ${estadoDesdeEtapaSql('o.etapa')}
       FROM crm_oportunidades o
      WHERE o.id = $1 AND c.oportunidad_id = o.id
        AND c.estado IS DISTINCT FROM ${estadoDesdeEtapaSql('o.etapa')}`,
    [oportunidadId]
  );
  return res?.rowCount || 0;
};

// ---------------------------------------------------------------- cotizaciones

const COLUMNAS_COTIZACION_CRM = `c.id, c.numero, c.cliente_nombre, c.cliente_empresa, c.cliente_email,
  c.cliente_telefono, c.total, c.estado, c.created_at, c.empresa_id, c.contacto_id, c.oportunidad_id`;

/** Bloquea la cotizacion si aun no esta enlazada al CRM. null si ya lo esta o no existe. */
const bloquearCotizacionSinEnlace = async (db, id) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_COTIZACION_CRM} FROM cotizaciones c
      WHERE c.id = $1 AND c.empresa_id IS NULL AND c.oportunidad_id IS NULL
      FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
};

const obtenerCotizacion = async (db, id, { bloquear = false } = {}) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_COTIZACION_CRM} FROM cotizaciones c WHERE c.id = $1${bloquear ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0] || null;
};

/**
 * Lote de cotizaciones sin enlazar (id > desdeId), con los origenes de sus lineas.
 * SKIP LOCKED: si otra instancia o el enlace automatico tiene una tomada, se salta.
 */
const loteCotizacionesSinEnlace = async (
  db,
  { desdeId = 0, limite = 200 } = {}
) => {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_COTIZACION_CRM},
            ARRAY(SELECT DISTINCT UPPER(ci.origen) FROM cotizacion_items ci
                   WHERE ci.cotizacion_id = c.id AND ci.origen IS NOT NULL) AS origenes
       FROM cotizaciones c
      WHERE c.empresa_id IS NULL AND c.oportunidad_id IS NULL AND c.id > $1
      ORDER BY c.id
      LIMIT $2
      FOR UPDATE OF c SKIP LOCKED`,
    [desdeId, limite]
  );
  return rows;
};

const vincularCotizacion = async (
  db,
  id,
  { empresa_id, contacto_id, oportunidad_id }
) => {
  const { rows } = await db.query(
    `UPDATE cotizaciones SET empresa_id = $2, contacto_id = $3, oportunidad_id = $4 WHERE id = $1
     RETURNING id, empresa_id, contacto_id, oportunidad_id`,
    [id, empresa_id, contacto_id, oportunidad_id]
  );
  return rows[0] || null;
};

const moverCotizaciones = async (db, origenEmpresaId, destinoEmpresaId) => {
  const res = await db.query(
    'UPDATE cotizaciones SET empresa_id = $2 WHERE empresa_id = $1',
    [origenEmpresaId, destinoEmpresaId]
  );
  return res.rowCount || 0;
};

/** Cotizacion con su etapa (la de su oportunidad o, sin oportunidad, la derivada del estado). */
const obtenerCotizacionConEtapa = async (db, id) => {
  const { rows } = await db.query(
    `SELECT c.*, COALESCE(o.etapa, ${etapaDesdeEstadoSql('c.estado')}) AS etapa,
            o.motivo_perdida
       FROM cotizaciones c
       LEFT JOIN crm_oportunidades o ON o.id = c.oportunidad_id
      WHERE c.id = $1`,
    [id]
  );
  return rows[0] || null;
};

/** Guarda solo el estado (cotizacion sin oportunidad). */
const guardarEstadoCotizacion = async (db, id, estado) => {
  const res = await db.query(
    'UPDATE cotizaciones SET estado = $2 WHERE id = $1',
    [id, estado]
  );
  return res?.rowCount || 0;
};

/** Cotizaciones no archivadas de la empresa (la ficha). */
const listarCotizacionesDeEmpresa = async (db, empresaId, limite = 500) => {
  const { rows } = await db.query(
    `SELECT id, numero, total, estado, created_at, contacto_id, oportunidad_id
       FROM cotizaciones WHERE empresa_id = $1 AND archivada_en IS NULL
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $2`,
    [empresaId, limite]
  );
  return rows.map((r) => ({ ...r, total: numeroONull(r.total) }));
};

const resumenCotizacionesEmpresa = async (db, empresaId) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS cotizaciones, COALESCE(SUM(total), 0) AS monto_cotizado
       FROM cotizaciones WHERE empresa_id = $1 AND archivada_en IS NULL`,
    [empresaId]
  );
  return {
    cotizaciones: rows[0]?.cotizaciones || 0,
    monto_cotizado: numero(rows[0]?.monto_cotizado)
  };
};

/** Cuantas oportunidades y cotizaciones archivadas tiene la empresa (no salen en la ficha). */
const contarArchivadasDeEmpresa = async (db, empresaId) => {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM crm_oportunidades
              WHERE empresa_id = $1 AND archivada_en IS NOT NULL) AS oportunidades,
            (SELECT COUNT(*)::int FROM cotizaciones
              WHERE empresa_id = $1 AND archivada_en IS NOT NULL) AS cotizaciones`,
    [empresaId]
  );
  return {
    oportunidades: rows[0]?.oportunidades || 0,
    cotizaciones: rows[0]?.cotizaciones || 0
  };
};

// ---------------------------------------------------------------- archivado

const SIN_COTIZACIONES_SQL =
  'NOT EXISTS (SELECT 1 FROM cotizaciones c WHERE c.oportunidad_id = o.id)';
const TODAS_ARCHIVADAS_SQL = `EXISTS (SELECT 1 FROM cotizaciones c WHERE c.oportunidad_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM cotizaciones c WHERE c.oportunidad_id = o.id AND c.archivada_en IS NULL)`;

/**
 * Archiva cotizaciones (por ids, o todas las no archivadas creadas antes de `antesDe`
 * 'YYYY-MM-DD') y luego las oportunidades que quedaron sin ninguna cotizacion vigente
 * (con `antesDe`, tambien las oportunidades sin cotizaciones creadas antes de esa fecha).
 * Va dentro de la transaccion del llamador. Devuelve { cotizaciones, oportunidades }.
 */
const archivarCotizaciones = async (db, { ids = null, antesDe = null }) => {
  if (ids) {
    const cot = await db.query(
      `UPDATE cotizaciones SET archivada_en = CURRENT_TIMESTAMP
        WHERE id = ANY($1::int[]) AND archivada_en IS NULL
        RETURNING id, oportunidad_id`,
      [ids]
    );
    const oportunidadIds = [
      ...new Set(cot.rows.map((r) => r.oportunidad_id).filter(Boolean))
    ];
    const ops = oportunidadIds.length
      ? await db.query(
          `UPDATE crm_oportunidades o SET archivada_en = CURRENT_TIMESTAMP
            WHERE o.id = ANY($1::int[]) AND o.archivada_en IS NULL
              AND ${TODAS_ARCHIVADAS_SQL}
            RETURNING o.id`,
          [oportunidadIds]
        )
      : { rows: [] };
    return { cotizaciones: cot.rows.length, oportunidades: ops.rows.length };
  }
  const cot = await db.query(
    `UPDATE cotizaciones SET archivada_en = CURRENT_TIMESTAMP
      WHERE archivada_en IS NULL AND created_at < $1::date
      RETURNING id`,
    [antesDe]
  );
  const ops = await db.query(
    `UPDATE crm_oportunidades o SET archivada_en = CURRENT_TIMESTAMP
      WHERE o.archivada_en IS NULL
        AND ((${TODAS_ARCHIVADAS_SQL})
             OR (${SIN_COTIZACIONES_SQL} AND o.created_at < $1::date))
      RETURNING o.id`,
    [antesDe]
  );
  return { cotizaciones: cot.rows.length, oportunidades: ops.rows.length };
};

/** Lo que archivaria archivarCotizaciones({ antesDe }), sin modificar nada. */
const previaArchivado = async (db, { antesDe }) => {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM cotizaciones
              WHERE archivada_en IS NULL AND created_at < $1::date) AS cotizaciones,
            (SELECT COUNT(*)::int FROM crm_oportunidades o
              WHERE o.archivada_en IS NULL
                AND ((EXISTS (SELECT 1 FROM cotizaciones c WHERE c.oportunidad_id = o.id)
                      AND NOT EXISTS (SELECT 1 FROM cotizaciones c
                                       WHERE c.oportunidad_id = o.id AND c.archivada_en IS NULL
                                         AND (c.created_at IS NULL OR c.created_at >= $1::date)))
                     OR (${SIN_COTIZACIONES_SQL} AND o.created_at < $1::date))) AS oportunidades`,
    [antesDe]
  );
  return {
    cotizaciones: rows[0]?.cotizaciones || 0,
    oportunidades: rows[0]?.oportunidades || 0
  };
};

/** Quita archivada_en a esas cotizaciones y a sus oportunidades. { cotizaciones, oportunidades }. */
const restaurarCotizaciones = async (db, { ids }) => {
  const cot = await db.query(
    `UPDATE cotizaciones SET archivada_en = NULL
      WHERE id = ANY($1::int[]) AND archivada_en IS NOT NULL
      RETURNING id`,
    [ids]
  );
  const ops = await db.query(
    `UPDATE crm_oportunidades o SET archivada_en = NULL
      WHERE o.archivada_en IS NOT NULL
        AND o.id IN (SELECT c.oportunidad_id FROM cotizaciones c WHERE c.id = ANY($1::int[]))
      RETURNING o.id`,
    [ids]
  );
  return { cotizaciones: cot.rows.length, oportunidades: ops.rows.length };
};

module.exports = {
  buscarOportunidadPorBo,
  oportunidadesAbiertasSinBo,
  asignarBo,
  ordenesVigentes,
  AHORA,
  patronIlike,
  conTransaccion,
  // empresas
  buscarEmpresaPorNormalizado,
  insertarEmpresa,
  obtenerEmpresa,
  actualizarEmpresa,
  borrarEmpresa,
  agregarAlias,
  quitarAlias,
  moverAlias,
  listarEmpresas,
  listarEmpresasParaDuplicados,
  // contactos
  buscarContactoPorEmail,
  buscarContactoPorNombre,
  insertarContacto,
  obtenerContacto,
  actualizarContacto,
  listarContactosDeEmpresa,
  reemplazarContacto,
  moverContactos,
  // oportunidades
  insertarOportunidad,
  obtenerOportunidad,
  actualizarOportunidad,
  obtenerResumenOportunidad,
  listarOportunidades,
  totalesEmbudo,
  moverOportunidades,
  derivarEstadoCotizaciones,
  // cotizaciones
  bloquearCotizacionSinEnlace,
  obtenerCotizacion,
  loteCotizacionesSinEnlace,
  vincularCotizacion,
  moverCotizaciones,
  obtenerCotizacionConEtapa,
  guardarEstadoCotizacion,
  listarCotizacionesDeEmpresa,
  resumenCotizacionesEmpresa,
  contarArchivadasDeEmpresa,
  // archivado
  archivarCotizaciones,
  previaArchivado,
  restaurarCotizaciones
};
