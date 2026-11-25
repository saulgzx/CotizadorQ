/**
 * OOR: logica de versiones y revisiones. Usa comparar.js (puro) para leer, comparar y cruzar
 * con las BO; este modulo decide CUANDO guardar una version, CUANDO anunciar un cambio y como
 * se avanza la base contra la que se compara. El repositorio es inyectable (como en el CRM).
 *
 * - registrarLectura: guarda una version nueva del OOR solo si cambio y no esta vacia.
 * - pendiente: lo que hay que mostrar al dueno (base = ultima revision, vigente = ultima version).
 * - marcarVisto: el dueno da por revisado lo mostrado; la base avanza.
 * - historial / detalle: revisiones pasadas.
 */
const defecto = require('./repositorio');
const { leerOor, comparar, cruzarConBo, huella, parsearFecha, mesDe } = require('./comparar');

/** Una version debe llevar tanto tiempo sin cambiar para anunciar sus cambios. */
const SEGUNDOS_ESTABILIDAD = 90;
const ESPERA_MINIMA_SEG = 15;
const SNAPSHOTS_RECIENTES = 10;
const MAX_REVISIONES = 60;

const conEstado = (status, mensaje) => Object.assign(new Error(mensaje), { status });

/** `ahora` puede ser un Date, un numero, una funcion que lo devuelve o nada (reloj real). */
const instante = (ahora) => {
  const valor = typeof ahora === 'function' ? ahora() : ahora;
  if (valor === undefined || valor === null) return new Date();
  return valor instanceof Date ? valor : new Date(valor);
};

const iso = (valor) => {
  if (valor === null || valor === undefined) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
};

const refSnapshot = (s) => ({ id: s.id, tomado_en: iso(s.tomado_en) });

// Las operaciones que leen y luego escriben (registrar, anunciar, marcar) se turnan dentro
// del proceso: sin esto, dos lecturas simultaneas de la planilla podrian guardar la misma
// version dos veces, o un doble clic crear dos revisiones.
let cola = Promise.resolve();
const enTurno = (fn) => {
  const siguiente = cola.then(fn, fn);
  cola = siguiente.catch(() => {});
  return siguiente;
};

/**
 * Mes de facturacion configurado como 'YYYY-MM': el mes guardado y, si esta vacio, el de la
 * fecha estimada de facturacion (misma regla que normalizarMesFacturacion en el frontend).
 */
const mesFacturacion = (fila) => {
  const aMes = (valor) => {
    if (valor === null || valor === undefined || valor === '') return '';
    if (valor instanceof Date) {
      return Number.isNaN(valor.getTime())
        ? ''
        : `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, '0')}`;
    }
    const texto = String(valor).trim();
    if (/^\d{4}-\d{2}$/.test(texto)) return texto;
    const fecha = parsearFecha(texto);
    return fecha ? mesDe(fecha) : '';
  };
  return aMes(fila.estimated_invoice_month) || aMes(fila.estimated_invoice_date);
};

/** Filas de bo_meta -> lo que espera cruzarConBo (mes siempre 'YYYY-MM' o vacio). */
const prepararBos = (filas) =>
  (Array.isArray(filas) ? filas : [])
    .filter((fila) => fila && String(fila.po_axis ?? '').trim() !== '')
    .map((fila) => ({ ...fila, estimated_invoice_month: mesFacturacion(fila) }));

const bosDe = async (db, repo, bos) => prepararBos(bos === undefined ? await repo.listarBos(db) : bos);

const cruzar = ({ antes, ahora, bos }) =>
  cruzarConBo({ cambios: comparar(antes.lineas, ahora.lineas), antes: antes.lineas, ahora: ahora.lineas, bos });

/**
 * Guarda una lectura de la pestana OOR si es una version nueva.
 * - Sin lineas (la pestana puede estar vacia un instante mientras se reemplaza): no guarda nada.
 * - Misma huella que la ultima version: no guarda nada.
 * Devuelve la version vigente { id, tomado_en, huella, total, nuevo } o { motivo: 'sin_datos' }.
 */
const registrarLectura = (db, filas, { ahora, repo = defecto } = {}) =>
  enTurno(async () => {
    const { lineas, avisos } = leerOor(filas);
    if (lineas.length === 0) return { motivo: 'sin_datos' };
    const h = huella(lineas);
    const ultimo = await repo.ultimoSnapshot(db);
    if (ultimo && ultimo.huella === h) {
      return { id: ultimo.id, tomado_en: iso(ultimo.tomado_en), huella: ultimo.huella, total: ultimo.total, nuevo: false };
    }
    const guardado = await repo.insertarSnapshot(db, {
      tomadoEn: instante(ahora),
      huella: h,
      total: lineas.length,
      lineas,
      avisos
    });
    await repo.limpiar(db, { maxSnapshots: SNAPSHOTS_RECIENTES, maxRevisiones: MAX_REVISIONES });
    return { id: guardado.id, tomado_en: iso(guardado.tomado_en), huella: h, total: lineas.length, nuevo: true };
  });

const revisionAutomatica = (db, repo, { desde, hasta, ahora, resumen = null }) =>
  repo.insertarRevision(db, {
    desdeId: desde ? desde.id : null,
    hastaId: hasta.id,
    usuarioId: null,
    vistoEn: instante(ahora),
    automatica: true,
    resumen
  });

/**
 * Lo que hay que mostrar al dueno. Ver forma en docs/OOR.md. Con `sinEspera` no aplica la espera
 * de estabilidad (el dueno apreto "Actualizar OOR" cuando termino de pegar la pestana).
 */
