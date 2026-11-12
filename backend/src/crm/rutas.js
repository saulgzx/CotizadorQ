/**
 * CRM: router montado en /api/crm (legacyRoutes le antepone authenticateToken y
 * requireAdmin). Contrato en docs/CRM.md.
 */
const express = require('express');
const { z } = require('zod');
const repositorio = require('./repositorio');
const reglas = require('./reglas');
const { sincronizarOrdenes } = require('./ordenes');
const {
  ETAPAS,
  MARCAS,
  agruparDuplicados,
  limpiarTexto,
  normalizarNombreEmpresa,
  normalizarEmail,
  textoPlano
} = require('./normalizar');
const { logger: loggerApp } = require('../utils/logger');

// ---------------------------------------------------------------- validacion (zod 4)

const vacioAUndefined = (valor) => (valor === '' ? undefined : valor);

const id = z.coerce.number().int().positive().max(2147483647);
const idOpcionalNullable = z.union([id, z.null()]).optional();

/** Texto obligatorio: se recorta y colapsa; vacio => error. */
const textoRequerido = (max) =>
  z
    .string()
    .max(max * 2)
    .transform((v) => limpiarTexto(v, max))
    .refine((v) => v !== null, { message: 'Requerido' });

/** Texto opcional: '' o null => null (borra), ausente => no se toca. */
const textoOpcional = (max) =>
  z
    .union([z.string().max(max * 2), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : limpiarTexto(v, max)));

const emailOpcional = z
  .union([z.string().max(400), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v.trim() === '') return null;
    const email = normalizarEmail(v);
    if (!email) {
      ctx.addIssue({ code: 'custom', message: 'Email invalido' });
      return z.NEVER;
    }
    return email;
  });

const montoOpcional = z
  .union([z.number(), z.string().regex(/^\s*\d+(\.\d+)?\s*$/), z.null()])
  .optional()
  .transform((v) =>
    v === undefined || v === null ? v : Math.round(Number(v) * 100) / 100
  )
  .refine(
    (v) =>
      v === undefined ||
      v === null ||
      (Number.isFinite(v) && v >= 0 && v < 1e12),
    {
      message: 'Monto invalido'
    }
  );

/** true si 'YYYY-MM-DD' es un dia real del calendario (descarta 2026-02-31). */
const esFechaReal = (texto) => {
  const fecha = new Date(`${texto}T00:00:00Z`);
  return (
    !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto
  );
};

const fechaOpcional = z
  .union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha invalida (YYYY-MM-DD)'),
    z.null()
  ])
  .optional()
  .refine((v) => v === undefined || v === null || esFechaReal(v), {
    message: 'Fecha invalida'
  });

const etapa = z.enum(ETAPAS);
const marcaOpcional = z.union([z.enum(MARCAS), z.null()]).optional();
const booleano = z
  .union([z.boolean(), z.enum(['0', '1', 'true', 'false'])])
  .transform((v) => v === true || v === '1' || v === 'true');

