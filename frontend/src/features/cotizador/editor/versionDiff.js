// "Qué cambió" entre dos versiones de una cotización. Función pura: recibe dos
// versiones con la forma de GET /api/cotizaciones/:id/versiones/:version
// ({ total, cotizacion, items }) y devuelve un resumen de diferencias.

const CAMPOS_CLIENTE = [
  ['cliente_nombre', 'Contacto'],
  ['cliente_empresa', 'Empresa'],
  ['cliente_telefono', 'Proyecto'],
  ['cliente_email', 'PID'],
  ['cliente_final', 'Cliente final'],
  ['fecha_ejecucion', 'Fecha de ejecución'],
  ['fecha_implementacion', 'Fecha de implementación'],
  ['vms', 'VMS']
];

const texto = (v) => String(v ?? '').trim();
const clave = (v) => texto(v).toLowerCase().replace(/\s+/g, ' ');
const numeroONull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const redondear = (n) => Math.round(n * 100) / 100;
const distintos = (a, b) => {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return Math.abs(a - b) > 0.004;
};
// Las fechas llegan como ISO completo o "YYYY-MM-DD": se comparan por día.
const valorCliente = (campo, v) => (campo.startsWith('fecha_') ? texto(v).slice(0, 10) : texto(v));

/** Nombre corto de una línea para mostrarla: SKU, MPN o descripción. */
export const etiquetaLinea = (item) => texto(item?.sku) || texto(item?.mpn) || texto(item?.descripcion) || 'Línea sin código';

const tieneProducto = (item) => item?.producto_id !== null && item?.producto_id !== undefined && item?.producto_id !== '';
const productosDistintos = (a, b) => tieneProducto(a) && tieneProducto(b) && String(a.producto_id) !== String(b.producto_id);

// Cada pasada empareja las líneas que quedan por un criterio. Primero por
// producto_id (cuando ambas lo traen); lo que sobra, por SKU, MPN y descripción.
const PASADAS = [
  (item) => (tieneProducto(item) ? `p:${item.producto_id}` : null),
  (item) => (texto(item?.sku) ? `s:${clave(item.sku)}` : null),
  (item) => (texto(item?.mpn) ? `m:${clave(item.mpn)}` : null),
  (item) => (texto(item?.descripcion) ? `d:${clave(item.descripcion)}` : null)
];

/**
 * Empareja las líneas de dos versiones. Las repetidas (mismo producto dos veces)
 * se emparejan en orden de aparición, así nunca se cruzan ni se pierden.
 */
export const emparejarLineas = (antes = [], despues = []) => {
  const libresA = antes.map((item, i) => ({ item, i }));
  const libresB = despues.map((item, i) => ({ item, i }));
  const pares = [];
  const usadosA = new Set();
  const usadosB = new Set();

  PASADAS.forEach((claveDe) => {
    const grupos = new Map();
    libresA.forEach((a) => {
      if (usadosA.has(a.i)) return;
      const k = claveDe(a.item);
      if (!k) return;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(a);
    });
    libresB.forEach((b) => {
      if (usadosB.has(b.i)) return;
      const k = claveDe(b.item);
      const cola = k ? grupos.get(k) : null;
      if (!cola || cola.length === 0) return;
      // Dos líneas con producto_id distinto son productos distintos aunque compartan código.
      const pos = cola.findIndex((a) => !productosDistintos(a.item, b.item));
      if (pos < 0) return;
      const [a] = cola.splice(pos, 1);
      usadosA.add(a.i);
      usadosB.add(b.i);
      pares.push({ antes: a.item, despues: b.item, orden: b.i });
    });
  });

  return {
    pares: pares.sort((x, y) => x.orden - y.orden).map(({ antes: a, despues: d }) => ({ antes: a, despues: d })),
    quitadas: libresA.filter((a) => !usadosA.has(a.i)).map((a) => a.item),
    agregadas: libresB.filter((b) => !usadosB.has(b.i)).map((b) => b.item)
  };
};

const resumenLinea = (item) => ({
  etiqueta: etiquetaLinea(item),
  descripcion: texto(item?.descripcion),
  cantidad: numeroONull(item?.cantidad) ?? 1,
  precio_unitario: numeroONull(item?.precio_unitario),
  precio_total: numeroONull(item?.precio_total)
});

const totalDe = (version) => {
  const directo = numeroONull(version?.total) ?? numeroONull(version?.cotizacion?.total);
  if (directo !== null) return directo;
  return redondear((version?.items || []).reduce((s, it) => s + (numeroONull(it?.precio_total) || 0), 0));
};

/**
 * Diferencias de `actual` respecto de `anterior`.
 * Con `conCosto: false` no compara costos (vistas sin permiso de costo).
 */
export function diffVersiones(anterior, actual, { conCosto = true } = {}) {
  const { pares, quitadas, agregadas } = emparejarLineas(anterior?.items || [], actual?.items || []);
  const cantidad = [];
  const precio = [];
  const costo = [];

  pares.forEach(({ antes, despues }) => {
    const etiqueta = etiquetaLinea(despues);
    const qA = numeroONull(antes?.cantidad) ?? 1;
    const qD = numeroONull(despues?.cantidad) ?? 1;
    if (qA !== qD) cantidad.push({ etiqueta, antes: qA, despues: qD });
    const pA = numeroONull(antes?.precio_unitario);
    const pD = numeroONull(despues?.precio_unitario);
    if (distintos(pA, pD)) precio.push({ etiqueta, antes: pA, despues: pD });
    if (conCosto) {
      const cA = numeroONull(antes?.costo_unitario);
      const cD = numeroONull(despues?.costo_unitario);
      if (distintos(cA, cD)) costo.push({ etiqueta, antes: cA, despues: cD });
    }
  });

  const cliente = [];
  const cliA = anterior?.cotizacion || {};
  const cliD = actual?.cotizacion || {};
  if (anterior?.cotizacion && actual?.cotizacion) {
    CAMPOS_CLIENTE.forEach(([campo, etiqueta]) => {
      const a = valorCliente(campo, cliA[campo]);
      const d = valorCliente(campo, cliD[campo]);
      if (a !== d) cliente.push({ campo, etiqueta, antes: a, despues: d });
    });
  }

  const totalAntes = totalDe(anterior);
  const totalDespues = totalDe(actual);
  const diferencia = redondear(totalDespues - totalAntes);

  const resultado = {
    agregadas: agregadas.map(resumenLinea),
    quitadas: quitadas.map(resumenLinea),
    cantidad,
    precio,
    costo,
    cliente,
    total: { antes: totalAntes, despues: totalDespues, diferencia }
  };
  resultado.sinCambios =
    resultado.agregadas.length === 0 &&
    resultado.quitadas.length === 0 &&
    cantidad.length === 0 &&
    precio.length === 0 &&
    costo.length === 0 &&
    cliente.length === 0 &&
    Math.abs(diferencia) < 0.005;
  return resultado;
}
