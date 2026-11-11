// Chequeo de integraciones (PostgreSQL, Google Sheets, costo Chile real).
//
// Existe porque una falla de credenciales de Google dejo al backend "arriba" y con
// los tests en verde mientras /api/stock daba 500 y los precios caian en silencio al
// costo estimado. Aqui todo es logica pura con dependencias inyectables:
//   - crearChequeo(...).ejecutar()  corre las comprobaciones con timeout.
//   - crearAvisoIntegraciones(...)  UN aviso por transicion ok->fallo y fallo->ok.
//   - crearMonitor(...)             corre el chequeo al arrancar y cada N minutos,
//                                   guarda el ultimo resultado y registra los fallos.
// Nada de lo que sale de aqui lleva secretos: los errores se reducen a un motivo
// corto y se censuran emails, claves privadas e ids largos.

const MIN = 60 * 1000;
const TIMEOUT_DEFECTO_MS = 8000;
const INTERVALO_DEFECTO_MIN = 15;

const NOMBRES = {
  POSTGRES: 'postgresql',
  SHEETS: 'google_sheets',
  COSTO_CHILE: 'costo_chile'
};

/** Minutos entre chequeos desde el entorno. Default 15; 0 (o invalido) lo apaga. */
const leerConfigChequeo = (env = process.env) => {
  const bruto = env.INTEGRACIONES_CHECK_MIN;
  const minutos =
    bruto === undefined || String(bruto).trim() === ''
      ? INTERVALO_DEFECTO_MIN
      : Number(bruto);
  return {
    intervaloMs: Number.isFinite(minutos) && minutos > 0 ? minutos * MIN : 0
  };
};

