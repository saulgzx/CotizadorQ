// Modelos descontinuados (EOL). El catalogo de CotizadorQ no trae este dato,
// asi que se mantiene aca. Un EOL no se oculta: se rotula y baja dentro de su
// grupo en la busqueda. Se pueden sumar mas por la variable MCP_EOL_MPN sin
// redeploy de codigo.
//
// Claves en formato clavear(): solo letras y numeros, en mayuscula.

export const EOL_MPN: ReadonlySet<string> = new Set([
  'RAILS01' // RAIL-S01 · diagnostico 2026-09-14
]);