const esquemas = {
  params: z.object({ id }),
  listarEmpresas: z.object({
    q: z.preprocess(vacioAUndefined, z.string().trim().max(200).optional()),
    archivadas: z
      .preprocess(vacioAUndefined, booleano.optional())
      .transform((v) => v === true),
    limite: z
      .preprocess(
        vacioAUndefined,
        z.coerce.number().int().min(1).max(200).optional()
      )
      .transform((v) => v ?? 50),
    offset: z
      .preprocess(
        vacioAUndefined,
        z.coerce.number().int().min(0).max(1e7).optional()
      )
      .transform((v) => v ?? 0)
  }),
  crearEmpresa: z.object({
    nombre: textoRequerido(200),
    rut: textoOpcional(30),
    sitio: textoOpcional(300),
    notas: textoOpcional(5000)
  }),
  editarEmpresa: z.object({
    nombre: textoRequerido(200).optional(),
    rut: textoOpcional(30),
    sitio: textoOpcional(300),
    notas: textoOpcional(5000),
    archivada: z.boolean().optional()
  }),
  fusionar: z.object({ origen_id: id }),
  crearContacto: z.object({
    empresa_id: id,
    nombre: textoRequerido(200),
    email: emailOpcional,
    telefono: textoOpcional(60),
    cargo: textoOpcional(120),
    notas: textoOpcional(5000)
  }),
  editarContacto: z.object({
    nombre: textoRequerido(200).optional(),
    email: emailOpcional,
    telefono: textoOpcional(60),
    cargo: textoOpcional(120),
    notas: textoOpcional(5000),
    archivado: z.boolean().optional()
  }),
  listarOportunidades: z.object({
    etapa: z.preprocess(vacioAUndefined, etapa.optional()),
    empresa_id: z.preprocess(vacioAUndefined, id.optional()),
    q: z.preprocess(vacioAUndefined, z.string().trim().max(200).optional()),
    abiertas: z
      .preprocess(vacioAUndefined, booleano.optional())
      .transform((v) => v === true),
    limite: z
      .preprocess(
        vacioAUndefined,
        z.coerce.number().int().min(1).max(1000).optional()
      )
      .transform((v) => v ?? 500),
    offset: z
      .preprocess(
        vacioAUndefined,
        z.coerce.number().int().min(0).max(1e7).optional()
      )
      .transform((v) => v ?? 0)
  }),
  crearOportunidad: z.object({
    empresa_id: id,
    titulo: textoRequerido(200),
    contacto_id: idOpcionalNullable,
    etapa: etapa.optional(),
    marca: marcaOpcional,
    es_proyecto: z.boolean().optional(),
    monto_manual: montoOpcional,
    fecha_cierre_estimada: fechaOpcional,
    motivo_perdida: textoOpcional(500)
  }),
  editarOportunidad: z.object({
    titulo: textoRequerido(200).optional(),
    etapa: etapa.optional(),
    contacto_id: idOpcionalNullable,
    marca: marcaOpcional,
    es_proyecto: z.boolean().optional(),
    monto_manual: montoOpcional,
    fecha_cierre_estimada: fechaOpcional,
    motivo_perdida: textoOpcional(500)
  }),
  vincularCotizacion: z.object({ cotizacion_id: id })
};

const describirError = (error) => {
  const issue = error.issues[0];
  const campo = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
  return `Datos invalidos: ${campo}${issue?.message || 'formato incorrecto'}`;
};

const parsear = (esquema, valor) => {
  const resultado = esquema.safeParse(valor || {});
  if (!resultado.success)
    throw reglas.errorValidacion(describirError(resultado.error));
  return resultado.data;
};

/** Quita las claves undefined (campos no enviados) de un objeto validado. */
const presentes = (objeto) =>
  Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== undefined));

const conEstado = (status, mensaje, extra = {}) =>
  Object.assign(new Error(mensaje), { status, extra });
const noEncontrado = (mensaje) => conEstado(404, mensaje);
const conflicto = (mensaje, extra) => conEstado(409, mensaje, extra);

// ---------------------------------------------------------------- router

