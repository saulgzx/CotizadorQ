/**
 * OOR: router montado en /api/oor (legacyRoutes le antepone authenticateToken y
 * requireAdmin). Contrato en docs/OOR.md.
 */
const express = require('express');
const { z } = require('zod');
const defecto = require('./repositorio');
const servicio = require('./servicio');
const { leerOor } = require('./comparar');
const { logger: loggerApp } = require('../utils/logger');

const id = z.coerce.number().int().positive().max(2147483647);
const esquemas = {
  visto: z.object({ hasta_id: id }),
  revision: z.object({ id }),
  historial: z.object({ limite: z.coerce.number().int().min(1).max(100).optional() })
};

const describirError = (error) => {
  const issue = error.issues[0];
  const campo = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
  return `Datos invalidos: ${campo}${issue?.message || 'formato incorrecto'}`;
};

const parsear = (esquema, valor) => {
  const resultado = esquema.safeParse(valor || {});
  if (!resultado.success) throw Object.assign(new Error(describirError(resultado.error)), { status: 400 });
  return resultado.data;
};

/**
 * - leerPestanaOor: async () => filas crudas de la pestana OOR (se arma en legacyRoutes con
 *   Google Sheets). Solo la usa POST /actualizar; si falta o falla, esa ruta informa el error.
 * - ahora: reloj inyectable (() => Date).
 */
const crearRutasOor = ({
  pool,
  leerPestanaOor = null,
  repo = defecto,
  ahora = () => new Date(),
  log = loggerApp
} = {}) => {
  const router = express.Router();

  const manejar = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ error: error.message });
      log.error(
        {
          event: 'oor_error',
          method: req.method,
          path: req.originalUrl?.split('?')[0],
          err: { message: error?.message, code: error?.code }
        },
        'Error en los cambios del OOR'
      );
      return res.status(500).json({ error: 'Error del servidor' });
    }
  };

  // GET: solo base de datos. Las versiones se registran al abrir Ordenes y con POST /actualizar.
  router.get(
    '/cambios/pendiente',
    manejar(async (req, res) => {
      res.json(await servicio.pendiente(pool, { ahora: new Date(ahora()), repo }));
    })
  );

  // POST: el dueno apreta "Actualizar OOR" cuando termino de pegar la pestana. Lee la planilla
  // AHORA, registra la version y devuelve lo pendiente sin esperar los 90 s de estabilidad.
  // Al ser una accion explicita, aqui los fallos si se informan.
  router.post(
    '/actualizar',
    manejar(async (req, res) => {
      if (typeof leerPestanaOor !== 'function') {
        return res.status(400).json({ error: 'La planilla maestra no está configurada' });
      }
      let filas;
      try {
        filas = await leerPestanaOor();
      } catch (error) {
        if (error?.code === 'PLANILLA_NO_CONFIGURADA') {
          return res.status(400).json({ error: 'La planilla maestra no está configurada' });
        }
        log.error(
          { event: 'oor_actualizar_planilla_fallo', err: { message: error?.message, code: error?.code } },
          'No se pudo leer la pestaña OOR'
        );
        return res.status(502).json({ error: 'No se pudo leer la pestaña OOR de la planilla' });
      }
      const { lineas, avisos } = leerOor(filas);
      if (lineas.length === 0) {
        // Pestana vacia o sin "Order No": no se guarda nada ni se toca lo anterior.
        return res.json({ hay: false, motivo: 'sin_datos', lineas: 0, avisos });
      }
      const ahoraFecha = new Date(ahora());
      await servicio.registrarLectura(pool, filas, { ahora: ahoraFecha, repo });
      const resultado = await servicio.pendiente(pool, { ahora: ahoraFecha, sinEspera: true, repo });
      res.json({ ...resultado, lineas: lineas.length });
    })
  );

  router.post(
    '/cambios/visto',
    manejar(async (req, res) => {
      const { hasta_id: hastaId } = parsear(esquemas.visto, req.body);
      const { revision_id: revisionId } = await servicio.marcarVisto(pool, {
        hastaId,
        usuarioId: req.user?.id ?? null,
        ahora: new Date(ahora()),
        repo
      });
      res.json({ ok: true, revision_id: revisionId });
    })
  );

  router.get(
    '/cambios/historial',
    manejar(async (req, res) => {
      const { limite } = parsear(esquemas.historial, req.query);
      res.json({ items: await servicio.historial(pool, { limite, repo }) });
    })
  );

  router.get(
    '/cambios/revisiones/:id',
    manejar(async (req, res) => {
      const { id: revisionId } = parsear(esquemas.revision, req.params);
      res.json(await servicio.detalle(pool, revisionId, { repo }));
    })
  );

  return router;
};

module.exports = { crearRutasOor, esquemas };
