/**
 * Repositorio del OOR en memoria para tests: misma interfaz que src/oor/repositorio.js.
 * Respeta lo que importa del SQL: ids crecientes, snapshots referenciados por revisiones
 * (no se borran), limpieza por cantidad y las BO filtradas como en SQL (no eliminadas, no facturadas,
 * con po_axis). El SQL en si se prueba en oor.postgres.test.js (con CRM_TEST_DATABASE_URL).
 */
const clonar = (valor) => structuredClone(valor);

const crearOorMemoria = ({ bos = [] } = {}) => {
  const estado = { snapshots: [], revisiones: [], seqSnapshot: 0, seqRevision: 0, bos: [...bos] };
  const llamadas = [];
  const pool = { query: jest.fn(async () => ({ rows: [] })) };

  const repo = {
    async ultimoSnapshot() {
      llamadas.push('ultimoSnapshot');
      const s = estado.snapshots[estado.snapshots.length - 1];
      return s ? clonar(s) : null;
    },
    async snapshotPorId(_db, id) {
      const s = estado.snapshots.find((x) => x.id === Number(id));
      return s ? clonar(s) : null;
    },
    async insertarSnapshot(_db, { tomadoEn, huella, total, lineas, avisos }) {
      llamadas.push('insertarSnapshot');
      estado.seqSnapshot += 1;
      const fila = { id: estado.seqSnapshot, tomado_en: tomadoEn, huella, total, lineas: clonar(lineas), avisos: clonar(avisos || []) };
      estado.snapshots.push(fila);
      return { id: fila.id, tomado_en: fila.tomado_en, huella, total };
    },
    async ultimaRevision() {
      const r = estado.revisiones[estado.revisiones.length - 1];
      return r ? clonar(r) : null;
    },
    async revisionPorId(_db, id) {
      const r = estado.revisiones.find((x) => x.id === Number(id));
      return r ? clonar(r) : null;
    },
    async insertarRevision(_db, { desdeId, hastaId, usuarioId, vistoEn, automatica, resumen }) {
      llamadas.push('insertarRevision');
      estado.seqRevision += 1;
      const fila = {
        id: estado.seqRevision,
        desde_snapshot_id: desdeId ?? null,
        hasta_snapshot_id: hastaId,
        usuario_id: usuarioId ?? null,
        visto_en: vistoEn,
        automatica: Boolean(automatica),
        resumen: resumen ? clonar(resumen) : null
      };
      estado.revisiones.push(fila);
      return clonar(fila);
    },
    async listarRevisiones(_db, { limite }) {
      const tomado = (id) => estado.snapshots.find((s) => s.id === id)?.tomado_en ?? null;
      return estado.revisiones
        .filter((r) => !r.automatica)
        .slice()
        .reverse()
        .slice(0, limite)
        .map((r) => ({
          id: r.id,
          visto_en: r.visto_en,
          desde_snapshot_id: r.desde_snapshot_id,
          hasta_snapshot_id: r.hasta_snapshot_id,
          resumen: clonar(r.resumen),
          desde_tomado_en: r.desde_snapshot_id ? tomado(r.desde_snapshot_id) : null,
          hasta_tomado_en: tomado(r.hasta_snapshot_id)
        }));
    },
    async limpiar(_db, { maxSnapshots, maxRevisiones }) {
      llamadas.push('limpiar');
      estado.revisiones = estado.revisiones.slice(-maxRevisiones);
      const protegidos = new Set(estado.snapshots.slice(-maxSnapshots).map((s) => s.id));
      for (const r of estado.revisiones) {
        if (r.desde_snapshot_id) protegidos.add(r.desde_snapshot_id);
        protegidos.add(r.hasta_snapshot_id);
      }
      estado.snapshots = estado.snapshots.filter((s) => protegidos.has(s.id));
    },
    // Mismo filtro y mismas columnas que el SQL real: filas de bo_meta no eliminadas, no facturadas y con po_axis.
    async listarBos() {
      return clonar(estado.bos)
        .filter((b) => !b.deleted && !b.invoiced && String(b.po_axis ?? '').trim() !== '')
        .map((b) => ({
          bo: b.bo,
          po_axis: b.po_axis,
          customer_name: b.customer_name ?? null,
          project_name: b.project_name ?? null,
          customer_po: b.customer_po ?? null,
          estimated_invoice_month: b.estimated_invoice_month ?? null,
          estimated_invoice_date: b.estimated_invoice_date ?? null,
          estimated_invoice_week: b.estimated_invoice_week ?? null
        }));
    }
  };

  return {
    repo,
    pool,
    estado,
    llamadas,
    /** Reemplaza la configuracion actual de las BO (filas de bo_meta; el repo filtra como el SQL). */
    ponerBos(lista) {
      estado.bos = clonar(lista);
    }
  };
};

module.exports = { crearOorMemoria };
