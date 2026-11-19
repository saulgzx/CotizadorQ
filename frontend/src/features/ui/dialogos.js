// ¿Hay un diálogo abierto? Los atajos de una letra ("/", "N", "E"…) no deben actuar encima de
// uno. El índice de secciones vive siempre en la página como role="dialog" con aria-hidden e
// inert cuando está cerrado: ese no cuenta, o los atajos quedarían apagados para siempre.
export const SELECTOR_DIALOGO_ABIERTO = '[role="dialog"]:not([aria-hidden="true"]):not([inert])';

export const hayDialogoAbierto = (raiz = document) => !!raiz.querySelector(SELECTOR_DIALOGO_ABIERTO);
