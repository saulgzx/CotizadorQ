// Cuándo el catálogo y el stock que tiene la página en memoria dejan de ser confiables.
// La página ya no se vuelve a montar al cambiar de vista, así que no se recarga sola:
// se vuelve a pedir al entrar al Cotizador o a Stock y al volver a la pestaña, pero solo
// si la última carga exitosa es más vieja que esto. El stock manda en el negocio.
export const VIDA_UTIL_DATOS_MS = 2 * 60 * 1000;

// `ultimaCargaExitosa` es la marca de tiempo (ms) de la última carga que terminó bien,
// o null/undefined si nunca hubo una. Vencido = más viejo que la vida útil (estrictamente).
// Una marca en el futuro (reloj movido hacia atrás) o inválida se trata como vencida:
// recargar de más es barato, quedarse con datos viejos no.
export const estaVencido = (ultimaCargaExitosa, ahora = Date.now(), vidaUtilMs = VIDA_UTIL_DATOS_MS) => {
  if (typeof ultimaCargaExitosa !== 'number' || !Number.isFinite(ultimaCargaExitosa)) return true;
  const edad = ahora - ultimaCargaExitosa;
  if (edad < 0) return true;
  return edad > vidaUtilMs;
};

// ¿Dos mapas de stock (clave -> cantidad) dicen lo mismo? Si es así, la recarga en segundo
// plano conserva el objeto que ya está en pantalla y la página no se vuelve a renderizar.
export const mismoMapaDeStock = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const clavesA = Object.keys(a);
  if (clavesA.length !== Object.keys(b).length) return false;
  return clavesA.every(clave => Object.prototype.hasOwnProperty.call(b, clave) && a[clave] === b[clave]);
};
