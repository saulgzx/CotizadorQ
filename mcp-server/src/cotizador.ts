// Cliente HTTP contra el backend de CotizadorQ.
//
// Responsabilidades: login con la cuenta de servicio, cache del JWT, re-login
// ante 401, reintentos con backoff en 429/5xx, y cache en memoria del catalogo
// y del stock (que vienen completos, sin endpoint de busqueda).
//
// Regla dura: ni el password ni el token salen nunca en logs ni en errores.

import { randomUUID } from 'node:crypto';
import {
  buscarProductoTolerante,
  normalizarMpn,
  unidadesDe,
  type LecturaStock,
  type Producto,
  type TipoCoincidencia
} from './dominio.js';
import { guardarSnapshot, leerSnapshot } from './snapshot.js';

export type { LecturaStock, Producto, TipoCoincidencia } from './dominio.js';

const API_URL = (process.env.COTIZADOR_API_URL || '').replace(/\/+$/, '');
const USER = process.env.COTIZADOR_USER || '';
const PASS = process.env.COTIZADOR_PASS || '';

// El backend no valida solo el JWT: requireAuth exige ademas X-Session-Id, y si
// falta responde 401 "Sesion requerida". Un id desconocido si se acepta (el
// middleware registra la sesion sobre la marcha), pero la ausencia del header no.
//
// El id se genera una vez por proceso y se reusa en TODAS las peticiones,
// incluido el login. Es a proposito: para rol "client" el backend permite una
// sola sesion activa y revoca las anteriores al crear una nueva, asi que rotar
// el id en cada login haria que el server se expulsara a si mismo.
const SESSION_ID = process.env.MCP_SESSION_ID || `mcp-${randomUUID()}`;
const DEVICE_ID = process.env.MCP_DEVICE_ID || 'mcp-server';
const USER_AGENT = 'cotizadorq-mcp/1.0';

const cabecerasSesion = () => ({
  'x-session-id': SESSION_ID,
  'x-device-id': DEVICE_ID,
  'user-agent': USER_AGENT
});

const TIMEOUT_MS = Number(process.env.COTIZADOR_TIMEOUT_MS || 30000);
const MAX_RETRIES = Number(process.env.COTIZADOR_MAX_RETRIES || 3);
const CATALOGO_TTL_MS = Number(process.env.CATALOGO_TTL_MIN || 10) * 60 * 1000;
const STOCK_TTL_MS = Number(process.env.STOCK_TTL_MIN || 5) * 60 * 1000;
// Una lectura fallida se recuerda poco: cachearla 5 min dejaba el stock caido
// aunque el backend ya se hubiera recuperado.
const STOCK_FALLO_TTL_MS = Number(process.env.STOCK_FALLO_TTL_SEG || 30) * 1000;
// Tras un login fallido no se reintenta de inmediato: cada intento cuenta para
// el rate limit del backend (5 fallos en 15 min bloquean la cuenta).
const LOGIN_ENFRIAMIENTO_MS = Number(process.env.LOGIN_ENFRIAMIENTO_SEG || 60) * 1000;

export const DIAS_CREACION_SKU = Math.max(0, Math.trunc(Number(process.env.DIAS_CREACION_SKU ?? 7)));

// MPN EOL adicionales a src/datos/eol.ts, coma-separados.
export const EOL_EXTRA: ReadonlySet<string> = new Set(
  (process.env.MCP_EOL_MPN || '')
    .split(',')
    .map((valor) => valor.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean)
);

export interface LineaResuelta {
  /** Como se llego al producto: exacta, parcial o por descripcion. */
  coincidencia: TipoCoincidencia;
  producto: Producto;
  cantidad: number;
  stock: number | string | null;
  precio_unitario: number;
  precio_total: number;
}

export interface SkuNoResuelto {
  sku: string;
  motivo: string;
}

export class CotizadorError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'CotizadorError';
  }
}

