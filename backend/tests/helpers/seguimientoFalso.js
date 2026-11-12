// Mundo en memoria para probar el seguimiento sin PostgreSQL ni el CRM real:
// - store: oportunidades, cotizaciones (con líneas), seguimientos, eventos y estado.
// - db: pool falso que entiende solo las consultas de la cola de tareas.
// - repo y crm: implementaciones en memoria de las interfaces de repositorio.js y
//   crmAdaptador.js (mismos nombres y firmas).

const { instanteChile } = require('../../src/seguimiento/calendario');

/** Instante de una hora de Chile: cl('2026-11-02 10:00'). */
const cl = (texto) => {
  const [dia, hora = '00:00'] = texto.split(' ');
  const [h, m] = hora.split(':').map(Number);
  return instanteChile(dia, h, m);
};

const t = (v) => (v === null || v === undefined ? null : new Date(v).getTime());

const crearDbTareas = () => {
  const tareas = [];
  let sec = 0;
  const query = jest.fn(async (sql, p = []) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (s.startsWith('INSERT INTO crm_seguimiento_tareas')) {
      sec += 1;
      tareas.push({ id: sec, tipo: p[0], estado: 'pendiente', items: JSON.parse(p[1]), intentos: 0, disponible_desde: p[2], created_at: p[2], tomada_en: null, terminada_en: null, error: null, metricas: null });
      return { rows: [{ id: sec }], rowCount: 1 };
    }
    if (s.includes('SELECT items FROM crm_seguimiento_tareas WHERE tipo = $1')) {
      return { rows: tareas.filter((x) => x.tipo === p[0] && ['pendiente', 'tomada'].includes(x.estado)) };
    }
    if (s.includes("SELECT items FROM crm_seguimiento_tareas WHERE id = $1") || s.includes('SELECT * FROM crm_seguimiento_tareas WHERE id = $1')) {
      return { rows: tareas.filter((x) => x.id === Number(p[0])).map((x) => ({ ...x })) };
    }
    if (s.includes("error = 'sin resultado del agente en el plazo'")) {
      const rows = [];
      for (const x of tareas) {
        if (x.estado === 'tomada' && t(x.tomada_en) < t(p[1])) {
          x.estado = x.intentos >= p[2] ? 'fallida' : 'pendiente';
          x.error = 'sin resultado del agente en el plazo';
          x.tomada_en = null;
          x.disponible_desde = p[0];
          rows.push({ id: x.id, tipo: x.tipo, estado: x.estado });
        }
      }
      return { rows, rowCount: rows.length };
    }
    if (s.includes("SET estado = 'tomada'")) {
      const x = tareas
        .filter((y) => y.estado === 'pendiente' && t(y.disponible_desde) <= t(p[0]))
        .sort((a, b) => a.id - b.id)[0];
      if (!x) return { rows: [], rowCount: 0 };
      x.estado = 'tomada';
      x.tomada_en = p[0];
      x.intentos += 1;
      return { rows: [{ ...x }], rowCount: 1 };
    }
    if (s.includes('GREATEST(intentos - 1, 0)')) {
      const x = tareas.find((y) => y.id === Number(p[0]) && y.estado === 'tomada');
      if (x) Object.assign(x, { estado: 'pendiente', tomada_en: null, intentos: Math.max(x.intentos - 1, 0) });
      return { rows: [], rowCount: x ? 1 : 0 };
    }
    if (s.includes('SET estado = $2, error = $3')) {
      const x = tareas.find((y) => y.id === Number(p[0]) && y.estado === 'tomada');
      if (x) Object.assign(x, { estado: p[1], error: p[2], tomada_en: null, disponible_desde: p[3], terminada_en: p[4] });
      return { rows: [], rowCount: x ? 1 : 0 };
    }
    if (s.includes("SET estado = 'hecha'")) {
      const x = tareas.find((y) => y.id === Number(p[0]) && y.estado === 'tomada');
      if (x) Object.assign(x, { estado: 'hecha', terminada_en: p[1], metricas: p[2] ? JSON.parse(p[2]) : null, error: null });
      return { rows: [], rowCount: x ? 1 : 0 };
    }
    if (s.includes('SELECT estado, COUNT(*)')) {
      const cuenta = {};
      for (const x of tareas) cuenta[x.estado] = (cuenta[x.estado] || 0) + 1;
      return { rows: Object.entries(cuenta).map(([estado, n]) => ({ estado, n })) };
    }
    throw new Error(`SQL no soportado por el pool falso: ${s.slice(0, 120)}`);
  });
  return { query, tareas };
};

