// Resúmenes del seguimiento: datos (JSON de /api/seguimiento/hoy) y textos cortos
// para WhatsApp, pensados para leerse en el teléfono. Funciones puras.

const { ESTADOS, siguientePaso } = require('./motor');

const DIA_MS = 24 * 60 * 60 * 1000;
const MAX_LINEAS = 5;
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const iso = (v) => (v ? new Date(v).toISOString() : null);

const nombre = (s) => s.empresa_nombre || s.cliente_empresa || s.titulo || `Oportunidad ${s.oportunidad_id}`;

/** Día ISO en que vence la validez de la cotización (emisión + validezDias, en Chile). */
const venceEn = (s, cal, validezDias) =>
  s.cotizacion_creada_en ? cal.sumarDiasIso(cal.fechaChile(s.cotizacion_creada_en), validezDias) : null;

const base = (s) => ({
  oportunidad_id: Number(s.oportunidad_id),
  cotizacion_id: s.cotizacion_id ? Number(s.cotizacion_id) : null,
  empresa: nombre(s),
  numero: s.numero ?? null,
  monto: s.total ?? s.monto ?? null
});

/**
 * Datos del resumen diario.
 * segs: seguimientos con datos de oportunidad (crmAdaptador.oportunidadesParaSeguimiento).
 */
const datosHoy = (segs, ahora, cal, { validezDias = 15 } = {}) => {
  const hoy = cal.fechaChile(ahora);
  const desdeRespuestas = cal.instanteChile(cal.habilAnterior(ahora), 0, 0).getTime();
  // Fin de semana: domingo de la semana en curso (lunes a domingo).
  const dow = cal.diaSemana(ahora);
  const domingo = cal.sumarDiasIso(hoy, dow === 0 ? 0 : 7 - dow);
  const activos = [ESTADOS.BUSCANDO, ESTADOS.ESPERANDO, ESTADOS.BORRADOR];

  const borradores = segs
    .filter((s) => s.estado === ESTADOS.BORRADOR)
    .map((s) => {
      const sp = siguientePaso(s, ahora, cal);
      return {
        ...base(s),
        paso: Number(s.borrador_paso) || (Number(s.paso) || 0) + 1,
        creado_en: iso(s.borrador_creado_en),
        dias_habiles: s.borrador_creado_en ? cal.diasHabilesEntre(s.borrador_creado_en, ahora) : 0,
        recordar: !!sp.recordar
      };
    });

  return {
    fecha: hoy,
    generado_en: new Date(ahora).toISOString(),
    borradores_listos: borradores.filter((b) => !b.recordar),
    respuestas: segs
      .filter((s) => s.estado === ESTADOS.RESPONDIDA && s.respuesta_en && new Date(s.respuesta_en).getTime() >= desdeRespuestas)
      .map((s) => ({ ...base(s), respuesta_en: iso(s.respuesta_en), resumen: s.respuesta_resumen || null })),
    borradores_sin_enviar: borradores.filter((b) => b.recordar),
    vencen_esta_semana: segs
      .filter((s) => activos.includes(s.estado))
      .map((s) => ({ s, vence: venceEn(s, cal, validezDias) }))
      .filter(({ vence }) => vence && vence >= hoy && vence <= domingo)
      .map(({ s, vence }) => ({ ...base(s), vence_en: vence })),
    sin_correo: segs
      .filter((s) => s.estado === ESTADOS.SIN_ENVIO)
      .map((s) => ({ ...base(s), creada_en: iso(s.cotizacion_creada_en) })),
    pausadas: segs.filter((s) => s.estado === ESTADOS.PAUSADA).map(base)
  };
};