export const verificarConfig = (): void => {
  const faltantes: string[] = [];
  if (!API_URL) faltantes.push('COTIZADOR_API_URL');
  if (!USER) faltantes.push('COTIZADOR_USER');
  if (!PASS) faltantes.push('COTIZADOR_PASS');
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${faltantes.join(', ')}. ` +
        'Cargalas en Railway > servicio mcp-server > Variables.'
    );
  }
  // Diagnostico T0.1: comillas o espacios pegados junto al valor en Railway
  // producen un login fallido que parece "contraseña incorrecta".
  for (const [nombre, valor] of [
    ['COTIZADOR_USER', USER],
    ['COTIZADOR_PASS', PASS]
  ] as const) {
    if (valor !== valor.trim()) console.warn(`[config] ${nombre} tiene espacios al inicio o al final.`);
    if (/^["'].*["']$/.test(valor)) console.warn(`[config] ${nombre} viene envuelta en comillas.`);
  }
};

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry-After puede venir en segundos o como fecha HTTP.
const leerRetryAfter = (valor: string | null): number | null => {
  if (!valor) return null;
  const segundos = Number(valor);
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000);
  const fecha = Date.parse(valor);
  if (Number.isFinite(fecha)) return Math.max(0, fecha - Date.now());
  return null;
};

// ------------------------------------------------------------------- login

const MAX_CUERPO_LOG = 2048;
const CABECERAS_OMITIDAS = new Set(['set-cookie', 'authorization', 'cookie']);

/** Quita cualquier aparicion de las credenciales antes de loguear. */
const censurar = (texto: string) => {
  let limpio = texto;
  for (const secreto of [PASS, USER]) {
    if (secreto && secreto.length >= 3) limpio = limpio.split(secreto).join('[censurado]');
  }
  return limpio.replace(/"token"\s*:\s*"[^"]*"/g, '"token":"[censurado]"');
};

export interface FalloLogin {
  status: number | null;
  /** Mensaje de error que devolvio el backend, si vino en JSON. */
  error_backend: string | null;
  en: string;
}
let ultimoFalloLogin: FalloLogin | null = null;
export const getUltimoFalloLogin = () => ultimoFalloLogin;

/**
 * Diagnostico T0.1: el status solo no distingue una credencial rota (401) de
 * un error de aplicacion (500 con "Error del servidor"), un bloqueo (429) o
 * una pagina HTML de un proxy. Se loguea cuerpo y cabeceras, truncados y sin
 * credenciales.
 */
const registrarFalloLogin = async (response: Response): Promise<FalloLogin> => {
  let cuerpo = '';
  try {
    cuerpo = await response.text();
  } catch {
    /* sin cuerpo legible */
  }
  let errorBackend: string | null = null;
  try {
    errorBackend = (JSON.parse(cuerpo) as { error?: string })?.error || null;
  } catch {
    /* no era JSON: probablemente HTML de un proxy o del runtime */
  }
  const cabeceras = Object.fromEntries(
    [...response.headers.entries()].filter(([nombre]) => !CABECERAS_OMITIDAS.has(nombre.toLowerCase()))
  );
  console.error(
    '[login] fallo',
    JSON.stringify({
      status: response.status,
      cabeceras,
      cuerpo: censurar(cuerpo.slice(0, MAX_CUERPO_LOG)),
      cuerpo_truncado: cuerpo.length > MAX_CUERPO_LOG
    })
  );
  const fallo: FalloLogin = {
    status: response.status,
    error_backend: errorBackend ? censurar(errorBackend).slice(0, 200) : null,
    en: new Date().toISOString()
  };
  ultimoFalloLogin = fallo;
  return fallo;
};

const pistaPorStatus = (status: number) => {
  if (status === 401) return 'Credencial rechazada: revisa COTIZADOR_USER y COTIZADOR_PASS.';
  if (status === 429) return 'Cuenta o IP bloqueada por intentos fallidos: espera 15 min antes de reintentar.';
  if (status >= 500) return 'Error del lado de CotizadorQ, no de la credencial: revisa los logs del backend.';
  return 'Revisa COTIZADOR_USER y COTIZADOR_PASS.';
};

let tokenCache: string | null = null;
let loginEnCurso: Promise<string> | null = null;
let errorLoginReciente: { error: CotizadorError; hasta: number } | null = null;

const loginReal = async (): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...cabecerasSesion() },
        body: JSON.stringify({ usuario: USER, password: PASS }),
        signal: controller.signal
      });
    } catch {
      ultimoFalloLogin = { status: null, error_backend: null, en: new Date().toISOString() };
      throw new CotizadorError('No se pudo contactar a CotizadorQ para el login.');
    }
    if (!response.ok) {
      const fallo = await registrarFalloLogin(response);
      // El mensaje lleva el error del backend (nunca credenciales) y una pista.
      throw new CotizadorError(
        `Login contra CotizadorQ fallo (HTTP ${response.status}` +
          `${fallo.error_backend ? `: ${fallo.error_backend}` : ''}). ${pistaPorStatus(response.status)}`,
        response.status
      );
    }
    const data = (await response.json()) as { token?: string };
    if (!data?.token) {
      throw new CotizadorError('El login no devolvio token.');
    }
    tokenCache = data.token;
    ultimoFalloLogin = null;
    return data.token;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Un solo login a la vez. Antes, consultar_producto pedia catalogo y stock en
 * paralelo y, sin token, disparaba DOS logins simultaneos con el mismo
 * X-Session-Id. El backend inserta la sesion con un indice unico
 * (user_id, session_id): el segundo INSERT chocaba y el login respondia 500.
 * El catalogo se llevaba el token y el stock se quedaba con el error.
 */
export const login = (): Promise<string> => {
  if (loginEnCurso) return loginEnCurso;
  if (errorLoginReciente && Date.now() < errorLoginReciente.hasta) {
    return Promise.reject(errorLoginReciente.error);
  }
  loginEnCurso = loginReal()
    .then((token) => {
      errorLoginReciente = null;
      return token;
    })
    .catch((error: unknown) => {
      const fallo = error instanceof CotizadorError ? error : new CotizadorError('Login fallo.');
      errorLoginReciente = { error: fallo, hasta: Date.now() + LOGIN_ENFRIAMIENTO_MS };
      throw fallo;
    })
    .finally(() => {
      loginEnCurso = null;
    });
  return loginEnCurso;
};

const getToken = async (): Promise<string> => (tokenCache ? tokenCache : login());

/** Para el chequeo periodico: fuerza un login nuevo, saltando token y enfriamiento. */
export const loginForzado = (): Promise<string> => {
  tokenCache = null;
  errorLoginReciente = null;
  return login();
};

interface PeticionOpts {
  method?: string;
  body?: unknown;
  /** Cuando es true devuelve el buffer crudo en vez de parsear JSON. */
  binario?: boolean;
}

/**
 * Ejecuta una peticion autenticada. Reintenta 429/5xx con backoff y, ante un
 * 401, re-loguea una sola vez antes de volver a intentar.
 */
const peticion = async <T>(ruta: string, opts: PeticionOpts = {}): Promise<T> => {
  let reintentoPorAuth = false;

  for (let intento = 0; intento <= MAX_RETRIES; intento += 1) {
    const token = await getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${API_URL}${ruta}`, {
        method: opts.method || 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...cabecerasSesion(),
          ...(opts.body ? { 'content-type': 'application/json' } : {})
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal
      });

      if (response.status === 401 && !reintentoPorAuth) {
        // El JWT dura 24h; si expiro, un solo re-login y se reintenta.
        reintentoPorAuth = true;
        // Solo se descarta si nadie lo renovo mientras tanto.
        if (tokenCache === token) tokenCache = null;
        // El re-login no gasta un intento: con MAX_RETRIES=0 el loop terminaba
        // aca y el error real del login quedaba tapado por uno generico.
        intento -= 1;
        continue;
      }

      if (response.ok) {
        if (opts.binario) return Buffer.from(await response.arrayBuffer()) as T;
        return (await response.json()) as T;
      }

      const reintentable = response.status === 429 || response.status >= 500;
      if (!reintentable || intento === MAX_RETRIES) {
        let detalle = '';
        try {
          const cuerpo = (await response.json()) as { error?: string };
          detalle = cuerpo?.error || '';
        } catch {
          /* respuesta sin JSON */
        }
        throw new CotizadorError(
          `${ruta} respondio HTTP ${response.status}${detalle ? `: ${detalle}` : ''}`,
          response.status
        );
      }

      const espera = leerRetryAfter(response.headers.get('retry-after')) ?? 500 * 2 ** intento;
      await dormir(espera);
      continue;
    } catch (error) {
      if (error instanceof CotizadorError) throw error;
      if (intento === MAX_RETRIES) {
        throw new CotizadorError(`No se pudo contactar a CotizadorQ en ${ruta}.`);
      }
      await dormir(500 * 2 ** intento);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new CotizadorError(`No se pudo completar la peticion a ${ruta}.`);
};

