// Validación estricta (zod 4) de los resultados que devuelve el agente del miniPC.
// Un resultado que no calza no toca el estado: la cola lo registra y reintenta.

const { z } = require('zod');

const id = z.coerce.number().int().positive();
const fecha = z.iso.datetime({ offset: true });
const texto = (max) => z.string().trim().min(1).max(max);
const correo = z.string().trim().max(320);

const itemBuscarEnvio = z
  .object({
    cotizacion_id: id,
    encontrado: z.boolean(),
    message_id: texto(1000).optional(),
    conversation_id: texto(1000).optional(),
    enviado_en: fecha.optional(),
    para: z.array(correo).max(100).optional(),
    asunto: z.string().max(1000).optional()
  })
  .strict()
  .refine((i) => !i.encontrado || (i.message_id && i.conversation_id && i.enviado_en), {
    message: 'encontrado=true exige message_id, conversation_id y enviado_en'
  });

const itemRevisarHilo = z
  .object({
    oportunidad_id: id,
    respuesta_recibida: z.boolean(),
    respuesta_en: fecha.optional(),
    remitente: z.string().trim().max(320).optional(),
    resumen: z.string().max(4000).optional(),
    ultimo_envio_mio_en: fecha.optional(),
    borrador_existe: z.boolean().optional(),
    borrador_enviado: z.boolean().optional()
  })
  .strict();

const itemCrearBorrador = z
  .object({
    oportunidad_id: id,
    creado: z.boolean(),
    borrador_id: texto(1000).optional(),
    asunto: z.string().max(1000).optional()
  })
  .strict()
  .refine((i) => !i.creado || !!i.borrador_id, { message: 'creado=true exige borrador_id' });

const ITEM_POR_TIPO = {
  buscar_envios: itemBuscarEnvio,
  revisar_hilos: itemRevisarHilo,
  crear_borradores: itemCrearBorrador
};

const cuerpoResultado = z
  .object({
    ok: z.boolean(),
    items: z.array(z.unknown()).max(200).default([]),
    error: z.string().max(2000).optional(),
    metricas: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

const resumirError = (error) =>
  error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
    .join('; ')
    .slice(0, 500);

/**
 * Valida el cuerpo completo para un tipo de tarea.
 * Devuelve { ok: true, data: { ok, items, error, metricas } } o { ok: false, error }.
 */
const validarResultado = (tipo, cuerpo) => {
  const esquemaItem = ITEM_POR_TIPO[tipo];
  if (!esquemaItem) return { ok: false, error: `tipo desconocido: ${tipo}` };
  const base = cuerpoResultado.safeParse(cuerpo);
  if (!base.success) return { ok: false, error: resumirError(base.error) };
  const items = [];
  for (let i = 0; i < base.data.items.length; i += 1) {
    const r = esquemaItem.safeParse(base.data.items[i]);
    if (!r.success) return { ok: false, error: `items.${i}: ${resumirError(r.error)}` };
    items.push(r.data);
  }
  return { ok: true, data: { ...base.data, items } };
};

module.exports = { validarResultado, ITEM_POR_TIPO };
