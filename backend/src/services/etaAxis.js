// Plazo de entrega de productos sin stock, desde la pestaña ETA del Excel maestro.
//
// Pestaña ETA: A = Part Number (MPN), B = descripcion,
//   C = Total Standard Lead Time, D = Total Current Lead Time, E = Leadtime Real
// (en semanas). LP_AXIS columna J calcula lo mismo con
//   =IFERROR((VLOOKUP(C2;ETA!$A$2:$E$1711;5;FALSE)+4)&" semanas tras OC";"")
// pero su rango termina en la fila 1711 y ETA ya es mas larga: los productos de
// mas abajo quedaban sin plazo. Aqui se lee la pestaña completa con la misma regla.

const ETA_COL_MPN = 0; // A
const ETA_COL_ESTANDAR = 2; // C
const ETA_COL_ACTUAL = 3; // D
const ETA_COL_REAL = 4; // E
const SEMANAS_ADICIONALES_DEFAULT = 4;

const clave = (valor) => String(valor ?? '').trim().toUpperCase();

const semanas = (valor) => {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(',', '.');
  if (texto === '' || texto === '-') return null;
  const n = Number(texto);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * MPN -> semanas de lead time. Usa "Leadtime Real" (E); si viene vacia, la
 * actual (D) y luego la estandar (C). rows incluye el encabezado en la fila 0.
 */
const construirMapaEta = (rows) => {
  const mapa = new Map();
  for (let i = 1; i < (rows || []).length; i += 1) {
    const row = rows[i] || [];
    const mpn = clave(row[ETA_COL_MPN]);
    if (!mpn) continue;
    const lead = semanas(row[ETA_COL_REAL]) ?? semanas(row[ETA_COL_ACTUAL]) ?? semanas(row[ETA_COL_ESTANDAR]);
    if (lead === null) continue;
    // Si el MPN se repite, se queda el plazo mas largo: no prometer de menos.
    mapa.set(mpn, Math.max(mapa.get(mpn) ?? 0, lead));
  }
  return mapa;
};

/** "N semanas tras OC" o '' si el MPN no esta en ETA. */
const textoEta = (mapa, mpn, semanasAdicionales = SEMANAS_ADICIONALES_DEFAULT) => {
  if (!mapa) return '';
  const lead = mapa.get(clave(mpn));
  if (lead === undefined) return '';
  const total = Math.round((lead + semanasAdicionales) * 10) / 10;
  return `${total} semanas tras OC`;
};

module.exports = { construirMapaEta, textoEta, SEMANAS_ADICIONALES_DEFAULT };