// ---------------------------------------------------------------- catalogo

interface Cache<T> {
  datos: T | null;
  expira: number;
}

const catalogoCache: Cache<Producto[]> = { datos: null, expira: 0 };
const stockCache: Cache<LecturaStock> = { datos: null, expira: 0 };

export const getCatalogo = async (): Promise<Producto[]> => {
  if (catalogoCache.datos && Date.now() < catalogoCache.expira) return catalogoCache.datos;
  // No hay endpoint de busqueda: /api/productos devuelve el catalogo completo.
  const filas = await peticion<Producto[]>('/api/productos');
  const productos = Array.isArray(filas) ? filas : [];
  catalogoCache.datos = productos;
  catalogoCache.expira = Date.now() + CATALOGO_TTL_MS;
  return productos;
};

// ------------------------------------------------------------------- stock

/** Lee /api/stock en vivo. Lanza si falla o si viene vacio. */
export const leerStockVivo = async (): Promise<Map<string, number | string>> => {
  const data = await peticion<{ items?: Array<{ mpn: string; quantity: number | string }> }>('/api/stock');
  const mapa = new Map<string, number | string>();
  for (const item of data?.items || []) {
    const clave = normalizarMpn(item?.mpn);
    if (clave) mapa.set(clave, item.quantity);
  }
  if (mapa.size === 0) throw new CotizadorError('El endpoint /api/stock respondio sin items.');
  return mapa;
};