const censurar = (texto) =>
  String(texto || '')
    .replace(/-----BEGIN[\s\S]*?(-----END[^-]*-----|$)/g, '[clave censurada]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email censurado]')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '[ip censurada]')
    .replace(/https?:\/\/\S+/g, '[url censurada]')
    .replace(/[A-Za-z0-9_-]{25,}/g, '[id censurado]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

/** Reduce un error a un texto corto y sin secretos. */
const detalleSeguro = (error) => {
  const codigo = error?.code;
  const status = Number(error?.status || error?.response?.status || codigo);
  const msg = String(error?.message || '');
  if (codigo === 'CHEQUEO_TIMEOUT') return 'timeout: sin respuesta a tiempo';
  if (/invalid_grant|invalid_client|unauthorized_client|credenciales|PRIVATE_KEY|DECODER|private key|no key or keyFile|Could not load the default credentials/i.test(msg))
    return 'autenticacion con Google fallida (credenciales ausentes o invalidas)';
  if (status === 401) return 'autenticacion rechazada (401)';
  if (status === 403) return 'acceso denegado (403): revisar permisos de la hoja';
  if (status === 404) return 'hoja o pestana no encontrada (404)';
  if (status === 429) return 'cuota de Google excedida (429)';
  if (status >= 500 && status < 600) return `error del servicio remoto (${status})`;
  return censurar(msg) || 'error desconocido';
};

const conTimeout = (promesa, ms) => {
  let timer;
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('timeout');
      err.code = 'CHEQUEO_TIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer));
};

/**
 * @param comprobaciones  [{ nombre, depende?, ejecutar: async () => string | { noConfigurado, detalle } }]
 *        `ejecutar` lanza si falla. `depende` = nombre de otra comprobacion: si esa
 *        no esta ok no se intenta (evita una segunda lectura a Google inutil).
 */
const crearChequeo = ({
  comprobaciones,
  timeoutMs = TIMEOUT_DEFECTO_MS,
  ahora = () => Date.now()
}) => {
  const correr = async (c) => {
    const inicio = ahora();
    const revisadoEn = new Date(inicio).toISOString();
    const fin = (estado, ok, detalle) => ({
      nombre: c.nombre,
      ok,
      estado,
      detalle,
      duracion_ms: Math.max(0, ahora() - inicio),
      revisado_en: revisadoEn
    });
    try {
      const r = await conTimeout(Promise.resolve().then(c.ejecutar), timeoutMs);
      if (r && typeof r === 'object' && r.noConfigurado) {
        return fin('no_configurado', true, r.detalle || 'no configurado');
      }
      return fin('ok', true, (r && r.detalle) || (typeof r === 'string' ? r : 'ok'));
    } catch (error) {
      return fin('fallo', false, detalleSeguro(error));
    }
  };

  return {
    async ejecutar() {
      const resultados = [];
      const porNombre = new Map();
      for (const c of comprobaciones) {
        const previo = c.depende ? porNombre.get(c.depende) : null;
        let r;
        if (previo && previo.estado === 'no_configurado') {
          r = {
            nombre: c.nombre,
            ok: true,
            estado: 'no_configurado',
            detalle: `no configurado (depende de ${c.depende})`,
            duracion_ms: 0,
            revisado_en: new Date(ahora()).toISOString()
          };
        } else if (previo && !previo.ok) {
          r = {
            nombre: c.nombre,
            ok: false,
            estado: 'fallo',
            detalle: `no verificado: falla ${c.depende}`,
            duracion_ms: 0,
            revisado_en: new Date(ahora()).toISOString()
          };
        } else {
          r = await correr(c);
        }
        porNombre.set(c.nombre, r);
        resultados.push(r);
      }
      return resultados;
    }
  };
};

/**
 * UN aviso cuando una integracion pasa de ok a fallo y otro cuando se recupera.
 * Un fallo en el primer chequeo tras el arranque cuenta como caida (justo ese es
 * el caso que no puede pasar desapercibido). Si el envio falla no se marca nada
 * y se reintenta en el siguiente chequeo.
 */
const crearAvisoIntegraciones = ({
  enviar,
  ahora = () => Date.now(),
  logger = console
}) => {
  const caidas = new Map(); // nombre -> ms desde que se aviso la caida

  const intentar = async (texto) => {
    try {
      return !!(await enviar(texto));
    } catch (error) {
      logger.error?.(
        { event: 'integraciones_aviso_error', err: censurar(error?.message) },
        'No se pudo enviar el aviso de integraciones'
      );
      return false;
    }
  };

  return {
    /** @returns {Promise<Array<{nombre, tipo: 'caida'|'recuperada'}>>} avisos enviados */
    async revisar(resultados) {
      const enviados = [];
      for (const r of resultados || []) {
        const caida = caidas.get(r.nombre);
        if (!r.ok && caida === undefined) {
          if (await intentar(`MyQuote: falla la integración ${r.nombre}. ${r.detalle}`)) {
            caidas.set(r.nombre, ahora());
            enviados.push({ nombre: r.nombre, tipo: 'caida' });
          }
        } else if (r.ok && caida !== undefined) {
          const minutos = Math.max(1, Math.round((ahora() - caida) / MIN));
          if (
            await intentar(
              `MyQuote: la integración ${r.nombre} se recuperó (estuvo ${minutos} min con falla).`
            )
          ) {
            caidas.delete(r.nombre);
            enviados.push({ nombre: r.nombre, tipo: 'recuperada' });
          }
        }
      }
      return enviados;
    }
  };
};

/**
 * Guarda el ultimo resultado en memoria y lo mantiene al dia. Nunca lanza:
 * un chequeo roto no debe tumbar MyQuote.
 */
const crearMonitor = ({
  chequeo,
  aviso = null,
  logger = console,
  ahora = () => Date.now()
}) => {
  let ultimo = null; // { revisado_en, ok, integraciones }
  let enCurso = null;

  const ejecutarUnaVez = async () => {
    try {
      const integraciones = await chequeo.ejecutar();
      for (const r of integraciones) {
        if (!r.ok) {
          logger.error(
            { event: 'integracion_fallo', integracion: r.nombre, detalle: r.detalle },
            `Integración ${r.nombre} con falla: ${r.detalle}`
          );
        }
      }
      ultimo = {
        revisado_en: new Date(ahora()).toISOString(),
        ok: integraciones.every((r) => r.ok),
        integraciones
      };
      if (aviso) await aviso.revisar(integraciones);
    } catch (error) {
      logger.error(
        { event: 'integraciones_chequeo_error', err: censurar(error?.message) },
        'El chequeo de integraciones fallo'
      );
    }
    return ultimo;
  };

  return {
    /** Una sola ejecucion a la vez: llamadas simultaneas comparten la misma. */
    revisar() {
      if (!enCurso) {
        enCurso = ejecutarUnaVez().finally(() => {
          enCurso = null;
        });
      }
      return enCurso;
    },
    ultimo: () => ultimo,
    /** Chequeo inicial en segundo plano + repeticion. Devuelve el timer o null. */
    iniciar({ intervaloMs, setIntervalImpl = setInterval } = {}) {
      this.revisar();
      if (!intervaloMs) return null;
      const timer = setIntervalImpl(() => this.revisar(), intervaloMs);
      timer?.unref?.();
      return timer;
    }
  };
};

module.exports = {
  NOMBRES,
  leerConfigChequeo,
  detalleSeguro,
  censurar,
  crearChequeo,
  crearAvisoIntegraciones,
  crearMonitor
};
