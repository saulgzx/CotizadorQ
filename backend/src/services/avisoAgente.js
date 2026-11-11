// Aviso por WhatsApp cuando el agente IA del miniPC deja de conectarse.
//
// Logica pura con reloj inyectable: `revisar()` se llama periodicamente y manda
// UN aviso por caida (cuando supera el umbral) y otro cuando el agente vuelve.
// Si el envio falla no se marca nada y se reintenta en la siguiente revision.
// El estado vive en memoria: si el backend se reinicia, se olvida la caida en
// curso; y un agente que nunca se ha visto desde el arranque no genera aviso.

const MIN = 60 * 1000;
const REVISION_MS = 60 * 1000;
const VUELTA_MAX_MS = 2 * MIN; // visto hace menos que esto (y que el umbral) = volvio

const leerConfigAviso = (env = process.env) => {
  const minutos =
    env.AGENTE_AVISO_MIN === undefined ? 15 : Number(env.AGENTE_AVISO_MIN);
  return {
    umbralMs: Number.isFinite(minutos) && minutos > 0 ? minutos * MIN : 0
  };
};

/**
 * @param estado  () => ({ vistoEn: ms|null })  ultima vez que el agente pidio trabajo
 * @param enviar  async (texto) => boolean       manda el WhatsApp; true si salio
 */
const crearAvisoDesconexion = ({
  estado,
  enviar,
  ahora = () => Date.now(),
  umbralMs = 15 * MIN,
  logger = console
}) => {
  let caidoDesde = null; // vistoEn de la caida ya avisada

  const intentar = async (texto) => {
    try {
      return !!(await enviar(texto));
    } catch (error) {
      logger.error?.(
        { event: 'agente_aviso_error', err: error.message },
        'No se pudo enviar el aviso del agente'
      );
      return false;
    }
  };

  return {
    async revisar() {
      const { vistoEn } = estado() || {};
      if (!vistoEn) return null;
      const sinVerMs = ahora() - vistoEn;

      if (caidoDesde === null && sinVerMs >= umbralMs) {
        const minutos = Math.floor(sinVerMs / MIN);
        if (
          await intentar(
            `El agente del miniPC lleva ${minutos} min sin conectarse.`
          )
        ) {
          caidoDesde = vistoEn;
          return 'caido';
        }
      } else if (
        caidoDesde !== null &&
        sinVerMs < Math.min(umbralMs, VUELTA_MAX_MS)
      ) {
        const minutos = Math.max(1, Math.round((ahora() - caidoDesde) / MIN));
        if (
          await intentar(
            `El agente del miniPC volvió a conectarse (estuvo ${minutos} min sin conexión).`
          )
        ) {
          caidoDesde = null;
          return 'recuperado';
        }
      }
      return null;
    }
  };
};

/** Conecta el aviso con el gestor y WhatsApp reales. No hace nada si falta algo. */
const vigilarAgente = ({
  gestor,
  whatsapp,
  logger = console,
  env = process.env,
  ahora,
  setIntervalImpl = setInterval
}) => {
  const { umbralMs } = leerConfigAviso(env);
  if (!umbralMs || !whatsapp.habilitado() || gestor.modo() !== 'agente')
    return null;
  const aviso = crearAvisoDesconexion({
    estado: () => gestor.estadoAgente(),
    enviar: (texto) => whatsapp.avisar(texto),
    ahora,
    umbralMs,
    logger
  });
  const timer = setIntervalImpl(
    () => aviso.revisar().catch(() => {}),
    REVISION_MS
  );
  timer?.unref?.();
  return aviso;
};

module.exports = { leerConfigAviso, crearAvisoDesconexion, vigilarAgente };