const crearMundo = ({ reloj }) => {
  const store = {
    oportunidades: new Map(),
    cotizaciones: new Map(),
    segs: new Map(),
    eventos: [],
    estado: new Map(),
    etapasCambiadas: []
  };
  let secSeg = 0;
  const ahoraIso = () => new Date(reloj.t).toISOString();

  const monto = (o) => {
    if (o.monto_manual !== null && o.monto_manual !== undefined) return o.monto_manual;
    const cots = [...store.cotizaciones.values()].filter((c) => c.oportunidad_id === o.id).sort((a, b) => t(b.created_at) - t(a.created_at));
    return cots[0]?.total ?? 0;
  };

  const unir = (s) => {
    const o = store.oportunidades.get(s.oportunidad_id) || {};
    const c = store.cotizaciones.get(s.cotizacion_id) || {};
    return {
      ...s,
      etapa: o.etapa,
      motivo_perdida: o.motivo_perdida ?? null,
      titulo: o.titulo,
      monto: monto(o),
      empresa_nombre: o.empresa_nombre,
      contacto_nombre: o.contacto_nombre,
      contacto_email: o.contacto_email,
      numero: c.numero,
      total: c.total,
      cotizacion_creada_en: c.created_at,
      cliente_nombre: c.cliente_nombre,
      cliente_empresa: c.cliente_empresa,
      cliente_email: c.cliente_email,
      cliente_telefono: c.cliente_telefono
    };
  };

  const repo = {
    crearEsquema: jest.fn(async () => {}),
    actualizar: jest.fn(async (id, estadoEsperado, cambios) => {
      const s = store.segs.get(id);
      if (!s || s.estado !== estadoEsperado) return null;
      Object.assign(s, cambios, { updated_at: ahoraIso() });
      return { ...s };
    }),
    registrarEventos: jest.fn(async (oportunidadId, eventos) => {
      for (const e of eventos || []) store.eventos.push({ oportunidad_id: oportunidadId ?? null, tipo: e.tipo, detalle: e.detalle || {}, created_at: ahoraIso() });
    }),
    eventosDe: async (id) => store.eventos.filter((e) => e.oportunidad_id === Number(id)).reverse(),
    eventosEntre: async (desde, hasta, tipos = null) =>
      store.eventos.filter((e) => t(e.created_at) >= t(desde) && t(e.created_at) < t(hasta) && (!tipos || tipos.includes(e.tipo))),
    respuestasDe: async (ids) => store.eventos.filter((e) => e.tipo === 'respuesta' && ids.includes(e.oportunidad_id)),
    leerEstado: async (k) => store.estado.get(k) ?? null,
    guardarEstado: async (k, v) => {
      store.estado.set(k, v === null || v === undefined ? null : String(v));
    },
    lineasCotizacion: async (id) => store.cotizaciones.get(Number(id))?.items || [],
    margenCotizaciones: async (ids) =>
      new Map(
        ids.map((id) => {
          const items = (store.cotizaciones.get(Number(id))?.items || []).filter((i) => i.costo_unitario !== null && i.costo_unitario !== undefined);
          return [Number(id), items.length ? items.reduce((s, i) => s + i.precio_total - i.costo_unitario * i.cantidad, 0) : null];
        })
      )
  };

  const crm = {
    altaAutomatica: jest.fn(async (_db, { desde }) => {
      const creadas = [];
      for (const o of store.oportunidades.values()) {
        if (!['nueva', 'cotizada'].includes(o.etapa)) continue;
        if ([...store.segs.values()].some((s) => s.oportunidad_id === o.id)) continue;
        const c = [...store.cotizaciones.values()].filter((x) => x.oportunidad_id === o.id).sort((a, b) => t(b.created_at) - t(a.created_at))[0];
        if (!c || t(c.created_at) < t(desde)) continue;
        secSeg += 1;
        store.segs.set(secSeg, {
          id: secSeg, oportunidad_id: o.id, cotizacion_id: c.id, estado: 'buscando_envio', paso: 0,
          conversation_id: null, message_id: null, enviado_en: null, ultimo_envio_mio_en: null,
          proxima_accion: null, proxima_accion_en: null, borrador_id: null, borrador_creado_en: null,
          respuesta_en: null, respuesta_resumen: null, intentos_busqueda: 0, borrador_paso: null,
          borrador_fallos: 0, borrador_fallo_en: null, ultima_revision_en: null, estado_antes_pausa: null,
          busqueda_desde: ahoraIso(), cerrada_en: null, created_at: ahoraIso(), updated_at: ahoraIso()
        });
        creadas.push({ oportunidad_id: o.id, cotizacion_id: c.id });
      }
      return creadas;
    }),
    oportunidadesParaSeguimiento: jest.fn(async (_db, { estados = null, oportunidadIds = null, cotizacionIds = null } = {}) =>
      [...store.segs.values()]
        .filter((s) => (!estados || estados.includes(s.estado)) && (!oportunidadIds || oportunidadIds.includes(s.oportunidad_id)) && (!cotizacionIds || cotizacionIds.includes(s.cotizacion_id)))
        .map((s) => unir({ ...s }))
    ),
    cambiarEtapa: jest.fn(async (_db, id, etapa, motivo = null) => {
      if (etapa === 'perdida' && !motivo) throw new Error('pasar a perdida exige motivo');
      const o = store.oportunidades.get(Number(id));
      if (!o || o.etapa === etapa) return false;
      o.etapa = etapa;
      o.motivo_perdida = etapa === 'perdida' ? motivo : null;
      o.cerrada_en = ['ganada', 'perdida'].includes(etapa) ? ahoraIso() : null;
      store.etapasCambiadas.push({ id: o.id, etapa, motivo });
      return true;
    }),
    oportunidadesCerradasEntre: async (_db, { desde, hasta }) =>
      [...store.oportunidades.values()]
        .filter((o) => ['ganada', 'perdida'].includes(o.etapa) && t(o.cerrada_en) >= t(desde) && t(o.cerrada_en) < t(hasta))
        .map((o) => ({
          ...o,
          monto: monto(o),
          cotizacion_id: [...store.cotizaciones.values()].find((c) => c.oportunidad_id === o.id)?.id ?? null,
          en_seguimiento: [...store.segs.values()].some((s) => s.oportunidad_id === o.id)
        })),
    abiertasMasGrandes: async (_db, n) =>
      [...store.oportunidades.values()]
        .filter((o) => ['nueva', 'cotizada', 'negociacion'].includes(o.etapa))
        .map((o) => ({ ...o, monto: monto(o) }))
        .sort((a, b) => b.monto - a.monto)
        .slice(0, n)
  };

  const agregarOportunidad = ({ id, etapa = 'cotizada', empresa = `Empresa ${id}`, creada, cotizacion = {} }) => {
    store.oportunidades.set(id, {
      id, etapa, motivo_perdida: null, titulo: `Cotización #${cotizacion.numero || 65000 + id}`, empresa_nombre: empresa,
      contacto_nombre: 'Ana Pérez', contacto_email: `ana${id}@cliente.cl`, monto_manual: null,
      created_at: new Date(creada).toISOString(), cerrada_en: null
    });
    const cid = cotizacion.id || 100 + id;
    store.cotizaciones.set(cid, {
      id: cid, oportunidad_id: id, numero: cotizacion.numero || 65000 + id, total: cotizacion.total ?? 1000,
      created_at: new Date(creada).toISOString(), cliente_nombre: 'Ana Pérez', cliente_empresa: empresa,
      cliente_email: `ana${id}@cliente.cl`, cliente_telefono: cotizacion.proyecto || 'Proyecto CCTV',
      items: cotizacion.items || [
        { descripcion: 'Cámara AXIS P1465-LE', cantidad: 4, sku: 'AX1', mpn: '02491-001', precio_total: 1000, costo_unitario: 200, entrega: '4-6 semanas' }
      ]
    });
    return cid;
  };

  return { store, repo, crm, agregarOportunidad };
};

module.exports = { cl, crearDbTareas, crearMundo };
