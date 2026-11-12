// Rutas del seguimiento. Se montan en legacyRoutes.js:
//   /api/seguimiento/agente  -> rutasAgente (token IA_AGENTE_TOKEN, igual que /api/ia/agente/*)
//   /api/seguimiento         -> rutasAdmin  (authenticateToken + requireAdmin)

const express = require('express');
const { instanteChile } = require('./calendario');

const DIA_MS = 24 * 60 * 60 * 1000;

// "YYYY-MM-DD" = medianoche de Chile de ese día; también acepta ISO 8601 completo.
const fechaParam = (v) => {
  if (v === undefined || v === '') return undefined;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return Number.isFinite(Date.parse(`${s}T00:00:00Z`)) ? instanteChile(s, 0, 0) : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
};

const manejar = (logger, evento, fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (error) {
    logger.error?.({ event: evento, msg: error?.message }, 'Error en seguimiento');
    return res.status(500).json({ error: 'Error del seguimiento' });
  }
};

const crearRutasAdmin = (servicio, { logger = console, ahora = () => Date.now() } = {}) => {
  const r = express.Router();

  r.get('/hoy', manejar(logger, 'seguimiento_hoy_error', async (req, res) => res.json(await servicio.hoy())));

  r.get('/lista', manejar(logger, 'seguimiento_lista_error', async (req, res) => res.json(await servicio.lista())));

  r.get('/estado', manejar(logger, 'seguimiento_estado_error', async (req, res) => res.json(await servicio.estado())));

  r.get(
    '/valor',
    manejar(logger, 'seguimiento_valor_error', async (req, res) => {
      // undefined = no vino (se usa el valor por defecto); null = vino y no es fecha.
      const h = fechaParam(req.query.hasta);
      const d = fechaParam(req.query.desde);
      const hasta = h === undefined ? new Date(ahora()) : h;
      const desde = d === undefined && hasta ? new Date(hasta.getTime() - 30 * DIA_MS) : d;
      if (!desde || !hasta || desde >= hasta) {
        return res.status(400).json({ error: 'desde y hasta deben ser fechas válidas y desde < hasta' });
      }
      return res.json(await servicio.valor(desde, hasta));
    })
  );

  r.get(
    '/oportunidad/:id',
    manejar(logger, 'seguimiento_detalle_error', async (req, res) => {
      const d = await servicio.detalle(req.params.id);
      return d ? res.json(d) : res.status(404).json({ error: 'La oportunidad no está en seguimiento' });
    })
  );

  for (const accion of ['pausar', 'reanudar']) {
    r.post(
      `/oportunidad/:id/${accion}`,
      manejar(logger, `seguimiento_${accion}_error`, async (req, res) => {
        const out = await servicio[accion](req.params.id);
        return out.error ? res.status(out.status).json({ error: out.error }) : res.json(out.seguimiento);
      })
    );
  }

  return r;
};

const crearRutasAgente = (servicio, { logger = console } = {}) => {
  const r = express.Router();

  r.get(
    '/tarea',
    manejar(logger, 'seguimiento_tarea_error', async (req, res) => {
      const esperaMs = Math.min(Math.max(Number(req.query.espera) || 0, 0), 50) * 1000;
      let cerrado = false;
      res.on('close', () => {
        cerrado = !res.writableEnded;
      });
      const tarea = await servicio.cola.esperarTarea({ esperaMs, cancelado: () => cerrado });
      if (cerrado) {
        // El agente cortó antes de recibirla: vuelve a la cola.
        if (tarea) await servicio.cola.liberar(tarea.id);
        return undefined;
      }
      return tarea ? res.json(tarea) : res.status(204).end();
    })
  );

  r.post(
    '/tarea/:id/resultado',
    manejar(logger, 'seguimiento_resultado_error', async (req, res) => {
      const out = await servicio.registrarResultado(req.params.id, req.body);
      return out.status === 204 ? res.status(204).end() : res.status(out.status).json({ error: out.error });
    })
  );

  return r;
};

module.exports = { crearRutasAdmin, crearRutasAgente, fechaParam };