/**
 * Stock con respaldo (T0.3). Una lectura en vivo que funciona se guarda como
 * snapshot; si falla, se sirve el ultimo snapshot con su fecha y marcado como
 * NO verificado. Nunca tumba la consulta de precios.
 */
export const getStock = async (): Promise<LecturaStock> => {
  if (stockCache.datos && Date.now() < stockCache.expira) return stockCache.datos;

  let lectura: LecturaStock;
  try {
    const mapa = await leerStockVivo();
    const leidoEn = new Date().toISOString();
    await guardarSnapshot(mapa, leidoEn);
    lectura = { mapa, verificado: true, origen: 'vivo', leido_en: leidoEn, error: null };
  } catch (fallo) {
    // El stock sale de Google Sheets y puede fallar por su cuenta: no se tumba
    // la consulta de precios, pero el fallo SI se reporta.
    const error = fallo instanceof Error ? fallo.message : 'Error desconocido leyendo stock';
    const snapshot = await leerSnapshot();
    lectura = snapshot
      ? {
          mapa: new Map(Object.entries(snapshot.items)),
          verificado: false,
          origen: 'snapshot',
          leido_en: snapshot.leido_en,
          error
        }
      : { mapa: new Map(), verificado: false, origen: 'ninguno', leido_en: null, error };
  }

  stockCache.datos = lectura;
  stockCache.expira = Date.now() + (lectura.verificado ? STOCK_TTL_MS : STOCK_FALLO_TTL_MS);
  return lectura;
};

/** Diagnostico compacto para el JSON de las tools. */
export const diagnosticoStock = (lectura: LecturaStock) => ({
  origen: lectura.origen,
  verificado: lectura.verificado,
  leido_en: lectura.leido_en,
  entradas_cargadas: lectura.mapa.size,
  error: lectura.error,
  ultimo_fallo_login: getUltimoFalloLogin()
});

/** Compatibilidad: devuelve solo el producto cuando la busqueda es concluyente. */
export const buscarProducto = (catalogo: Producto[], sku: string): Producto | null =>
  buscarProductoTolerante(catalogo, sku).producto;

/**
 * Resuelve una lista de {sku, cantidad} contra el catalogo y el stock.
 * Los SKU que no existen se devuelven aparte, sin abortar la operacion.
 */