const crearRutasCrm = ({
  pool,
  repo = repositorio,
  log = loggerApp,
  sincronizar = sincronizarOrdenes
} = {}) => {
  const router = express.Router();

  const manejar = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error?.status)
        return res
          .status(error.status)
          .json({ error: error.message, ...(error.extra || {}) });
      if (error?.code === '23505')
        return res
          .status(409)
          .json({ error: 'Ya existe un registro con esos datos' });
      if (error?.code === '23503')
        return res.status(400).json({ error: 'Referencia invalida' });
      log.error(
        {
          event: 'crm_error',
          method: req.method,
          path: req.originalUrl?.split('?')[0],
          err: { message: error?.message, code: error?.code }
        },
        'Error en el CRM'
      );
      return res.status(500).json({ error: 'Error del servidor' });
    }
  };

  const idDe = (req) => parsear(esquemas.params, req.params).id;

  // ------------------------------------------------------------ empresas

  router.get(
    '/empresas',
    manejar(async (req, res) => {
      const filtros = parsear(esquemas.listarEmpresas, req.query);
      const qNormalizado = filtros.q ? textoPlano(filtros.q) : '';
      res.json(await repo.listarEmpresas(pool, { ...filtros, qNormalizado }));
    })
  );

  router.post(
    '/empresas',
    manejar(async (req, res) => {
      const datos = parsear(esquemas.crearEmpresa, req.body);
      const nombreNormalizado = normalizarNombreEmpresa(datos.nombre);
      if (!nombreNormalizado)
        throw reglas.errorValidacion('Datos invalidos: nombre: Requerido');
      const existente = await repo.buscarEmpresaPorNormalizado(
        pool,
        nombreNormalizado
      );
      if (existente)
        throw conflicto('Ya existe una empresa con ese nombre', {
          empresa_id: existente.id
        });
      const creada = await repo.insertarEmpresa(pool, {
        ...presentes(datos),
        nombre_normalizado: nombreNormalizado
      });
      if (!creada) {
        const otra = await repo.buscarEmpresaPorNormalizado(
          pool,
          nombreNormalizado
        );
        throw conflicto('Ya existe una empresa con ese nombre', {
          empresa_id: otra?.id ?? null
        });
      }
      res.status(201).json(creada);
    })
  );

  // Antes de /empresas/:id para que "duplicados" no se lea como id.
  router.get(
    '/empresas/duplicados',
    manejar(async (req, res) => {
      const empresas = await repo.listarEmpresasParaDuplicados(pool);
      const grupos = agruparDuplicados(empresas).map((grupo) => ({
        empresas: grupo.empresas.map((e) => ({
          id: e.id,
          nombre: e.nombre,
          cotizaciones: Number(e.cotizaciones) || 0
        })),
        motivo: grupo.motivo
      }));
      res.json({ grupos });
    })
  );

  router.get(
    '/empresas/:id',
    manejar(async (req, res) => {
      const empresaId = idDe(req);
      const empresa = await repo.obtenerEmpresa(pool, empresaId);
      if (!empresa) throw noEncontrado('Empresa no encontrada');
      // Oportunidades y cotizaciones archivadas no salen en la ficha; solo se cuentan.
      const [contactos, oportunidades, cotizaciones, agregado, archivadas] =
        await Promise.all([
          repo.listarContactosDeEmpresa(pool, empresaId),
          repo.listarOportunidades(pool, {
            empresa_id: empresaId,
            limite: 1000
          }),
          repo.listarCotizacionesDeEmpresa(pool, empresaId),
          repo.resumenCotizacionesEmpresa(pool, empresaId),
          repo.contarArchivadasDeEmpresa(pool, empresaId)
        ]);
      res.json({
        empresa,
        contactos,
        oportunidades,
        cotizaciones,
        resumen: reglas.resumenEmpresa(oportunidades, agregado),
        archivadas
      });
    })
  );

  router.patch(
    '/empresas/:id',
    manejar(async (req, res) => {
      const empresaId = idDe(req);
      const datos = presentes(parsear(esquemas.editarEmpresa, req.body));
      const empresa = await repo.conTransaccion(pool, async (client) => {
        const actual = await repo.obtenerEmpresa(client, empresaId, {
          bloquear: true
        });
        if (!actual) throw noEncontrado('Empresa no encontrada');
        const cambios = { ...datos };
        if (datos.nombre) {
          const nuevo = normalizarNombreEmpresa(datos.nombre);
          if (!nuevo)
            throw reglas.errorValidacion('Datos invalidos: nombre: Requerido');
          if (nuevo !== actual.nombre_normalizado) {
            const otra = await repo.buscarEmpresaPorNormalizado(client, nuevo);
            if (otra && otra.id !== empresaId) {
              throw conflicto('Ya existe otra empresa con ese nombre', {
                empresa_id: otra.id
              });
            }
            cambios.nombre_normalizado = nuevo;
            // El nombre viejo sigue llevando a esta empresa (cotizaciones nuevas con ese nombre).
            await repo.quitarAlias(client, nuevo);
            await repo.agregarAlias(
              client,
              actual.nombre_normalizado,
              empresaId
            );
          }
        }
        return repo.actualizarEmpresa(client, empresaId, cambios);
      });
      res.json(empresa);
    })
  );

  router.post(
    '/empresas/:id/fusionar',
    manejar(async (req, res) => {
      const destinoId = idDe(req);
      const { origen_id: origenId } = parsear(esquemas.fusionar, req.body);
      if (origenId === destinoId)
        throw reglas.errorValidacion(
          'No se puede fusionar una empresa consigo misma'
        );
      const resultado = await repo.conTransaccion(pool, async (client) => {
        // Se bloquean en orden de id para que dos fusiones cruzadas no se bloqueen entre si.
        const [primero, segundo] = [
          Math.min(origenId, destinoId),
          Math.max(origenId, destinoId)
        ];
        const bloqueadas = {
          [primero]: await repo.obtenerEmpresa(client, primero, {
            bloquear: true
          }),
          [segundo]: await repo.obtenerEmpresa(client, segundo, {
            bloquear: true
          })
        };
        const destino = bloqueadas[destinoId];
        const origen = bloqueadas[origenId];
        if (!destino) throw noEncontrado('Empresa no encontrada');
        if (!origen) throw noEncontrado('Empresa de origen no encontrada');
        return fusionarEmpresas(repo, client, { destino, origen });
      });
      res.json(resultado);
    })
  );

  // ------------------------------------------------------------ contactos

  router.post(
    '/contactos',
    manejar(async (req, res) => {
      const datos = presentes(parsear(esquemas.crearContacto, req.body));
      const empresa = await repo.obtenerEmpresa(pool, datos.empresa_id);
      if (!empresa) throw noEncontrado('Empresa no encontrada');
      if (datos.email) {
        const existente = await repo.buscarContactoPorEmail(
          pool,
          datos.empresa_id,
          datos.email
        );
        if (existente)
          throw conflicto('Ya existe un contacto con ese email en la empresa', {
            contacto_id: existente.id
          });
      }
      const creado = await repo.insertarContacto(pool, datos);
      if (!creado)
        throw conflicto('Ya existe un contacto con ese email en la empresa');
      res.status(201).json(creado);
    })
  );

  router.patch(
    '/contactos/:id',
    manejar(async (req, res) => {
      const contactoId = idDe(req);
      const datos = presentes(parsear(esquemas.editarContacto, req.body));
      const actual = await repo.obtenerContacto(pool, contactoId);
      if (!actual) throw noEncontrado('Contacto no encontrado');
      if (datos.email) {
        const otro = await repo.buscarContactoPorEmail(
          pool,
          actual.empresa_id,
          datos.email
        );
        if (otro && otro.id !== contactoId) {
          throw conflicto('Ya existe un contacto con ese email en la empresa', {
            contacto_id: otro.id
          });
        }
      }
      res.json(await repo.actualizarContacto(pool, contactoId, datos));
    })
  );

  // ------------------------------------------------------------ oportunidades

  /** El contacto debe existir y ser de la misma empresa (400 si no). */
  const validarContacto = async (db, contactoId, empresaId) => {
    if (contactoId === undefined || contactoId === null) return;
    const contacto = await repo.obtenerContacto(db, contactoId);
    if (!contacto || contacto.empresa_id !== empresaId) {
      throw reglas.errorValidacion(
        'El contacto no existe o no pertenece a la empresa de la oportunidad'
      );
    }
  };

  router.get(
    '/oportunidades',
    manejar(async (req, res) => {
      const filtros = parsear(esquemas.listarOportunidades, req.query);
      res.json({ items: await repo.listarOportunidades(pool, filtros) });
    })
  );

  router.get(
    '/embudo',
    manejar(async (req, res) => {
      res.json(reglas.armarEmbudo(await repo.totalesEmbudo(pool)));
    })
  );

  // Refleja las ordenes vigentes (bo_meta) como oportunidades ganadas. Idempotente:
  // se puede llamar las veces que haga falta. Devuelve el resumen de lo que hizo.
  router.post(
    '/oportunidades/sincronizar-ordenes',
    manejar(async (req, res) => {
      res.json(await sincronizar(pool, { repo, log }));
    })
  );

  router.post(
    '/oportunidades',
    manejar(async (req, res) => {
      const body = presentes(parsear(esquemas.crearOportunidad, req.body));
      const datos = reglas.datosOportunidadNueva(body);
      const empresa = await repo.obtenerEmpresa(pool, datos.empresa_id);
      if (!empresa) throw noEncontrado('Empresa no encontrada');
      await validarContacto(pool, datos.contacto_id, empresa.id);
      const creada = await repo.insertarOportunidad(pool, datos);
      res
        .status(201)
        .json(await repo.obtenerResumenOportunidad(pool, creada.id));
    })
  );

  router.patch(
    '/oportunidades/:id',
    manejar(async (req, res) => {
      const oportunidadId = idDe(req);
      const body = presentes(parsear(esquemas.editarOportunidad, req.body));
      await repo.conTransaccion(pool, async (client) => {
        const actual = await repo.obtenerOportunidad(client, oportunidadId, {
          bloquear: true
        });
        if (!actual) throw noEncontrado('Oportunidad no encontrada');
        await validarContacto(client, body.contacto_id, actual.empresa_id);
        const cambios = reglas.cambiosOportunidad(actual, body);
        await repo.actualizarOportunidad(client, oportunidadId, cambios);
        // La etapa manda: el estado de sus cotizaciones se deriva en la misma transaccion.
        if (cambios.etapa)
          await repo.derivarEstadoCotizaciones(client, oportunidadId);
      });
      res.json(await repo.obtenerResumenOportunidad(pool, oportunidadId));
    })
  );

  router.post(
    '/oportunidades/:id/cotizaciones',
    manejar(async (req, res) => {
      const oportunidadId = idDe(req);
      const { cotizacion_id: cotizacionId } = parsear(
        esquemas.vincularCotizacion,
        req.body
      );
      await repo.conTransaccion(pool, async (client) => {
        const oportunidad = await repo.obtenerOportunidad(
          client,
          oportunidadId,
          { bloquear: true }
        );
        if (!oportunidad) throw noEncontrado('Oportunidad no encontrada');
        const cotizacion = await repo.obtenerCotizacion(client, cotizacionId, {
          bloquear: true
        });
        if (!cotizacion) throw noEncontrado('Cotizacion no encontrada');
        // Se conserva el contacto de la cotizacion si es de la misma empresa; si no, el de la oportunidad.
        let contactoId = oportunidad.contacto_id ?? null;
        if (cotizacion.contacto_id) {
          const contacto = await repo.obtenerContacto(
            client,
            cotizacion.contacto_id
          );
          if (contacto && contacto.empresa_id === oportunidad.empresa_id)
            contactoId = contacto.id;
        }
        await repo.vincularCotizacion(client, cotizacionId, {
          empresa_id: oportunidad.empresa_id,
          contacto_id: contactoId,
          oportunidad_id: oportunidadId
        });
        const cambios =
          oportunidad.etapa === 'nueva'
            ? { etapa: 'cotizada', etapa_desde: repositorio.AHORA }
            : {};
        await repo.actualizarOportunidad(client, oportunidadId, cambios);
        // La cotizacion vinculada (y las demas) toman el estado derivado de la etapa.
        await repo.derivarEstadoCotizaciones(client, oportunidadId);
      });
      res.json(await repo.obtenerResumenOportunidad(pool, oportunidadId));
    })
  );

  return router;
};

