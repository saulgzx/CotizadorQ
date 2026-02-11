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

const cotizacionSchema = z.object({
  cliente: z.object({
    nombre: z.string().optional(),
    empresa: z.string().optional(),
    email: z.string().optional(),
    telefono: z.string().optional()
  }).passthrough(),
  items: z.array(z.object({
    producto_id: z.union([z.number(), z.string()]).optional(),
    cantidad: z.union([z.number(), z.string()]).optional(),
    cant: z.union([z.number(), z.string()]).optional()
  }).passthrough()).optional(),
  total: z.union([z.number(), z.string()]).optional()
}).passthrough();

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
const validateCotizacionInput = validate(cotizacionSchema);

module.exports = {
  validateLoginInput,
  validateProductoInput,
  validateBulkProductosInput,
  validatePasswordInput,
  validateCotizacionInput
};
