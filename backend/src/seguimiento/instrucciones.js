// Textos que acompañan a cada tarea del agente y guías de redacción por paso.

const SEGURIDAD =
  'Usa solo herramientas de Outlook para buscar/leer correos y crear o actualizar borradores. ' +
  'Nunca envíes, reenvíes, borres ni muevas correos, ni cambies reglas. ' +
  'Devuelve solo el JSON del resultado, sin datos del correo que no pida el contrato.';

const INSTRUCCIONES = {
  buscar_envios:
    'Para cada ítem, busca en Elementos enviados desde `creada_en` un correo con un adjunto PDF cuyo ' +
    'nombre sea `pdf_nombre_base` seguido de cualquier sufijo de versión `_v<N>.pdf` (por ejemplo ' +
    '`<pdf_nombre_base>_v1.pdf` o `<pdf_nombre_base>_v3.pdf`: la cotización pudo editarse después de ' +
    'enviarla; `pdf_nombre` es el nombre de la v1), o cuyo adjunto contenga el folio "COT-<numero>" o ' +
    '"Cotización N°<numero>". ' +
    'Devuelve por ítem { cotizacion_id, encontrado, message_id?, conversation_id?, enviado_en? } ' +
    '(enviado_en en ISO 8601 con zona). ' +
    SEGURIDAD,
  revisar_hilos:
    'Para cada hilo (conversation_id), mira los mensajes desde `desde`: si llegó un mensaje de otra ' +
    'persona, marca respuesta_recibida con respuesta_en, remitente y un resumen de 1-2 frases sin datos ' +
    'sensibles (sin teléfonos, montos de otros proveedores ni datos personales). Indica también ' +
    'ultimo_envio_mio_en (último correo enviado por el dueño en el hilo) y, si se indicó borrador_id, ' +
    'si el borrador sigue existiendo (borrador_existe) y si fue enviado (borrador_enviado). ' +
    SEGURIDAD,
  crear_borradores:
    'Para cada ítem, crea un borrador de RESPUESTA A TODOS en el hilo de `message_id`, en español, breve, ' +
    'en el tono del dueño, siguiendo `guia` y usando solo los datos de `contexto` (no inventes precios ni ' +
    'plazos). No lo envíes. Devuelve por ítem { oportunidad_id, creado, borrador_id?, asunto? }. ' +
    SEGURIDAD
};

const GUIAS = {
  1:
    'Primer seguimiento (3 días hábiles después del envío). En 3 a 5 líneas: confirma que recibió la ' +
    'cotización, menciona el stock y la entrega vigentes de los productos (de `contexto.productos`) y ' +
    'ofrece resolver dudas.',
  2:
    'Segundo seguimiento (7 días hábiles después del primero). En 3 a 5 líneas: recuerda que la ' +
    'validez vence el `contexto.validez_vence_en`, agrega un dato de urgencia REAL del contexto (stock ' +
    'disponible bajo o plazo de llegada) y pregunta si avanzan o si hay algo que ajustar.'
};

module.exports = { INSTRUCCIONES, GUIAS };
