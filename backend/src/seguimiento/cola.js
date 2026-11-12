// Cola persistente de tareas de correo para el agente del miniPC (tabla
// crm_seguimiento_tareas). Una tarea agrupa hasta 20 ítems; el agente la toma, la
// procesa y devuelve el resultado. Si no la devuelve en 15 minutos o devuelve un
// resultado malformado/fallido, vuelve a la cola (reintento a los 15 min), máximo 3
// intentos. El estado de los seguimientos solo cambia con un resultado válido.

const { EventEmitter } = require('events');
const { validarResultado } = require('./esquemas');
const { INSTRUCCIONES } = require('./instrucciones');

const CLAVE_ITEM = {
  buscar_envios: 'cotizacion_id',
  revisar_hilos: 'oportunidad_id',
  crear_borradores: 'oportunidad_id'
};

const trozos = (lista, n) => {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
};

const iso = (t) => new Date(t).toISOString();

const crearCola = ({
  db,
  config = { maxItems: 20, reintentoMs: 15 * 60 * 1000, tomaVenceMs: 15 * 60 * 1000, maxIntentos: 3 },
  ahora = () => Date.now(),
  logger = console,
  esperar = (ms, emisor) =>
    new Promise((resolve) => {
      const timer = setTimeout(listo, ms);
      function listo() {
        clearTimeout(timer);
        emisor.off('nueva', listo);
        resolve();
      }
      emisor.once('nueva', listo);
    })
}) => {
  const emisor = new EventEmitter();
  emisor.setMaxListeners(50);

  const aTarea = (fila) => ({
    id: fila.id,
    tipo: fila.tipo,
    creada_en: iso(fila.created_at),
    items: fila.items,
    instrucciones: INSTRUCCIONES[fila.tipo]
  });

  /** Encola los ítems en tareas de hasta maxItems. Devuelve los ids creados. */
  const encolar = async (tipo, items) => {
    const ids = [];
    for (const grupo of trozos(items, config.maxItems)) {
      const { rows } = await db.query(
        `INSERT INTO crm_seguimiento_tareas (tipo, estado, items, disponible_desde, created_at)
         VALUES ($1, 'pendiente', $2::jsonb, $3, $3) RETURNING id`,
        [tipo, JSON.stringify(grupo), iso(ahora())]
      );
      ids.push(rows[0].id);
    }
    if (ids.length) emisor.emit('nueva');
    return ids;
  };

  /** Ids (según el tipo) que ya están en una tarea pendiente o tomada de ese tipo. */
  const idsEnCurso = async (tipo) => {
    const { rows } = await db.query(
      `SELECT items FROM crm_seguimiento_tareas WHERE tipo = $1 AND estado IN ('pendiente', 'tomada')`,
      [tipo]
    );
    const clave = CLAVE_ITEM[tipo];
    const ids = new Set();
    for (const r of rows) for (const it of r.items || []) ids.add(Number(it[clave]));
    return ids;
  };

  /** Tareas tomadas hace más de 15 min: vuelven a la cola o fallan si agotaron intentos. */
  const vencerTomadas = async () => {
    const t = ahora();
    const { rows } = await db.query(
      `UPDATE crm_seguimiento_tareas
          SET estado = CASE WHEN intentos >= $3 THEN 'fallida' ELSE 'pendiente' END,
              error = 'sin resultado del agente en el plazo',
              tomada_en = NULL,
              disponible_desde = $1,
              terminada_en = CASE WHEN intentos >= $3 THEN $1::timestamptz ELSE NULL END
        WHERE estado = 'tomada' AND tomada_en < $2
        RETURNING id, tipo, estado`,
      [iso(t), iso(t - config.tomaVenceMs), config.maxIntentos]
    );
    for (const r of rows) {
      if (r.estado === 'fallida') {
        logger.warn?.({ event: 'seguimiento_tarea_fallida', id: r.id, tipo: r.tipo }, 'Tarea de seguimiento agotó sus intentos');
      }
    }
    return rows;
  };

  /** Toma la tarea pendiente más antigua, o null. */
  const tomar = async () => {
    await vencerTomadas();
    const t = iso(ahora());
    const { rows } = await db.query(
      `UPDATE crm_seguimiento_tareas
          SET estado = 'tomada', tomada_en = $1, intentos = intentos + 1
        WHERE id = (
          SELECT id FROM crm_seguimiento_tareas
           WHERE estado = 'pendiente' AND disponible_desde <= $1
           ORDER BY id LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
      [t]
    );
    return rows[0] ? aTarea(rows[0]) : null;
  };

  /** Long poll: espera hasta esperaMs a que haya una tarea. cancelado() corta la espera. */
  const esperarTarea = async ({ esperaMs = 25000, cancelado = () => false } = {}) => {
    const limite = ahora() + esperaMs;
    for (;;) {
      const tarea = await tomar();
      if (tarea || cancelado()) return tarea;
      const resta = limite - ahora();
      if (resta <= 0) return null;
      await esperar(Math.min(resta, 5000), emisor);
      if (cancelado()) return null;
    }
  };

  /** El agente cortó la conexión antes de recibir la tarea: vuelve a la cola sin gastar intento. */
  const liberar = async (id) => {
    await db.query(
      `UPDATE crm_seguimiento_tareas SET estado = 'pendiente', tomada_en = NULL, intentos = GREATEST(intentos - 1, 0)
        WHERE id = $1 AND estado = 'tomada'`,
      [id]
    );
  };

  const reintentarOFallar = async (fila, error) => {
    const agotada = fila.intentos >= config.maxIntentos;
    const t = ahora();
    await db.query(
      `UPDATE crm_seguimiento_tareas
          SET estado = $2, error = $3, tomada_en = NULL, disponible_desde = $4, terminada_en = $5
        WHERE id = $1 AND estado = 'tomada'`,
      [fila.id, agotada ? 'fallida' : 'pendiente', String(error).slice(0, 1000), iso(t + config.reintentoMs), agotada ? iso(t) : null]
    );
    return agotada;
  };

  /**
   * Recibe el resultado del agente.
   * aplicar(tarea, items) aplica los ítems validados (sus errores no rompen la cola).
   * Devuelve { status, error? }: 204 aplicado, 400 malformado (se reintenta), 404, 409.
   */
  const registrarResultado = async (id, cuerpo, aplicar) => {
    const idNum = Number.parseInt(id, 10);
    if (!Number.isFinite(idNum)) return { status: 404, error: 'Tarea no encontrada' };
    const { rows } = await db.query('SELECT * FROM crm_seguimiento_tareas WHERE id = $1', [idNum]);
    const fila = rows[0];
    if (!fila) return { status: 404, error: 'Tarea no encontrada' };
    if (fila.estado !== 'tomada') return { status: 409, error: `La tarea está ${fila.estado}` };

    const validado = validarResultado(fila.tipo, cuerpo);
    if (!validado.ok) {
      const agotada = await reintentarOFallar(fila, `resultado malformado: ${validado.error}`);
      logger.warn?.(
        { event: 'seguimiento_resultado_invalido', id: fila.id, tipo: fila.tipo, error: validado.error, agotada },
        'Resultado del agente inválido; se reintenta'
      );
      return { status: 400, error: `Resultado inválido: ${validado.error}` };
    }
    if (!validado.data.ok) {
      const agotada = await reintentarOFallar(fila, `el agente informó error: ${validado.data.error || 'sin detalle'}`);
      logger.warn?.({ event: 'seguimiento_tarea_error_agente', id: fila.id, tipo: fila.tipo, agotada }, 'El agente no pudo con la tarea');
      return { status: 204 };
    }

    // Solo los ítems que pertenecen a la tarea; el resto se ignora.
    const clave = CLAVE_ITEM[fila.tipo];
    const pedidos = new Map((fila.items || []).map((it) => [Number(it[clave]), it]));
    const items = validado.data.items.filter((it) => pedidos.has(Number(it[clave])));
    const { rowCount } = await db.query(
      `UPDATE crm_seguimiento_tareas SET estado = 'hecha', terminada_en = $2, metricas = $3::jsonb, error = NULL
        WHERE id = $1 AND estado = 'tomada'`,
      [fila.id, iso(ahora()), validado.data.metricas ? JSON.stringify(validado.data.metricas) : null]
    );
    if (!rowCount) return { status: 409, error: 'La tarea ya no está tomada' };
    await aplicar(
      { id: fila.id, tipo: fila.tipo },
      items.map((it) => ({ resultado: it, pedido: pedidos.get(Number(it[clave])) }))
    );
    return { status: 204 };
  };

  const resumen = async () => {
    const { rows } = await db.query(
      `SELECT estado, COUNT(*)::int AS n FROM crm_seguimiento_tareas
        WHERE estado IN ('pendiente', 'tomada') OR created_at >= $1
        GROUP BY estado`,
      [iso(ahora() - 24 * 60 * 60 * 1000)]
    );
    return Object.fromEntries(rows.map((r) => [r.estado, Number(r.n)]));
  };

  return { encolar, idsEnCurso, vencerTomadas, tomar, esperarTarea, liberar, registrarResultado, resumen, emisor };
};

module.exports = { crearCola, CLAVE_ITEM, trozos };
