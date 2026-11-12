/**
 * Repositorio del CRM en memoria para tests: misma interfaz que src/crm/repositorio.js,
 * con las mismas reglas de unicidad (nombre normalizado, email por empresa) y
 * transacciones de verdad (BEGIN/ROLLBACK/SAVEPOINT restauran una copia del estado).
 * Asi los tests ejercitan la logica real de enlace, migracion, reglas y rutas sin BD.
 * El SQL en si se prueba en crm.postgres.test.js (con CRM_TEST_DATABASE_URL).
 */
const real = require('../../src/crm/repositorio');
const { ETAPAS_ABIERTAS } = require('../../src/crm/normalizar');

const { AHORA } = real;

const errorPg = (code, message) => Object.assign(new Error(message), { code });
const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clonar = (valor) => structuredClone(valor);

const crearCrmMemoria = ({ ahora = () => new Date() } = {}) => {
  let estado = {
    seq: { empresa: 0, contacto: 0, oportunidad: 0, cotizacion: 0 },
    empresas: [],
    alias: {},
    contactos: [],
    oportunidades: [],
    cotizaciones: [],
    items: []
  };
  const fallas = new Map(); // nombre de funcion -> error a lanzar
  const llamadas = [];

  const valorFecha = (v) => (v === AHORA ? ahora() : v);
  const aplicar = (fila, campos, permitidos) => {
    for (const campo of permitidos) {
      if (Object.prototype.hasOwnProperty.call(campos, campo)) fila[campo] = valorFecha(campos[campo]);
    }
    fila.updated_at = ahora();
    return fila;
  };

  // --- transacciones: pila de copias del estado
  const pila = [];
  const sqlControl = (sql) => {
    const s = String(sql).trim().toUpperCase();
    if (s === 'BEGIN') pila.push(clonar(estado));
    else if (s === 'COMMIT') pila.pop();
    else if (s === 'ROLLBACK') {
      if (pila.length) estado = pila.pop();
    } else if (s.startsWith('SAVEPOINT')) pila.push(clonar(estado));
    else if (s.startsWith('ROLLBACK TO SAVEPOINT')) {
      if (pila.length) estado = clonar(pila[pila.length - 1]);
    } else if (s.startsWith('RELEASE SAVEPOINT')) pila.pop();
    else throw new Error(`SQL no soportado por crmMemoria: ${sql}`);
    return { rows: [] };
  };
  const cliente = { query: jest.fn(async (sql) => sqlControl(sql)), release: jest.fn() };
  const pool = { connect: jest.fn(async () => cliente), query: jest.fn(async (sql) => sqlControl(sql)) };

  const empresaPorId = (id) => estado.empresas.find((e) => e.id === Number(id)) || null;
  const contactoPorId = (id) => estado.contactos.find((c) => c.id === Number(id)) || null;
  const oportunidadPorId = (id) => estado.oportunidades.find((o) => o.id === Number(id)) || null;
  const cotizacionPorId = (id) => estado.cotizaciones.find((c) => c.id === Number(id)) || null;

  const montoDe = (o) => {
    if (o.monto_manual !== null && o.monto_manual !== undefined) return redondear(o.monto_manual);
    const vinculadas = estado.cotizaciones
      .filter((c) => c.oportunidad_id === o.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
    return vinculadas.length ? redondear(vinculadas[0].total) : 0;
  };
  const diasEntre = (desde) => Math.max(0, Math.floor((ahora() - new Date(desde)) / 86400000));
  const resumen = (o) => ({
    id: o.id,
    titulo: o.titulo,
    etapa: o.etapa,
    empresa_id: o.empresa_id,
    empresa_nombre: empresaPorId(o.empresa_id)?.nombre ?? null,
    contacto_id: o.contacto_id,
    contacto_nombre: contactoPorId(o.contacto_id)?.nombre ?? null,
    marca: o.marca,
    es_proyecto: o.es_proyecto,
    monto: montoDe(o),
    fecha_cierre_estimada: o.fecha_cierre_estimada,
    motivo_perdida: o.motivo_perdida,
    cotizaciones: estado.cotizaciones.filter((c) => c.oportunidad_id === o.id).length,
    dias_en_etapa: diasEntre(o.etapa_desde),
    cerrada_en: o.cerrada_en,
    created_at: o.created_at,
    updated_at: o.updated_at
  });
  const emailDuplicado = (empresaId, email, excluirId = null) =>
    !!email &&
    estado.contactos.some(
      (c) => c.empresa_id === empresaId && c.id !== excluirId && c.email && c.email.toLowerCase() === email.toLowerCase()
    );
  const colapsar = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();

  const repo = {
    AHORA,
    patronIlike: real.patronIlike,
    conTransaccion: real.conTransaccion,

    // empresas
    buscarEmpresaPorNormalizado: async (db, norm) => {
      const propia = estado.empresas.find((e) => e.nombre_normalizado === norm);
      if (propia) return clonar(propia);
      const alias = estado.alias[norm];
      return alias ? clonar(empresaPorId(alias)) : null;
    },
    insertarEmpresa: async (db, { nombre, nombre_normalizado, rut = null, sitio = null, notas = null }) => {
      if (estado.empresas.some((e) => e.nombre_normalizado === nombre_normalizado)) return null;
      estado.seq.empresa += 1;
      const fila = {
        id: estado.seq.empresa, nombre, nombre_normalizado, rut, sitio, notas, archivada: false,
        created_at: ahora(), updated_at: ahora()
      };
      estado.empresas.push(fila);
      return clonar(fila);
    },
    obtenerEmpresa: async (db, id) => clonar(empresaPorId(id)),
    actualizarEmpresa: async (db, id, campos) => {
      const fila = empresaPorId(id);
      if (!fila) return null;
      if (campos.nombre_normalizado && estado.empresas.some((e) => e.id !== fila.id && e.nombre_normalizado === campos.nombre_normalizado)) {
        throw errorPg('23505', 'duplicate key crm_empresas_nombre_normalizado_idx');
      }
      return clonar(aplicar(fila, campos, ['nombre', 'nombre_normalizado', 'rut', 'sitio', 'notas', 'archivada']));
    },
    borrarEmpresa: async (db, id) => {
      const empresaId = Number(id);
      if (estado.oportunidades.some((o) => o.empresa_id === empresaId)) {
        throw errorPg('23503', 'crm_oportunidades_empresa_id_fkey');
      }
      const contactosBorrados = new Set(estado.contactos.filter((c) => c.empresa_id === empresaId).map((c) => c.id));
      estado.contactos = estado.contactos.filter((c) => c.empresa_id !== empresaId);
      for (const c of estado.cotizaciones) {
        if (c.empresa_id === empresaId) c.empresa_id = null;
        if (contactosBorrados.has(c.contacto_id)) c.contacto_id = null;
      }
      for (const [norm, destino] of Object.entries(estado.alias)) if (destino === empresaId) delete estado.alias[norm];
      estado.empresas = estado.empresas.filter((e) => e.id !== empresaId);
    },
    agregarAlias: async (db, norm, empresaId) => {
      estado.alias[norm] = Number(empresaId);
    },
    quitarAlias: async (db, norm) => {
      delete estado.alias[norm];
    },
    moverAlias: async (db, origen, destino) => {
      for (const [norm, id] of Object.entries(estado.alias)) if (id === Number(origen)) estado.alias[norm] = Number(destino);
    },
    listarEmpresas: async (db, { q = '', qNormalizado = '', archivadas = false, limite = 50, offset = 0 } = {}) => {
      const texto = q.toLowerCase();
      const filtradas = estado.empresas.filter((e) => {
        if (!archivadas && e.archivada) return false;
        if (!texto) return true;
        const contactos = estado.contactos.filter((c) => c.empresa_id === e.id);
        return (
          e.nombre.toLowerCase().includes(texto) ||
          (e.rut || '').toLowerCase().includes(texto) ||
          (qNormalizado && e.nombre_normalizado.includes(qNormalizado)) ||
          contactos.some((c) => c.nombre.toLowerCase().includes(texto) || (c.email || '').includes(texto))
        );
      });
      const items = filtradas.map((e) => {
        const abiertas = estado.oportunidades.filter((o) => o.empresa_id === e.id && ETAPAS_ABIERTAS.includes(o.etapa));
        const fechas = estado.cotizaciones.filter((c) => c.empresa_id === e.id).map((c) => new Date(c.created_at));
        return {
          id: e.id,
          nombre: e.nombre,
          rut: e.rut,
          archivada: e.archivada,
          contactos: estado.contactos.filter((c) => c.empresa_id === e.id && !c.archivado).length,
          oportunidades_abiertas: abiertas.length,
          monto_abierto: redondear(abiertas.reduce((s, o) => s + montoDe(o), 0)),
          ultima_cotizacion_en: fechas.length ? new Date(Math.max(...fechas)) : null
        };
      });
      return { items: items.slice(offset, offset + limite), total: items.length };
    },
    listarEmpresasParaDuplicados: async () =>
      estado.empresas
        .filter((e) => !e.archivada)
        .sort((a, b) => a.nombre_normalizado.localeCompare(b.nombre_normalizado) || a.id - b.id)
        .map((e) => ({
          id: e.id,
          nombre: e.nombre,
          nombre_normalizado: e.nombre_normalizado,
          cotizaciones: estado.cotizaciones.filter((c) => c.empresa_id === e.id).length
        })),

    // contactos
    buscarContactoPorEmail: async (db, empresaId, email) =>
      clonar(
        estado.contactos.find((c) => c.empresa_id === Number(empresaId) && c.email && c.email.toLowerCase() === email.toLowerCase()) || null
      ),
    buscarContactoPorNombre: async (db, empresaId, nombre) => {
      const candidatos = estado.contactos
        .filter((c) => c.empresa_id === Number(empresaId) && colapsar(c.nombre) === colapsar(nombre))
        .sort((a, b) => (a.email ? 1 : 0) - (b.email ? 1 : 0) || a.id - b.id);
      return clonar(candidatos[0] || null);
    },
    insertarContacto: async (db, { empresa_id, nombre, email = null, telefono = null, cargo = null, notas = null }) => {
      if (!empresaPorId(empresa_id)) throw errorPg('23503', 'crm_contactos_empresa_id_fkey');
      if (emailDuplicado(Number(empresa_id), email)) return null;
      estado.seq.contacto += 1;
      const fila = {
        id: estado.seq.contacto, empresa_id: Number(empresa_id), nombre, email, telefono, cargo, notas,
        archivado: false, created_at: ahora(), updated_at: ahora()
      };
      estado.contactos.push(fila);
      return clonar(fila);
    },
    obtenerContacto: async (db, id) => clonar(contactoPorId(id)),
    actualizarContacto: async (db, id, campos) => {
      const fila = contactoPorId(id);
      if (!fila) return null;
      if (campos.email && emailDuplicado(fila.empresa_id, campos.email, fila.id)) {
        throw errorPg('23505', 'duplicate key crm_contactos_empresa_email_idx');
      }
      return clonar(aplicar(fila, campos, ['nombre', 'email', 'telefono', 'cargo', 'notas', 'archivado']));
    },
    listarContactosDeEmpresa: async (db, empresaId) =>
      clonar(
        estado.contactos
          .filter((c) => c.empresa_id === Number(empresaId))
          .sort((a, b) => Number(a.archivado) - Number(b.archivado) || a.nombre.localeCompare(b.nombre) || a.id - b.id)
      ),
    reemplazarContacto: async (db, origenId, destinoId) => {
      for (const c of estado.cotizaciones) if (c.contacto_id === origenId) c.contacto_id = destinoId;
      for (const o of estado.oportunidades) if (o.contacto_id === origenId) o.contacto_id = destinoId;
      estado.contactos = estado.contactos.filter((c) => c.id !== origenId);
    },
    moverContactos: async (db, origen, destino) => {
      const mover = estado.contactos.filter((c) => c.empresa_id === Number(origen));
      for (const c of mover) {
        if (emailDuplicado(Number(destino), c.email, c.id)) throw errorPg('23505', 'duplicate key crm_contactos_empresa_email_idx');
        c.empresa_id = Number(destino);
      }
      return mover.length;
    },

    // oportunidades
    insertarOportunidad: async (db, datos) => {
      if (!empresaPorId(datos.empresa_id)) throw errorPg('23503', 'crm_oportunidades_empresa_id_fkey');
      estado.seq.oportunidad += 1;
      const fila = {
        id: estado.seq.oportunidad,
        empresa_id: Number(datos.empresa_id),
        contacto_id: datos.contacto_id ?? null,
        titulo: datos.titulo,
        etapa: datos.etapa || 'nueva',
        marca: datos.marca ?? null,
        es_proyecto: datos.es_proyecto ?? false,
        monto_manual: datos.monto_manual ?? null,
        fecha_cierre_estimada: datos.fecha_cierre_estimada ?? null,
        motivo_perdida: datos.motivo_perdida ?? null,
        etapa_desde: valorFecha(datos.etapa_desde) || ahora(),
        cerrada_en: valorFecha(datos.cerrada_en) ?? null,
        created_at: datos.created_at || ahora(),
        updated_at: ahora()
      };
      estado.oportunidades.push(fila);
      return clonar(fila);
    },
    obtenerOportunidad: async (db, id) => clonar(oportunidadPorId(id)),
    actualizarOportunidad: async (db, id, campos) => {
      const fila = oportunidadPorId(id);
      if (!fila) return null;
      return clonar(aplicar(fila, campos, [
        'titulo', 'etapa', 'contacto_id', 'marca', 'es_proyecto', 'monto_manual', 'fecha_cierre_estimada',
        'motivo_perdida', 'etapa_desde', 'cerrada_en'
      ]));
    },
    obtenerResumenOportunidad: async (db, id) => {
      const fila = oportunidadPorId(id);
      return fila ? resumen(fila) : null;
    },
    listarOportunidades: async (db, { etapa, empresa_id, q, abiertas, limite = 500, offset = 0 } = {}) => {
      const texto = (q || '').toLowerCase();
      return estado.oportunidades
        .filter((o) => !etapa || o.etapa === etapa)
        .filter((o) => !empresa_id || o.empresa_id === Number(empresa_id))
        .filter((o) => !abiertas || ETAPAS_ABIERTAS.includes(o.etapa))
        .map(resumen)
        .filter((o) => !texto || [o.titulo, o.empresa_nombre, o.contacto_nombre].some((t) => (t || '').toLowerCase().includes(texto)))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at) || b.id - a.id)
        .slice(offset, offset + limite);
    },
    totalesEmbudo: async () => {
      const filas = [];
      const porEtapa = new Map();
      const inicioMes = new Date(ahora().getFullYear(), ahora().getMonth(), 1);
      const delMes = new Map();
      for (const o of estado.oportunidades) {
        const acc = porEtapa.get(o.etapa) || { cantidad: 0, monto: 0 };
        acc.cantidad += 1;
        acc.monto += montoDe(o);
        porEtapa.set(o.etapa, acc);
        if (['ganada', 'perdida'].includes(o.etapa) && o.cerrada_en && new Date(o.cerrada_en) >= inicioMes) {
          const m = delMes.get(o.etapa) || { cantidad: 0, monto: 0 };
          m.cantidad += 1;
          m.monto += montoDe(o);
          delMes.set(o.etapa, m);
        }
      }
      for (const [clave, v] of porEtapa) filas.push({ tipo: 'etapa', clave, ...v });
      for (const [clave, v] of delMes) filas.push({ tipo: 'mes', clave, ...v });
      return filas;
    },
    moverOportunidades: async (db, origen, destino) => {
      const mover = estado.oportunidades.filter((o) => o.empresa_id === Number(origen));
      for (const o of mover) o.empresa_id = Number(destino);
      return mover.length;
    },
    cerrarOportunidadAbierta: async (db, id, etapa, motivo = null) => {
      const fila = oportunidadPorId(id);
      if (!fila || !ETAPAS_ABIERTAS.includes(fila.etapa)) return null;
      Object.assign(fila, { etapa, motivo_perdida: motivo, etapa_desde: ahora(), cerrada_en: ahora(), updated_at: ahora() });
      return { id: fila.id, etapa };
    },

    // cotizaciones
    bloquearCotizacionSinEnlace: async (db, id) => {
      const c = cotizacionPorId(id);
      return c && c.empresa_id === null && c.oportunidad_id === null ? clonar(c) : null;
    },
    obtenerCotizacion: async (db, id) => clonar(cotizacionPorId(id)),
    loteCotizacionesSinEnlace: async (db, { desdeId = 0, limite = 200 } = {}) =>
      estado.cotizaciones
        .filter((c) => c.empresa_id === null && c.oportunidad_id === null && c.id > desdeId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limite)
        .map((c) => ({
          ...clonar(c),
          origenes: [...new Set(estado.items.filter((i) => i.cotizacion_id === c.id && i.origen).map((i) => i.origen.toUpperCase()))]
        })),
    vincularCotizacion: async (db, id, { empresa_id, contacto_id, oportunidad_id }) => {
      const c = cotizacionPorId(id);
      if (!c) return null;
      Object.assign(c, { empresa_id, contacto_id, oportunidad_id });
      return { id: c.id, empresa_id, contacto_id, oportunidad_id };
    },
    moverCotizaciones: async (db, origen, destino) => {
      const mover = estado.cotizaciones.filter((c) => c.empresa_id === Number(origen));
      for (const c of mover) c.empresa_id = Number(destino);
      return mover.length;
    },
    listarCotizacionesDeEmpresa: async (db, empresaId) =>
      estado.cotizaciones
        .filter((c) => c.empresa_id === Number(empresaId))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id)
        .map((c) => ({
          id: c.id, numero: c.numero, total: redondear(c.total), estado: c.estado, created_at: c.created_at,
          contacto_id: c.contacto_id, oportunidad_id: c.oportunidad_id
        })),
    resumenCotizacionesEmpresa: async (db, empresaId) => {
      const propias = estado.cotizaciones.filter((c) => c.empresa_id === Number(empresaId));
      return { cotizaciones: propias.length, monto_cotizado: redondear(propias.reduce((s, c) => s + Number(c.total || 0), 0)) };
    }
  };

  // Registro de llamadas y fallas inyectables, sin tocar la logica de arriba.
  for (const [nombre, fn] of Object.entries(repo)) {
    if (typeof fn !== 'function' || nombre === 'conTransaccion' || nombre === 'patronIlike') continue;
    repo[nombre] = async (...args) => {
      llamadas.push(nombre);
      if (fallas.has(nombre)) throw fallas.get(nombre);
      return fn(...args);
    };
  }

  /** Inserta una cotizacion "del cotizador" (sin enlazar) con sus origenes de linea. */
  const agregarCotizacion = ({
    cliente_empresa = null, cliente_nombre = null, cliente_email = null, cliente_telefono = null,
    estado: estadoCot = 'revision', total = 100, created_at = new Date('2026-03-10T12:00:00Z'), origenes = []
  } = {}) => {
    estado.seq.cotizacion += 1;
    const id = estado.seq.cotizacion;
    const fila = {
      id, numero: 65422 + id, cliente_empresa, cliente_nombre, cliente_email, cliente_telefono, total,
      estado: estadoCot, created_at, empresa_id: null, contacto_id: null, oportunidad_id: null
    };
    estado.cotizaciones.push(fila);
    for (const origen of origenes) estado.items.push({ cotizacion_id: id, origen });
    return clonar(fila);
  };

  return {
    repo,
    pool,
    cliente,
    llamadas,
    agregarCotizacion,
    fallarEn: (nombre, error = new Error(`fallo simulado en ${nombre}`)) => fallas.set(nombre, error),
    sinFallas: () => fallas.clear(),
    get estado() {
      return estado;
    }
  };
};

module.exports = { crearCrmMemoria };