export const resolverItems = async (
  items: Array<{ sku: string; cantidad: number }>
): Promise<{
  lineas: LineaResuelta[];
  noResueltos: SkuNoResuelto[];
  total: number;
  lectura: LecturaStock;
}> => {
  // Secuencial a proposito: el catalogo trae el token y el stock lo reusa.
  const catalogo = await getCatalogo();
  const lectura = await getStock();

  // Se agrupa por producto_id y no por el texto pedido: un mismo producto puede
  // llegar dos veces, por SKU y por MPN, o repetido en la misma lista. Sin esto
  // la cotizacion guardada saldria con el renglon duplicado en el PDF.
  const porProducto = new Map<number, LineaResuelta>();
  const noResueltos: SkuNoResuelto[] = [];

  for (const item of items) {
    const { producto, tipo, candidatos } = buscarProductoTolerante(catalogo, item.sku);
    if (!producto) {
      // Con varios candidatos no se elige: se listan para que decida una persona.
      const motivo =
        candidatos.length > 0
          ? `Ambiguo, ${candidatos.length} coincidencias: ${candidatos
              .map((c) => `${c.sku} (${c.mpn})`)
              .join(', ')}`
          : 'No existe en el catalogo activo';
      noResueltos.push({ sku: item.sku, motivo });
      continue;
    }
    const cantidad = Math.max(1, Math.trunc(Number(item.cantidad) || 1));
    const id = Number(producto.id);
    const existente = porProducto.get(id);
    if (existente) {
      existente.cantidad += cantidad;
      existente.precio_total = Number((existente.precio_unitario * existente.cantidad).toFixed(2));
      continue;
    }
    const precioUnitario = Number(producto.precio_cliente) || 0;
    porProducto.set(id, {
      coincidencia: tipo || 'exacta',
      producto,
      cantidad,
      stock: unidadesDe(lectura, producto),
      precio_unitario: Number(precioUnitario.toFixed(2)),
      precio_total: Number((precioUnitario * cantidad).toFixed(2))
    });
  }

  const lineas = [...porProducto.values()];

  const total = Number(lineas.reduce((suma, l) => suma + l.precio_total, 0).toFixed(2));
  return { lineas, noResueltos, total, lectura };
};

// ------------------------------------------------------------ cotizaciones

export interface DatosCliente {
  nombre?: string;
  empresa?: string;
  email?: string;
  telefono?: string;
  cliente_final?: string;
  fecha_ejecucion?: string;
  fecha_implementacion?: string;
  vms?: string;
}

/**
 * Graba la cotizacion. Con una cuenta rol "client" el backend IGNORA cualquier
 * precio que mandemos y lo recalcula desde la tabla productos, por eso aca solo
 * se envian producto_id y cantidad.
 */
export const crearCotizacion = async (
  cliente: DatosCliente,
  lineas: LineaResuelta[]
): Promise<{ id: number; total: number }> => {
  const respuesta = await peticion<{ cotizacion?: { id: number; total: string | number } }>(
    '/api/cotizaciones',
    {
      method: 'POST',
      body: {
        cliente,
        items: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad }))
      }
    }
  );
  const cot = respuesta?.cotizacion;
  if (!cot?.id) throw new CotizadorError('El backend no devolvio el id de la cotizacion.');
  return { id: Number(cot.id), total: Number(cot.total) || 0 };
};

export interface CotizacionGuardada {
  id: number;
  cliente_nombre: string | null;
  cliente_empresa: string | null;
  cliente_email: string | null;
  cliente_telefono: string | null;
  total: string | number;
  created_at?: string;
  usuario_role?: string;
  items: Array<Record<string, unknown>>;
}

export const getCotizacion = (id: number) =>
  peticion<CotizacionGuardada>(`/api/cotizaciones/${encodeURIComponent(String(id))}`);

/**
 * Genera el PDF. Ojo: el backend NO expone /api/cotizaciones/:id/pdf. El
 * endpoint real es POST /api/cotizaciones/pdf y arma el PDF con el payload que
 * se le manda, sin leer la base. Por eso primero hay que traer la cotizacion.
 */
export const generarPdf = async (cotizacion: CotizacionGuardada): Promise<Buffer> =>
  peticion<Buffer>('/api/cotizaciones/pdf', {
    method: 'POST',
    binario: true,
    body: {
      cliente: {
        nombre: cotizacion.cliente_nombre,
        empresa: cotizacion.cliente_empresa,
        email: cotizacion.cliente_email,
        telefono: cotizacion.cliente_telefono
      },
      items: cotizacion.items,
      total: Number(cotizacion.total) || 0,
      created_at: cotizacion.created_at,
      usuario_role: cotizacion.usuario_role
    }
  });
