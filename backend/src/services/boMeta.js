/**
 * bo_meta: lo que MyQuote sabe de cada orden (BO) de la planilla OSO.
 *
 * registrarOrdenesVistas deja constancia de las ordenes que acaba de leer
 * GET /api/oso/orders: cliente, % alocado, OC y cuando se vieron por ultima vez. Una
 * orden que estaba borrada logicamente y vuelve a aparecer en la planilla se restaura.
 *
 * Es UN solo INSERT para todas (unnest), no uno por orden: corre dentro de la peticion,
 * antes de responder, y con cientos de ordenes la diferencia se nota en la carga de la
 * vista. Los BO no pueden venir repetidos (ON CONFLICT no admite tocar dos veces la
 * misma fila en un mismo comando): quien llama los trae de un Map, y aqui se
 * deduplican igual por si acaso, quedandose con la ultima aparicion.
 */
const registrarOrdenesVistas = async (
  db,
  orders,
  ahora = new Date().toISOString()
) => {
  const porBo = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const bo = String(order?.bo || '').trim();
    if (bo) porBo.set(bo, order);
  }
  if (porBo.size === 0) return 0;
  const lista = [...porBo.entries()];
  const { rowCount } = await db.query(
    `INSERT INTO bo_meta (bo, customer_name, alloc_pct, customer_po, last_seen_at)
     SELECT t.bo, t.customer_name, t.alloc_pct, t.customer_po, $5::timestamp
       FROM unnest($1::text[], $2::text[], $3::numeric[], $4::text[])
            AS t(bo, customer_name, alloc_pct, customer_po)
     ON CONFLICT (bo) DO UPDATE
     SET customer_name = EXCLUDED.customer_name,
         alloc_pct = EXCLUDED.alloc_pct,
         customer_po = EXCLUDED.customer_po,
         last_seen_at = EXCLUDED.last_seen_at,
         deleted = false,
         deleted_at = NULL,
         deleted_comment = NULL,
         deleted_by = NULL,
         updated_at = CURRENT_TIMESTAMP`,
    [
      lista.map(([bo]) => bo),
      lista.map(([, order]) => order.customerName || null),
      lista.map(([, order]) => order.allocPct ?? null),
      lista.map(([, order]) => order.customerPO || null),
      ahora
    ]
  );
  return rowCount;
};

module.exports = { registrarOrdenesVistas };