const pendiente = (db, { ahora, bos, sinEspera = false, repo = defecto } = {}) =>
  enTurno(async () => {
    const vigente = await repo.ultimoSnapshot(db);
    if (!vigente) return { hay: false, motivo: 'sin_datos' };

    const ultima = await repo.ultimaRevision(db);
    if (!ultima) {
      // La primera vez no hay con que comparar: la version actual pasa a ser la base.
      await revisionAutomatica(db, repo, { desde: null, hasta: vigente, ahora });
      return { hay: false, motivo: 'primera_vez' };
    }

    const base = await repo.snapshotPorId(db, ultima.hasta_snapshot_id);
    if (!base || base.id === vigente.id || base.huella === vigente.huella) return { hay: false, motivo: 'sin_cambios' };

    // Estabilidad: el dueno pega la pestana nueva en uno o dos pasos; no se anuncia nada hasta
    // que la version lleve un rato sin cambiar.
    const edadMs = instante(ahora).getTime() - new Date(vigente.tomado_en).getTime();
    if (!sinEspera && edadMs < SEGUNDOS_ESTABILIDAD * 1000) {
      const falta = Math.ceil((SEGUNDOS_ESTABILIDAD * 1000 - edadMs) / 1000);
      return { hay: false, motivo: 'estabilizando', revisar_en_seg: Math.max(ESPERA_MINIMA_SEG, falta) };
    }

    const listaBos = await bosDe(db, repo, bos);
    const cruce = cruzar({ antes: base, ahora: vigente, bos: listaBos });
    if (cruce.resumen.cambios === 0) {
      // Solo se movieron lineas ya cerradas: nada que avisar, pero la base avanza.
      await revisionAutomatica(db, repo, { desde: base, hasta: vigente, ahora, resumen: cruce.resumen });
      return { hay: false, motivo: 'sin_cambios' };
    }
    return {
      hay: true,
      desde: refSnapshot(base),
      hasta: refSnapshot(vigente),
      resumen: cruce.resumen,
      grupos: cruce.grupos,
      sinBo: cruce.sinBo,
      avisos: vigente.avisos || []
    };
  });

/**
 * El dueno dio por revisado lo mostrado hasta `hastaId`. Idempotente: marcar dos veces lo mismo
 * devuelve la misma revision. Devuelve { revision_id }.
 */
const marcarVisto = (db, { hastaId, usuarioId, ahora, bos, repo = defecto } = {}) =>
  enTurno(async () => {
    const hasta = Number.isInteger(hastaId) ? await repo.snapshotPorId(db, hastaId) : null;
    if (!hasta) throw conEstado(400, 'La versión del OOR indicada no existe');
    const ultima = await repo.ultimaRevision(db);
    const base = ultima ? await repo.snapshotPorId(db, ultima.hasta_snapshot_id) : null;
    if (ultima && hasta.id < ultima.hasta_snapshot_id) {
      throw conEstado(400, 'La versión indicada es anterior a la que ya se revisó');
    }
    if (ultima && hasta.id === ultima.hasta_snapshot_id) return { revision_id: ultima.id };

    let resumen = null;
    if (base) {
      const listaBos = await bosDe(db, repo, bos);
      resumen = cruzar({ antes: base, ahora: hasta, bos: listaBos }).resumen;
    }
    const revision = await repo.insertarRevision(db, {
      desdeId: base ? base.id : null,
      hastaId: hasta.id,
      usuarioId: usuarioId ?? null,
      vistoEn: instante(ahora),
      automatica: false,
      resumen
    });
    return { revision_id: revision.id };
  });

/** Revisiones no automaticas, de la mas reciente a la mas antigua. */
const historial = async (db, { limite = 30, repo = defecto } = {}) => {
  const filas = await repo.listarRevisiones(db, { limite });
  return filas.map((r) => ({
    id: r.id,
    visto_en: iso(r.visto_en),
    desde: r.desde_snapshot_id ? { id: r.desde_snapshot_id, tomado_en: iso(r.desde_tomado_en) } : null,
    hasta: { id: r.hasta_snapshot_id, tomado_en: iso(r.hasta_tomado_en) },
    resumen: r.resumen || null
  }));
};

/** La misma forma que `pendiente` con hay: true, recalculada desde los dos snapshots de la revision. */
const detalle = async (db, revisionId, { bos, repo = defecto } = {}) => {
  const revision = await repo.revisionPorId(db, revisionId);
  if (!revision) throw conEstado(404, 'Revisión no encontrada');
  const desde = revision.desde_snapshot_id ? await repo.snapshotPorId(db, revision.desde_snapshot_id) : null;
  const hasta = await repo.snapshotPorId(db, revision.hasta_snapshot_id);
  if (!desde || !hasta) throw conEstado(404, 'Las versiones del OOR de esa revisión ya no están guardadas');
  const cruce = cruzar({ antes: desde, ahora: hasta, bos: await bosDe(db, repo, bos) });
  return {
    hay: true,
    visto_en: iso(revision.visto_en),
    desde: refSnapshot(desde),
    hasta: refSnapshot(hasta),
    resumen: cruce.resumen,
    grupos: cruce.grupos,
    sinBo: cruce.sinBo,
    avisos: hasta.avisos || []
  };
};

module.exports = {
  SEGUNDOS_ESTABILIDAD,
  SNAPSHOTS_RECIENTES,
  MAX_REVISIONES,
  mesFacturacion,
  prepararBos,
  registrarLectura,
  pendiente,
  marcarVisto,
  historial,
  detalle
};
