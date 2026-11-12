// Valor generado por el seguimiento (función pura sobre eventos y oportunidades cerradas).
//
// - tiempo_ahorrado_min: acciones automáticas × minutos estándar (configurables).
// - ingreso_atribuido: monto de las oportunidades GANADAS (cerradas en el rango) cuyo
//   cliente respondió después de al menos un seguimiento automático enviado (paso >= 1).
// - margen_atribuido: margen de esas oportunidades (precio - costo de su cotización más
//   reciente); null si ninguna tiene costo.
// - respuestas_por_paso: por paso (0 = cotización, 1 y 2 = seguimientos) cuántos envíos
//   hubo en el rango, cuántas respuestas y la tasa.
// - tasa_cierre y ciclo_promedio_dias: de las oportunidades en seguimiento cerradas en el rango.

const DIA_MS = 24 * 60 * 60 * 1000;

const ACCIONES = [
  { clave: 'vincular', evento: 'envio_vinculado' },
  { clave: 'revisar', evento: 'hilo_revisado' },
  { clave: 'borrador', evento: 'borrador_creado' },
  { clave: 'crm', evento: 'crm_actualizado' },
  { clave: 'resumen', evento: 'resumen_diario' }
];

const redondear = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * eventos: eventos del rango [{ oportunidad_id, tipo, detalle }]
 * cerradas: oportunidades cerradas en el rango [{ id, etapa, monto, created_at, cerrada_en, cotizacion_id, en_seguimiento, motivo_perdida }]
 * respuestas: eventos `respuesta` (de cualquier fecha) de esas oportunidades
 * margenes: Map cotizacion_id -> margen | null
 */
const calcularValor = ({ desde, hasta, eventos, cerradas, respuestas, margenes = new Map(), minutos }) => {
  const cuenta = (tipo, filtro = () => true) => eventos.filter((e) => e.tipo === tipo && filtro(e)).length;

  const acciones = {};
  let tiempo = 0;
  for (const { clave, evento } of ACCIONES) {
    const n = cuenta(evento);
    const min = Number(minutos?.[clave]) || 0;
    acciones[clave] = { cantidad: n, minutos_estandar: min, minutos: redondear(n * min, 1) };
    tiempo += n * min;
  }

  const paso = (e) => Number(e.detalle?.paso) || 0;
  const respuestas_por_paso = [0, 1, 2].map((p) => {
    const enviados = p === 0 ? cuenta('envio_vinculado') : cuenta('seguimiento_enviado', (e) => paso(e) === p);
    const resp = cuenta('respuesta', (e) => paso(e) === p);
    return { paso: p, enviados, respuestas: resp, tasa: enviados ? redondear(resp / enviados, 3) : null };
  });

  const pasoRespuesta = new Map();
  for (const r of respuestas) {
    const id = Number(r.oportunidad_id);
    pasoRespuesta.set(id, Math.max(pasoRespuesta.get(id) ?? -1, paso(r)));
  }

  const atribuidas = cerradas.filter((o) => o.etapa === 'ganada' && (pasoRespuesta.get(Number(o.id)) ?? -1) >= 1);
  const ingreso = atribuidas.reduce((s, o) => s + (Number(o.monto) || 0), 0);
  const margenesAtribuidos = atribuidas
    .map((o) => (o.cotizacion_id ? margenes.get(Number(o.cotizacion_id)) : null))
    .filter((m) => m !== null && m !== undefined && Number.isFinite(Number(m)));
  const margen = margenesAtribuidos.length ? margenesAtribuidos.reduce((s, m) => s + Number(m), 0) : null;

  const enSeguimiento = cerradas.filter((o) => o.en_seguimiento);
  const ganadas = enSeguimiento.filter((o) => o.etapa === 'ganada');
  const perdidas = enSeguimiento.filter((o) => o.etapa === 'perdida');
  const tasaCierre = ganadas.length + perdidas.length ? redondear(ganadas.length / (ganadas.length + perdidas.length), 3) : null;
  const ciclos = ganadas
    .filter((o) => o.created_at && o.cerrada_en)
    .map((o) => (new Date(o.cerrada_en).getTime() - new Date(o.created_at).getTime()) / DIA_MS);
  const ciclo = ciclos.length ? redondear(ciclos.reduce((s, d) => s + d, 0) / ciclos.length, 1) : null;

  return {
    desde: new Date(desde).toISOString(),
    hasta: new Date(hasta).toISOString(),
    tiempo_ahorrado_min: redondear(tiempo, 1),
    acciones,
    ingreso_atribuido: redondear(ingreso),
    margen_atribuido: margen === null ? null : redondear(margen),
    oportunidades_atribuidas: atribuidas.map((o) => ({ id: Number(o.id), monto: Number(o.monto) || 0 })),
    respuestas_por_paso,
    tasa_cierre: tasaCierre,
    ciclo_promedio_dias: ciclo,
    ganadas: ganadas.length,
    perdidas: perdidas.length
  };
};

module.exports = { calcularValor, ACCIONES };
