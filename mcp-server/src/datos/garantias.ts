// Garantia validada a mano en la herramienta de QNAP, una fila por modelo.
//
// Regla dura: un modelo que no esta aca responde "sin validar". No agregues
// filas por analogia con la familia o con un modelo vecino; ese fue el error
// de los 3 años puestos por parecido que cambiaban el cumplimiento de una
// licitacion. Si no lo validaste en la ficha, no va.
//
// modelo_base: MPN sin sufijo de region (-US, -EU...).

export interface Garantia {
  modelo_base: string;
  anios: number;
  url_ficha: string | null;
  /** Fecha (YYYY-MM-DD) en que se valido contra la herramienta de QNAP. */
  validado_en: string;
}

export const GARANTIAS: readonly Garantia[] = [
  { modelo_base: 'TS-873A-8G', anios: 3, url_ficha: null, validado_en: '2026-09-14' },
  { modelo_base: 'TS-h1277AXU-RP-R7-32G', anios: 5, url_ficha: null, validado_en: '2026-09-14' }
];
