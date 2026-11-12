// Configuración del seguimiento desde variables de entorno (ver docs/SEGUIMIENTO.md).

const entero = (v, def, min = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= min ? n : def;
};

const numero = (v, def) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : def;
};

/** "07:30,13:00" -> [{ hora: 7, minuto: 30, texto: '07:30' }, ...] ordenadas. */
const leerHoras = (v, def) => {
  const horas = String(v || def)
    .split(',')
    .map((s) => /^(\d{1,2}):(\d{2})$/.exec(s.trim()))
    .filter((m) => m && Number(m[1]) < 24 && Number(m[2]) < 60)
    .map((m) => ({ hora: Number(m[1]), minuto: Number(m[2]) }))
    .sort((a, b) => a.hora * 60 + a.minuto - (b.hora * 60 + b.minuto))
    .map((h) => ({ ...h, texto: `${String(h.hora).padStart(2, '0')}:${String(h.minuto).padStart(2, '0')}` }));
  return horas.length ? horas : leerHoras(def, def);
};

const leerConfigSeguimiento = (env = process.env) => ({
  activo: String(env.SEGUIMIENTO_ACTIVO || '').trim().toLowerCase() === 'true',
  cadaMin: entero(env.SEGUIMIENTO_CADA_MIN, 15, 1),
  horasRevision: leerHoras(env.SEGUIMIENTO_REVISION_HORAS, '07:30,13:00,17:30'),
  resumenDiario: leerHoras(env.SEGUIMIENTO_RESUMEN_DIARIO, '08:30')[0],
  resumenSemanal: leerHoras(env.SEGUIMIENTO_RESUMEN_SEMANAL, '17:00')[0],
  diasAlta: entero(env.SEGUIMIENTO_DIAS_ALTA, 30, 1),
  validezDias: entero(env.SEGUIMIENTO_VALIDEZ_DIAS, 15, 1),
  tareas: {
    maxItems: 20,
    reintentoMs: 15 * 60 * 1000,
    tomaVenceMs: 15 * 60 * 1000,
    maxIntentos: 3
  },
  minutos: {
    vincular: numero(env.SEGUIMIENTO_MIN_VINCULAR, 2),
    revisar: numero(env.SEGUIMIENTO_MIN_REVISAR, 2),
    borrador: numero(env.SEGUIMIENTO_MIN_BORRADOR, 6),
    crm: numero(env.SEGUIMIENTO_MIN_CRM, 3),
    resumen: numero(env.SEGUIMIENTO_MIN_RESUMEN, 10)
  },
  plantilla: {
    nombre: String(env.WHATSAPP_PLANTILLA_RESUMEN || '').trim() || null,
    idioma: String(env.WHATSAPP_PLANTILLA_IDIOMA || 'es').trim() || 'es'
  }
});

module.exports = { leerConfigSeguimiento, leerHoras };
