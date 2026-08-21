// Cliente HTTP contra el backend de CotizadorQ.
//
// Responsabilidades: login con la cuenta de servicio, cache del JWT, re-login
// ante 401, reintentos con backoff en 429/5xx, y cache en memoria del catalogo
// y del stock (que vienen completos, sin endpoint de busqueda).
//
// Regla dura: ni el password ni el token salen nunca en logs ni en errores.

import { randomUUID } from 'node:crypto';

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

export interface Producto {
  id: number;
  origen: string;
  marca: string;
  sku: string;
  mpn: string;
  descripcion: string;
  tiempo_entrega: string;
  precio_cliente: number;
}

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

let tokenCache: string | null = null;

const login = async (): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabecerasSesion() },
      body: JSON.stringify({ usuario: USER, password: PASS }),
      signal: controller.signal
    });
    if (!response.ok) {
      // Deliberadamente sin cuerpo ni credenciales en el mensaje.
      throw new CotizadorError(
        `Login contra CotizadorQ fallo (HTTP ${response.status}). Revisa COTIZADOR_USER y COTIZADOR_PASS.`,
        response.status
      );
    }
    const data = (await response.json()) as { token?: string };
    if (!data?.token) {
      throw new CotizadorError('El login no devolvio token.');
    }
    tokenCache = data.token;
    return data.token;
  } finally {
    clearTimeout(timer);
  }
};

const getToken = async (): Promise<string> => (tokenCache ? tokenCache : login());

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
        tokenCache = null;
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
const stockCache: Cache<Map<string, number | string>> = { datos: null, expira: 0 };

const normalizar = (valor: unknown) => String(valor ?? '').trim().toUpperCase();

export const getCatalogo = async (): Promise<Producto[]> => {
  if (catalogoCache.datos && Date.now() < catalogoCache.expira) return catalogoCache.datos;
  // No hay endpoint de busqueda: /api/productos devuelve el catalogo completo.
  const filas = await peticion<Producto[]>('/api/productos');
  const productos = Array.isArray(filas) ? filas : [];
  catalogoCache.datos = productos;
  catalogoCache.expira = Date.now() + CATALOGO_TTL_MS;
  return productos;
};

export const getStock = async (): Promise<Map<string, number | string>> => {
  if (stockCache.datos && Date.now() < stockCache.expira) return stockCache.datos;
  const mapa = new Map<string, number | string>();
  try {
    const data = await peticion<{ items?: Array<{ mpn: string; quantity: number | string }> }>(
      '/api/stock'
    );
    for (const item of data?.items || []) {
      const clave = normalizar(item?.mpn);
      if (clave) mapa.set(clave, item.quantity);
    }
  } catch {
    // El stock sale de Google Sheets y puede fallar por su cuenta. No es motivo
    // para tumbar una consulta de precios: se devuelve vacio y las lineas
    // quedan con stock null.
  }
  stockCache.datos = mapa;
  stockCache.expira = Date.now() + STOCK_TTL_MS;
  return mapa;
};

/**
 * Clave de comparacion: solo letras y numeros, en mayuscula. Asi "rail b02",
 * "RAIL-B02" y "Rail_B02" colapsan al mismo valor RAILB02.
 */
const clavear = (valor: unknown) =>
  String(valor ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

export type TipoCoincidencia = 'exacta' | 'parcial' | 'descripcion';

export interface ResultadoBusqueda {
  producto: Producto | null;
  tipo: TipoCoincidencia | null;
  /** Se llena cuando hay mas de un candidato: no se elige por el usuario. */
  candidatos: Producto[];
}

const MAX_CANDIDATOS = 10;

/**
 * Busqueda tolerante en tres niveles. Deliberadamente NO usa distancia de
 * edicion sobre los codigos: dos productos reales pueden diferir en un solo
 * caracter (RAIL-B02 / RAIL-B03) y elegir "el mas parecido" pondria el
 * articulo equivocado en una cotizacion real. Ante ambiguedad se devuelven los
 * candidatos para que decida una persona.
 */
export const buscarProductoTolerante = (
  catalogo: Producto[],
  texto: string
): ResultadoBusqueda => {
  const vacio: ResultadoBusqueda = { producto: null, tipo: null, candidatos: [] };
  const clave = clavear(texto);
  if (!clave) return vacio;

  // Nivel 1: coincidencia exacta ignorando guiones, espacios y mayusculas.
  const exacta =
    catalogo.find((p) => clavear(p.sku) === clave) ||
    catalogo.find((p) => clavear(p.mpn) === clave);
  if (exacta) return { producto: exacta, tipo: 'exacta', candidatos: [] };

  // Nivel 2: el codigo contiene lo escrito (sirve para codigos incompletos).
  const parciales = catalogo.filter(
    (p) => clavear(p.sku).includes(clave) || clavear(p.mpn).includes(clave)
  );
  if (parciales.length === 1) return { producto: parciales[0], tipo: 'parcial', candidatos: [] };
  if (parciales.length > 1) {
    return { producto: null, tipo: null, candidatos: parciales.slice(0, MAX_CANDIDATOS) };
  }

  // Nivel 3: todas las palabras aparecen en algun campo del producto.
  const palabras = String(texto || '')
    .toLowerCase()
    .split(/\s+/)
    .map((palabra) => palabra.trim())
    .filter((palabra) => palabra.length > 1);
  if (palabras.length === 0) return vacio;

  const porDescripcion = catalogo.filter((p) => {
    const campos = `${p.sku} ${p.mpn} ${p.marca} ${p.descripcion}`.toLowerCase();
    return palabras.every((palabra) => campos.includes(palabra));
  });
  if (porDescripcion.length === 1) {
    return { producto: porDescripcion[0], tipo: 'descripcion', candidatos: [] };
  }
  return { producto: null, tipo: null, candidatos: porDescripcion.slice(0, MAX_CANDIDATOS) };
};

/** Compatibilidad: devuelve solo el producto cuando la busqueda es concluyente. */
export const buscarProducto = (catalogo: Producto[], sku: string): Producto | null =>
  buscarProductoTolerante(catalogo, sku).producto;

/**
 * Resuelve una lista de {sku, cantidad} contra el catalogo y el stock.
 * Los SKU que no existen se devuelven aparte, sin abortar la operacion.
 */
export const resolverItems = async (
  items: Array<{ sku: string; cantidad: number }>
): Promise<{ lineas: LineaResuelta[]; noResueltos: SkuNoResuelto[]; total: number }> => {
  const [catalogo, stock] = await Promise.all([getCatalogo(), getStock()]);

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
      stock: stock.get(normalizar(producto.mpn)) ?? null,
      precio_unitario: Number(precioUnitario.toFixed(2)),
      precio_total: Number((precioUnitario * cantidad).toFixed(2))
    });
  }

  const lineas = [...porProducto.values()];

  const total = Number(lineas.reduce((suma, l) => suma + l.precio_total, 0).toFixed(2));
  return { lineas, noResueltos, total };
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
