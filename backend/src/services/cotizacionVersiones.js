// Versiones de una cotizacion (v1...vN): comparacion "sin cambios" del editor y la
// version vigente cuando aun no tiene fila en cotizacion_versiones.
//
// Cada edicion que cambia algo deja DOS filas aseguradas: la de la version anterior
// (ON CONFLICT DO NOTHING) y la de la version nueva, con el snapshot ya actualizado y la
// nota de esa edicion. Las cotizaciones nunca editadas (o editadas antes de este cambio)
// no tienen fila de su version vigente: se sintetiza desde la tabla cotizaciones.

const { normalizarLineaAdmin } = require('./cotizacionItems');

const CAMPOS_LINEA = [
  'producto_id',
  'marca',
  'sku',
  'mpn',
  'descripcion',
  'origen',
  'precio_disty',
  'rebate_partner',
  'rebate_proyecto',
  'partner_category',
  'costo_unitario',
  'cantidad',
  'precio_unitario',
  'tiempo_entrega'
];

const pad = (n) => String(n).padStart(2, '0');

/** Fecha comparable 'YYYY-MM-DD' (pg devuelve DATE como Date a medianoche local) o null. */
const fechaClave = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return `${valor.getFullYear()}-${pad(valor.getMonth() + 1)}-${pad(valor.getDate())}`;
  }
  return String(valor).trim().slice(0, 10) || null;
};

const textoClave = (valor) => (valor === null || valor === undefined ? '' : String(valor).trim());

/** Una linea en forma comparable (ya normalizada como la guarda el editor). */
const lineaClave = (linea) => {
  const n = normalizarLineaAdmin(linea);
  return CAMPOS_LINEA.map((campo) => {
    const v = n[campo];
    return typeof v === 'number' ? Number(v.toFixed(4)) : v ?? null;
  });
};

/**
 * true si lo que manda el editor no cambia nada de lo guardado: cabecera del cliente,
 * estado (si viene) y lineas en el mismo orden con cantidades, precios y costos
 * normalizados.
 *
 * - actual: fila de cotizaciones; itemsActuales: sus lineas ORDER BY id.
 * - cabecera: los valores que el UPDATE escribiria (cliente_nombre, ..., vms).
 * - lineas: las lineas nuevas ya normalizadas (normalizarLineaAdmin).
 * - estado: el estado enviado (o undefined/null si no vino).
 */
const sinCambios = ({ actual, itemsActuales, cabecera, lineas, estado }) => {
  for (const [columna, valor] of Object.entries(cabecera)) {
    const esFecha = columna.startsWith('fecha_');
    const antes = esFecha ? fechaClave(actual[columna]) : textoClave(actual[columna]);
    const despues = esFecha ? fechaClave(valor) : textoClave(valor);
    if (antes !== despues) return false;
  }
  if (estado) {
    const estadoActual = actual.estado === 'pendiente' || !actual.estado ? 'revision' : actual.estado;
    if (estado !== estadoActual) return false;
  }
  const previas = Array.isArray(itemsActuales) ? itemsActuales : [];
  if (previas.length !== lineas.length) return false;
  return previas.every(
    (item, i) => JSON.stringify(lineaClave(item)) === JSON.stringify(lineaClave(lineas[i]))
  );
};

/** Autor y fecha de la version vigente segun la tabla cotizaciones. */
const autoriaVigente = (cotizacion) => ({
  creado_por: cotizacion.updated_by || cotizacion.usuario || null,
  creado_en: cotizacion.updated_at || cotizacion.created_at || null
});

/**
 * Lista v1...vN que existan, DESC, con `vigente`. Si la vigente no tiene fila se
 * sintetiza desde la cotizacion. Las filas de versiones mayores que la vigente (datos
 * inconsistentes) se omiten.
 */
const listarVersiones = (filas, cotizacion) => {
  const vigente = Number(cotizacion.version) || 1;
  const salida = (Array.isArray(filas) ? filas : [])
    .filter((f) => Number(f.version) <= vigente)
    .map((f) => ({
      version: Number(f.version),
      total: f.total,
      nota: f.nota ?? null,
      creado_por: f.creado_por ?? null,
      creado_en: f.creado_en ?? null,
      vigente: Number(f.version) === vigente
    }));
  if (!salida.some((f) => f.vigente)) {
    salida.push({ version: vigente, total: cotizacion.total, nota: null, ...autoriaVigente(cotizacion), vigente: true });
  }
  return salida.sort((a, b) => b.version - a.version);
};

module.exports = { CAMPOS_LINEA, fechaClave, sinCambios, autoriaVigente, listarVersiones };
