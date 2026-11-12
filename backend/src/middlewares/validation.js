const { z } = require('zod');

const loginSchema = z.object({
  usuario: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(128)
});

const productoSchema = z.object({
  descripcion: z.string().trim().min(1).max(500),
  precio_disty: z.coerce.number().finite(),
  gp: z.coerce.number().finite().optional()
});

const bulkProductosSchema = z.object({
  productos: z.array(
    z.object({
      descripcion: z.string().trim().min(1).max(500),
      precio_disty: z.coerce.number().finite().optional().default(0)
    }).passthrough()
  ).min(1)
});

const passwordSchema = z.object({
  password: z.string().min(8).max(128)
});

// Cambio de la propia contrasena: exige la actual (sin minimo de largo, por si una
// cuenta antigua tiene una contrasena corta).
const ownPasswordSchema = z.object({
  password_actual: z.string().min(1).max(128),
  password: z.string().min(8).max(128)
});

const createUserSchema = z.object({
  usuario: z.string().trim().min(1).max(50),
  password: z.string().min(8).max(128)
}).passthrough();

// Cantidad de una linea: entero >= 1 (numero o texto numerico entero). Cualquier otra
// cosa (negativa, cero, decimal, vacia) se rechaza en vez de normalizarse en silencio.
const esCantidadValida = (valor) => {
  if (typeof valor === 'number') return Number.isInteger(valor) && valor >= 1;
  if (typeof valor === 'string') return /^\s*\d+\s*$/.test(valor) && Number(valor) >= 1;
  return false;
};
const cantidadSchema = z.union([z.number(), z.string()]).refine(esCantidadValida, {
  message: 'La cantidad debe ser un entero mayor o igual a 1'
});

const cotizacionSchema = z.object({
  cliente: z.object({
    nombre: z.string().optional(),
    empresa: z.string().optional(),
    email: z.string().optional(),
    telefono: z.string().optional()
  }).passthrough(),
  items: z.array(z.object({
    producto_id: z.union([z.number(), z.string()]).optional(),
    cantidad: cantidadSchema.optional(),
    cant: cantidadSchema.optional()
  }).passthrough()).optional(),
  total: z.union([z.number(), z.string()]).optional()
}).passthrough();

// Edicion completa desde el editor (solo admin). Las lineas se normalizan en
// services/cotizacionItems; aca solo se exige la forma.
const cotizacionEditSchema = z.object({
  cliente: z.object({}).passthrough().optional(),
  estado: z.enum(['enviada', 'revision', 'rechazada', 'aprobada']).optional(),
  expected_version: z.coerce.number().int().positive().optional(),
  nota: z.string().max(500).optional(),
  items: z.array(z.object({
    cantidad: cantidadSchema,
    precio_unitario: z.union([z.number(), z.string()])
  }).passthrough()).min(1, 'La cotizacion debe tener al menos una linea')
}).passthrough();

// --- Archivado de cotizaciones (solo admin) ---------------------------------------

/** true si 'YYYY-MM-DD' es un dia real del calendario (descarta 2026-02-31). */
const esFechaReal = (texto) => {
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
};

const fechaDiaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'antes_de debe ser una fecha YYYY-MM-DD')
  .refine(esFechaReal, { message: 'antes_de no es una fecha valida' });

// 1..500 ids enteros positivos; los repetidos se cuentan una vez.
const idsCotizacionSchema = z
  .array(z.coerce.number().int().positive().max(2147483647))
  .min(1, 'ids debe tener al menos un elemento')
  .max(500, 'ids admite como maximo 500 elementos')
  .transform((ids) => [...new Set(ids)]);

// { ids } o { antes_de }: exactamente uno de los dos.
const archivarCotizacionesSchema = z
  .object({
    ids: idsCotizacionSchema.optional(),
    antes_de: fechaDiaSchema.optional()
  })
  .strict()
  .refine((v) => (v.ids === undefined) !== (v.antes_de === undefined), {
    message: 'Indica ids o antes_de (exactamente uno)'
  });

const restaurarCotizacionesSchema = z.object({ ids: idsCotizacionSchema }).strict();

const previaArchivadoSchema = z.object({ antes_de: fechaDiaSchema }).passthrough();

// --- Cambio de estado/etapa de una cotizacion --------------------------------------

// Etapas y estados salen de las equivalencias del CRM (crm/normalizar.js).
const { ETAPAS: ETAPAS_COTIZACION, ESTADOS_COTIZACION: ESTADOS_HEREDADOS } = require('../crm/normalizar');

/**
 * Cuerpo de PATCH /api/cotizaciones/:id/estado. Dos formas:
 * - nueva:    { etapa, motivo_perdida? }  (perdida exige motivo)
 * - heredada: { estado }                  (enviada|revision|rechazada|aprobada|pendiente)
 * Devuelve { ok: true, data: { forma, etapa?, estado?, motivo_perdida } } o { ok: false, error }.
 */
const parseCambioEstado = (body) => {
  const cuerpo = body && typeof body === 'object' ? body : {};
  if (cuerpo.etapa !== undefined) {
    if (!ETAPAS_COTIZACION.includes(cuerpo.etapa)) return { ok: false, error: 'Etapa invalida' };
    const motivoCrudo = cuerpo.motivo_perdida;
    if (motivoCrudo !== undefined && motivoCrudo !== null && typeof motivoCrudo !== 'string') {
      return { ok: false, error: 'motivo_perdida invalido' };
    }
    const motivo = typeof motivoCrudo === 'string' ? motivoCrudo.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    if (cuerpo.etapa === 'perdida' && !motivo) return { ok: false, error: 'Indica el motivo de la pérdida' };
    return { ok: true, data: { forma: 'nueva', etapa: cuerpo.etapa, motivo_perdida: motivo || null } };
  }
  if (!cuerpo.estado || !ESTADOS_HEREDADOS.includes(cuerpo.estado)) return { ok: false, error: 'Estado invalido' };
  return { ok: true, data: { forma: 'heredada', estado: cuerpo.estado, motivo_perdida: null } };
};

const validate = (schema, pick = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[pick] || {});
  if (!result.success) {
    return res.status(400).json({
      error: 'Payload invalido',
      details: result.error.issues.map(issue => issue.message)
    });
  }
  req[pick] = result.data;
  return next();
};

const validateLoginInput = validate(loginSchema);
const validateProductoInput = validate(productoSchema);
const validateBulkProductosInput = validate(bulkProductosSchema);
const validatePasswordInput = validate(passwordSchema);
const validateOwnPasswordInput = validate(ownPasswordSchema);
const validateCreateUserInput = validate(createUserSchema);
const validateCotizacionInput = validate(cotizacionSchema);
const validateCotizacionEditInput = validate(cotizacionEditSchema);
const validateArchivarCotizaciones = validate(archivarCotizacionesSchema);
const validateRestaurarCotizaciones = validate(restaurarCotizacionesSchema);
const validatePreviaArchivado = validate(previaArchivadoSchema, 'query');

module.exports = {
  parseCambioEstado,
  validateArchivarCotizaciones,
  validateRestaurarCotizaciones,
  validatePreviaArchivado,
  validateCotizacionEditInput,
  validateLoginInput,
  validateProductoInput,
  validateBulkProductosInput,
  validatePasswordInput,
  validateOwnPasswordInput,
  validateCreateUserInput,
  validateCotizacionInput
};