const fechaCorta = (isoDia) => {
  const d = new Date(`${isoDia}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`;
};

const usd = (n) => `US$ ${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

const bloque = (titulo, lista, linea) => {
  if (!lista.length) return [];
  const lineas = lista.slice(0, MAX_LINEAS).map((x) => `• ${linea(x)}`);
  if (lista.length > MAX_LINEAS) lineas.push(`• y ${lista.length - MAX_LINEAS} más`);
  return [`*${titulo} (${lista.length})*`, ...lineas];
};

const pasoTexto = (p) => (p === 1 ? '1er seg.' : p === 2 ? '2º seg.' : 'envío');

const recortar = (t, n = 120) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t || '');

const textoDiario = (d) => {
  const partes = [
    ...bloque('Borradores para enviar', d.borradores_listos, (b) => `${b.empresa}${b.numero ? ` N°${b.numero}` : ''} (${pasoTexto(b.paso)})`),
    ...bloque('Respuestas', d.respuestas, (r) => `${r.empresa}${r.numero ? ` N°${r.numero}` : ''}${r.resumen ? `: ${recortar(r.resumen)}` : ''}`),
    ...bloque('Borradores sin enviar hace 2+ días', d.borradores_sin_enviar, (b) => `${b.empresa}${b.numero ? ` N°${b.numero}` : ''} (${b.dias_habiles} días)`),
    ...bloque('Vencen esta semana', d.vencen_esta_semana, (v) => `${v.empresa}${v.numero ? ` N°${v.numero}` : ''}, ${fechaCorta(v.vence_en)}`),
    ...bloque('Sin correo encontrado', d.sin_correo, (s) => `${s.empresa}${s.numero ? ` N°${s.numero}` : ''}`)
  ];
  if (d.pausadas.length) partes.push(`Pausados: ${d.pausadas.length}`);
  const titulo = `*Seguimiento MyQuote · ${fechaCorta(d.fecha)}*`;
  return [titulo, ...(partes.length ? partes : ['Sin pendientes hoy.'])].join('\n');
};

/** Datos del resumen semanal. */
const datosSemana = ({ valor, cerradas, abiertas }) => {
  const ganadas = cerradas.filter((o) => o.etapa === 'ganada');
  const perdidas = cerradas.filter((o) => o.etapa === 'perdida');
  const motivos = {};
  for (const o of perdidas) {
    const m = o.motivo_perdida || 'Sin motivo';
    motivos[m] = (motivos[m] || 0) + 1;
  }
  const suma = (l) => Math.round(l.reduce((s, o) => s + (Number(o.monto) || 0), 0) * 100) / 100;
  return {
    desde: valor.desde,
    hasta: valor.hasta,
    respuestas_por_paso: valor.respuestas_por_paso,
    ganadas: { cantidad: ganadas.length, monto: suma(ganadas) },
    perdidas: { cantidad: perdidas.length, monto: suma(perdidas) },
    motivos_perdida: Object.entries(motivos)
      .sort((a, b) => b[1] - a[1])
      .map(([motivo, cantidad]) => ({ motivo, cantidad })),
    abiertas_mayores: abiertas.map((o) => ({
      oportunidad_id: Number(o.id),
      empresa: o.empresa_nombre || o.titulo,
      etapa: o.etapa,
      monto: Number(o.monto) || 0
    })),
    valor
  };
};

const horasMin = (min) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

const textoSemanal = (s) => {
  const tasa = s.respuestas_por_paso
    .map((p) => `${pasoTexto(p.paso)} ${p.respuestas}/${p.enviados}`)
    .join(' · ');
  const lineas = [
    '*Seguimiento MyQuote · semana*',
    `Respuestas: ${tasa}`,
    `Ganadas: ${s.ganadas.cantidad} (${usd(s.ganadas.monto)}) · Perdidas: ${s.perdidas.cantidad} (${usd(s.perdidas.monto)})`
  ];
  if (s.motivos_perdida.length) {
    lineas.push(`Motivos: ${s.motivos_perdida.map((m) => `${m.motivo} ${m.cantidad}`).join(', ')}`);
  }
  if (s.abiertas_mayores.length) {
    lineas.push('*Abiertas más grandes*');
    for (const o of s.abiertas_mayores) lineas.push(`• ${o.empresa}: ${usd(o.monto)} (${o.etapa})`);
  }
  lineas.push(
    `Valor: ${horasMin(s.valor.tiempo_ahorrado_min)} ahorrados · ${usd(s.valor.ingreso_atribuido)} atribuidos` +
      (s.valor.margen_atribuido !== null ? ` · margen ${usd(s.valor.margen_atribuido)}` : '')
  );
  return lineas.join('\n');
};

/** Para plantillas de WhatsApp: un parámetro no admite saltos de línea ni 4+ espacios. */
const unaLinea = (texto, max = 1000) => {
  const t = String(texto)
    .replace(/\n+/g, ' | ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

module.exports = { datosHoy, textoDiario, datosSemana, textoSemanal, unaLinea, venceEn, DIA_MS };
