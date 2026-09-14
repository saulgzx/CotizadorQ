// Chequeo periodico del stock (T0.4).
//
// Cada hora intenta un login nuevo y lee el stock. Avisa recien al SEGUNDO
// fallo consecutivo: un 500 aislado ya se habia visto antes y no significa
// nada, dos seguidos si. Avisa una vez por caida y otra cuando se recupera,
// para no repetir la alarma cada hora.

import { getCatalogo, leerStockVivo, loginForzado } from './cotizador.js';
import { buscarProductoTolerante, normalizarMpn } from './dominio.js';

export interface EstadoMonitor {
  ultimo_chequeo: string | null;
  ok: boolean | null;
  fallos_consecutivos: number;
  ultimo_error: string | null;
  alerta_activa: boolean;
}

export interface DepsMonitor {
  /** Lanza si el login o el stock fallan. Devuelve un detalle legible. */
  chequear: () => Promise<string>;
  avisar: (mensaje: string) => Promise<void>;
  fallosParaAvisar?: number;
}

export const crearMonitor = ({ chequear, avisar, fallosParaAvisar = 2 }: DepsMonitor) => {
  const estado: EstadoMonitor = {
    ultimo_chequeo: null,
    ok: null,
    fallos_consecutivos: 0,
    ultimo_error: null,
    alerta_activa: false
  };

  const ejecutar = async (): Promise<EstadoMonitor> => {
    estado.ultimo_chequeo = new Date().toISOString();
    try {
      const detalle = await chequear();
      const veniaCaido = estado.alerta_activa;
      estado.ok = true;
      estado.fallos_consecutivos = 0;
      estado.ultimo_error = null;
      estado.alerta_activa = false;
      console.log(`[monitor] stock OK · ${detalle}`);
      if (veniaCaido) await avisarSeguro(`✅ MyQuote: el stock volvio a leerse. ${detalle}`);
    } catch (error) {
      estado.ok = false;
      estado.fallos_consecutivos += 1;
      estado.ultimo_error = error instanceof Error ? error.message : String(error);
      console.error(`[monitor] fallo ${estado.fallos_consecutivos} seguido: ${estado.ultimo_error}`);
      if (estado.fallos_consecutivos >= fallosParaAvisar && !estado.alerta_activa) {
        estado.alerta_activa = true;
        await avisarSeguro(
          `⚠️ MyQuote: el stock no se puede leer (${estado.fallos_consecutivos} chequeos seguidos). ` +
            `Ultimo error: ${estado.ultimo_error} Las cotizaciones muestran el ultimo snapshot fechado.`
        );
      }
    }
    return { ...estado };
  };

  const avisarSeguro = async (mensaje: string) => {
    try {
      await avisar(mensaje);
    } catch (error) {
      console.error(`[monitor] no se pudo enviar el aviso: ${(error as Error).message}`);
    }
  };

  return { ejecutar, estado: () => ({ ...estado }) };
};

// ---------------------------------------------------------------- produccion

const SKU_TESTIGO = process.env.MONITOR_SKU_TESTIGO || 'NW001QNA07';
const WEBHOOK = (process.env.ALERTA_WEBHOOK_URL || '').trim();

const chequeoReal = async (): Promise<string> => {
  await loginForzado();
  const mapa = await leerStockVivo();
  // El testigo confirma que el cruce por MPN sigue funcionando. Que no tenga
  // fila en la planilla no es caida (se pudo agotar): se informa, no se alerta.
  let testigo = 'testigo no verificado';
  try {
    const { producto } = buscarProductoTolerante(await getCatalogo(), SKU_TESTIGO);
    if (producto) {
      const unidades = mapa.get(normalizarMpn(producto.mpn));
      testigo = `${SKU_TESTIGO}: ${unidades === undefined ? 'sin fila en stock' : `${unidades} u.`}`;
    } else {
      testigo = `${SKU_TESTIGO}: no esta en el catalogo`;
    }
  } catch {
    /* el catalogo tiene su propia cache; no invalida el chequeo de stock */
  }
  return `${mapa.size} MPN cargados · ${testigo}`;
};

// Formato {text}: lo aceptan los webhooks entrantes de Slack, Teams y Google Chat.
const avisoReal = async (mensaje: string) => {
  console.error(`[alerta] ${mensaje}`);
  if (!WEBHOOK) return;
  const response = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: mensaje })
  });
  if (!response.ok) throw new Error(`webhook respondio HTTP ${response.status}`);
};

let monitor: ReturnType<typeof crearMonitor> | null = null;

export const iniciarMonitor = () => {
  const minutos = Number(process.env.MONITOR_INTERVALO_MIN ?? 60);
  if (!Number.isFinite(minutos) || minutos <= 0) {
    console.log('[monitor] desactivado (MONITOR_INTERVALO_MIN <= 0)');
    return;
  }
  if (!WEBHOOK) {
    console.warn('[monitor] sin ALERTA_WEBHOOK_URL: los avisos solo quedan en el log.');
  }
  monitor = crearMonitor({ chequear: chequeoReal, avisar: avisoReal });
  const correr = () => void monitor?.ejecutar();
  setTimeout(correr, 30_000).unref();
  setInterval(correr, minutos * 60_000).unref();
};

export const estadoMonitor = () => monitor?.estado() ?? null;