/**
 * Fusiona `origen` en `destino` dentro de la transaccion de `db`: contactos con el mismo
 * email se funden (se completa el de destino y se repuntan sus referencias), el resto se
 * mueve; luego oportunidades, cotizaciones y alias. El nombre de origen queda como alias
 * de destino y la empresa origen se borra.
 */
const fusionarEmpresas = async (repo, db, { destino, origen }) => {
  const contactosDestino = await repo.listarContactosDeEmpresa(db, destino.id);
  const porEmail = new Map(
    contactosDestino
      .filter((c) => c.email)
      .map((c) => [c.email.toLowerCase(), c])
  );
  let fusionados = 0;
  for (const contacto of await repo.listarContactosDeEmpresa(db, origen.id)) {
    const igual = contacto.email
      ? porEmail.get(contacto.email.toLowerCase())
      : null;
    if (!igual) continue;
    const completar = {};
    for (const campo of ['telefono', 'cargo', 'notas']) {
      if (!igual[campo] && contacto[campo]) completar[campo] = contacto[campo];
    }
    if (Object.keys(completar).length)
      await repo.actualizarContacto(db, igual.id, completar);
    await repo.reemplazarContacto(db, contacto.id, igual.id);
    fusionados += 1;
  }
  const contactos =
    (await repo.moverContactos(db, origen.id, destino.id)) + fusionados;
  const oportunidades = await repo.moverOportunidades(
    db,
    origen.id,
    destino.id
  );
  const cotizaciones = await repo.moverCotizaciones(db, origen.id, destino.id);
  await repo.moverAlias(db, origen.id, destino.id);
  const completar = {};
  for (const campo of ['rut', 'sitio', 'notas']) {
    if (!destino[campo] && origen[campo]) completar[campo] = origen[campo];
  }
  await repo.borrarEmpresa(db, origen.id);
  await repo.agregarAlias(db, origen.nombre_normalizado, destino.id);
  const empresa = await repo.actualizarEmpresa(db, destino.id, completar);
  return { empresa, movidos: { contactos, oportunidades, cotizaciones } };
};

module.exports = { crearRutasCrm, fusionarEmpresas, esquemas };
