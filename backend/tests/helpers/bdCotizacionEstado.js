/**
 * BD falsa (por texto SQL) para PATCH /api/cotizaciones/:id/estado y PUT con estado en
 * la app real: una tabla de cotizaciones y una de oportunidades en memoria, con las
 * consultas que usan crm/enlace.js y crm/repositorio.js (obtener, bloquear, actualizar
 * la oportunidad, derivar el estado). Lo que no reconoce devuelve undefined para que el
 * test lo enrute a otro lado.
 */
const { estadoDesdeEtapa, etapaDesdeEstado } = require('../../src/crm/normalizar');

const crearBdCotizacionEstado = ({ cotizaciones = [], oportunidades = [], falla = null } = {}) => {
  const cots = new Map(cotizaciones.map((c) => [Number(c.id), { oportunidad_id: null, empresa_id: null, ...c }]));
  const ops = new Map(oportunidades.map((o) => [Number(o.id), { motivo_perdida: null, cerrada_en: null, ...o }]));
  const sqls = [];

  const responder = (sql, params = []) => {
    const t = String(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(t)) return { rows: [] };
    if (falla && falla(t)) throw new Error('falla simulada');
    if (t.includes('c.empresa_id IS NULL AND c.oportunidad_id IS NULL') && t.includes('FOR UPDATE')) {
      sqls.push(t);
      return { rows: [] }; // bloquearCotizacionSinEnlace: aqui no se enlaza (se prueba con crmMemoria)
    }
    if (t.includes('LEFT JOIN crm_oportunidades o ON o.id = c.oportunidad_id') && t.includes('WHERE c.id = $1') && !t.includes('usuarios')) {
      sqls.push(t);
      const c = cots.get(Number(params[0]));
      if (!c) return { rows: [] };
      const o = ops.get(Number(c.oportunidad_id));
      return { rows: [{ ...c, etapa: o ? o.etapa : etapaDesdeEstado(c.estado), motivo_perdida: o ? o.motivo_perdida : null }] };
    }
    if (t.includes('FROM cotizaciones c WHERE c.id = $1')) {
      sqls.push(t);
      const c = cots.get(Number(params[0]));
      return { rows: c ? [{ ...c }] : [] };
    }
    if (t.includes('FROM crm_oportunidades WHERE id = $1')) {
      sqls.push(t);
      const o = ops.get(Number(params[0]));
      return { rows: o ? [{ ...o }] : [] };
    }
    if (t.startsWith('UPDATE crm_oportunidades SET')) {
      sqls.push(t);
      const o = ops.get(Number(params[params.length - 1]));
      const set = t.slice(t.indexOf('SET') + 3, t.indexOf('WHERE'));
      for (const [, columna, valor] of set.matchAll(/(\w+) = (\$\d+|CURRENT_TIMESTAMP)/g)) {
        if (columna === 'updated_at') continue;
        o[columna] = valor === 'CURRENT_TIMESTAMP' ? new Date() : params[Number(valor.slice(1)) - 1];
      }
      return { rows: [{ ...o }] };
    }
    if (t.includes('UPDATE cotizaciones c') && t.includes('FROM crm_oportunidades o')) {
      sqls.push(t);
      const o = ops.get(Number(params[0]));
      let n = 0;
      for (const c of cots.values()) {
        if (o && Number(c.oportunidad_id) === o.id && c.estado !== estadoDesdeEtapa(o.etapa)) {
          c.estado = estadoDesdeEtapa(o.etapa);
          n += 1;
        }
      }
      return { rows: [], rowCount: n };
    }
    if (t.includes('UPDATE cotizaciones SET estado = $2 WHERE id = $1')) {
      sqls.push(t);
      const c = cots.get(Number(params[0]));
      if (c) c.estado = params[1];
      return { rows: [], rowCount: c ? 1 : 0 };
    }
    return undefined;
  };

  const cliente = {
    query: jest.fn(async (sql, params) => {
      const r = responder(sql, params);
      if (r === undefined) throw new Error(`SQL sin manejar en la transaccion: ${sql}`);
      return r;
    }),
    release: jest.fn()
  };

  return {
    cots,
    ops,
    sqls,
    cliente,
    /** Envuelve el router del test: primero esta BD, si no reconoce el SQL, `otro`. */
    conRespaldo: (otro) => (sql, params) => {
      const r = responder(sql, params);
      return r === undefined ? otro(sql, params) : Promise.resolve(r);
    },
    responder
  };
};

module.exports = { crearBdCotizacionEstado };
