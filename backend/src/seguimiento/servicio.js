// Orquestación del seguimiento: planificador (ciclo cada SEGUIMIENTO_CADA_MIN), aplicación
// de los resultados del agente, resúmenes por WhatsApp, valor y acciones del panel.
// La lógica de reglas está en motor.js (pura); aquí solo se lee, se decide con el motor y
// se persiste.

const motor = require('./motor');
const crmAdaptador = require('./crmAdaptador');
const { crearRepositorio } = require('./repositorio');
const { crearCola } = require('./cola');
const { GUIAS } = require('./instrucciones');
const { calcularValor } = require('./valor');
const resumenes = require('./resumenes');

const { ESTADOS } = motor;
const DIA_MS = 24 * 60 * 60 * 1000;
const VENTANA_REAPERTURA_MS = 30 * DIA_MS; // hilos cerrados "Sin respuesta" que se siguen mirando

const iso = (v) => (v ? new Date(v).toISOString() : null);
const claveMpn = (v) => String(v ?? '').trim().toUpperCase();

const crearServicioSeguimiento = ({
  db,
  calendario,
  config,
  whatsapp = null,
  leerStock = null, // async () => [{ mpn, sku, disponible }] (leerStockAgregado)
  pdfNombre = null, // (cotizacion) => nombre del PDF sin versión ni extensión (buildPdfBaseName)
  crm = crmAdaptador,
  repo = crearRepositorio(db),
  cola = null,
  ahora = () => Date.now(),
  logger = console
}) => {
  const cal = calendario;
  const colaTareas = cola || crearCola({ db, config: config.tareas, ahora, logger });
  let enCurso = false;
  let ultimoCiclo = null;
  let timer = null;

  const avisar = async (texto) => {
    if (!whatsapp?.habilitado?.()) return false;
    try {
      return !!(await whatsapp.avisar(texto));
    } catch (error) {
      logger.error?.({ event: 'seguimiento_aviso_error', msg: error?.message }, 'No se pudo avisar por WhatsApp');
      return false;
    }
  };

  /** Resumen por WhatsApp: con plantilla aprobada si hay WHATSAPP_PLANTILLA_RESUMEN. */
  const enviarResumen = async (texto) => {
    if (!whatsapp?.habilitado?.()) return false;
    try {
      if (config.plantilla?.nombre && whatsapp.avisarPlantilla) {
        return !!(await whatsapp.avisarPlantilla({
          nombre: config.plantilla.nombre,
          idioma: config.plantilla.idioma,
          parametros: [resumenes.unaLinea(texto)]
        }));
      }
      return !!(await whatsapp.avisar(texto));
    } catch (error) {
      logger.error?.({ event: 'seguimiento_resumen_error', msg: error?.message }, 'No se pudo enviar el resumen');
      return false;
    }
  };

  /** Persiste lo que devolvió el motor. Devuelve la fila nueva o null si no aplicó. */
  const aplicarTransicion = async (seg, r, t = new Date(ahora())) => {
    if (!r) return null;
    if (r.ignorado || !Object.keys(r.cambios || {}).length) {
      if (r.eventos?.length) await repo.registrarEventos(seg.oportunidad_id, r.eventos);
      return null;
    }
    const cambios = { ...r.cambios };
    if (!('proxima_accion' in cambios)) Object.assign(cambios, motor.proximaAccion({ ...seg, ...cambios }, t, cal));
    const fila = await repo.actualizar(seg.id, seg.estado, cambios);
    if (!fila) {
      logger.warn?.({ event: 'seguimiento_conflicto', oportunidad_id: seg.oportunidad_id }, 'El seguimiento cambió en paralelo; se omite');
      return null;
    }
    const eventos = [...(r.eventos || [])];
    if (r.etapa) {
      try {
        await crm.cambiarEtapa(db, seg.oportunidad_id, r.etapa.etapa, r.etapa.motivo);
      } catch (error) {
        logger.error?.({ event: 'seguimiento_crm_error', msg: error?.message }, 'No se pudo cambiar la etapa en el CRM');
        eventos.push({ tipo: 'crm_error', detalle: { etapa: r.etapa.etapa } });
      }
    }
    await repo.registrarEventos(seg.oportunidad_id, eventos);
    if (r.aviso) await avisar(r.aviso);
    return fila;
  };

  // --- Ítems de tareas ------------------------------------------------------------

  // El PDF se llama `<base>_v<N>.pdf` (N = versión de la cotización al exportarla). La
  // cotización puede editarse después de enviarla, así que no se sabe qué versión salió:
  // al agente va la base (cualquier `_vN` sirve) y, por compatibilidad, el nombre de la v1.
  const itemBuscar = (s) => {
    // Mismos datos que usa POST /api/cotizaciones/pdf: el proyecto se guarda en cliente_telefono.
    const base = pdfNombre
      ? pdfNombre({
          created_at: s.cotizacion_creada_en,
          proyecto: s.cliente_telefono || 'N/A',
          empresa: s.cliente_empresa || 'N/A',
          numero: s.numero
        })
      : null;
    return {
      cotizacion_id: Number(s.cotizacion_id),
      numero: s.numero ?? null,
      pdf_nombre: base ? `${base}_v1.pdf` : null,
      pdf_nombre_base: base,
      cliente_email: s.cliente_email || null,
      cliente_empresa: s.cliente_empresa || s.empresa_nombre || null,
      creada_en: iso(s.cotizacion_creada_en || s.created_at)
    };
  };

  const itemRevisar = (s) => ({
    oportunidad_id: Number(s.oportunidad_id),
    conversation_id: s.conversation_id,
    message_id: s.message_id,
    desde: iso(s.ultimo_envio_mio_en || s.enviado_en),
    ...(s.borrador_id ? { borrador_id: s.borrador_id } : {})
  });

  const mapaStock = async () => {
    if (!leerStock) return null;
    try {
      const filas = await leerStock();
      const mapa = new Map();
      for (const f of filas || []) {
        if (f.mpn) mapa.set(`MPN:${claveMpn(f.mpn)}`, Number(f.disponible) || 0);
        if (f.sku) mapa.set(`SKU:${claveMpn(f.sku)}`, Number(f.disponible) || 0);
      }
      return mapa;
    } catch (error) {
      logger.warn?.({ event: 'seguimiento_stock_no_disponible', msg: error?.message }, 'Borradores sin dato de stock');
      return null;
    }
  };

  const itemBorrador = async (s, paso, stock, t) => {
    const lineas = s.cotizacion_id ? await repo.lineasCotizacion(s.cotizacion_id) : [];
    const stockDe = (l) => {
      if (!stock) return null;
      const v = stock.get(`MPN:${claveMpn(l.mpn)}`) ?? stock.get(`SKU:${claveMpn(l.sku)}`);
      return v === undefined ? 0 : v;
    };
    return {
      oportunidad_id: Number(s.oportunidad_id),
      message_id: s.message_id,
      paso,
      para: [s.contacto_email || s.cliente_email].filter(Boolean),
      contexto: {
        contacto_nombre: s.contacto_nombre || s.cliente_nombre || null,
        empresa: s.empresa_nombre || s.cliente_empresa || null,
        numero: s.numero ?? null,
        monto: s.total ?? s.monto ?? null,
        moneda: 'USD',
        validez_vence_en: resumenes.venceEn(s, cal, config.validezDias),
        dias_desde_envio: s.enviado_en ? Math.floor((t.getTime() - new Date(s.enviado_en).getTime()) / DIA_MS) : null,
        productos: lineas.map((l) => ({
          descripcion: l.descripcion || l.mpn || l.sku || '',
          cantidad: Number(l.cantidad) || 1,
          stock: stockDe(l),
          entrega: l.entrega || null
        }))
      },
      guia: GUIAS[paso]
    };
  };

  // --- Planificador -----------------------------------------------------------------

  const slotActual = (t) => {
    if (!cal.esHabil(t)) return null;
    const min = cal.minutosChile(t);
    const pasados = config.horasRevision.filter((h) => h.hora * 60 + h.minuto <= min);
    return pasados.length ? `${cal.fechaChile(t)}T${pasados[pasados.length - 1].texto}` : null;
  };

  const encolarNuevos = async (tipo, items, clave) => {
    if (!items.length) return [];
    const enCursoIds = await colaTareas.idsEnCurso(tipo);
    const vistos = new Set();
    const nuevos = items.filter((it) => {
      const id = Number(it[clave]);
      if (enCursoIds.has(id) || vistos.has(id)) return false;
      vistos.add(id);
      return true;
    });
    return nuevos.length ? colaTareas.encolar(tipo, nuevos) : [];
  };

  const enviarResumenes = async (t) => {
    const out = {};
    if (!whatsapp?.habilitado?.()) return out;
    const fecha = cal.fechaChile(t);
    const min = cal.minutosChile(t);
    const { resumenDiario: rd, resumenSemanal: rs } = config;
    if (cal.esHabil(t) && min >= rd.hora * 60 + rd.minuto && (await repo.leerEstado('resumen_diario')) !== fecha) {
      const datos = await hoy(t);
      const vacio = !datos.borradores_listos.length && !datos.respuestas.length && !datos.borradores_sin_enviar.length &&
        !datos.vencen_esta_semana.length && !datos.sin_correo.length;
      if (vacio) {
        await repo.guardarEstado('resumen_diario', fecha); // nada que contar: no se manda
        out.diario = 'vacio';
      } else if (await enviarResumen(datos.texto)) {
        await repo.guardarEstado('resumen_diario', fecha);
        await repo.registrarEventos(null, [{ tipo: 'resumen_diario', detalle: { fecha } }]);
        out.diario = 'enviado';
      } else {
        out.diario = 'fallo'; // se reintenta en el próximo ciclo del mismo día
      }
    }
    if (cal.diaSemana(t) === 5 && min >= rs.hora * 60 + rs.minuto && (await repo.leerEstado('resumen_semanal')) !== fecha) {
      const datos = await semana(t);
      if (await enviarResumen(datos.texto)) {
        await repo.guardarEstado('resumen_semanal', fecha);
        await repo.registrarEventos(null, [{ tipo: 'resumen_semanal', detalle: { fecha } }]);
        out.semanal = 'enviado';
      } else {
        out.semanal = 'fallo';
      }
    }
    return out;
  };

  /** Un ciclo del planificador. Con SEGUIMIENTO_ACTIVO=false no hace nada. */
  const ciclo = async () => {
    if (!config.activo) return { activo: false };
    if (enCurso) return { activo: true, omitido: true };
    enCurso = true;
    const t = new Date(ahora());
    const informe = { activo: true, altas: 0, transiciones: 0, tareas: {}, resumenes: {} };
    try {
      if (!(await repo.leerEstado('activado_en'))) await repo.guardarEstado('activado_en', t.toISOString());

      // 1. Alta automática (solo cotizaciones de los últimos 30 días).
      const altas = await crm.altaAutomatica(db, { desde: new Date(t.getTime() - config.diasAlta * DIA_MS).toISOString() });
      for (const a of altas) {
        await repo.registrarEventos(a.oportunidad_id, [{ tipo: 'alta', detalle: { cotizacion_id: a.cotizacion_id } }]);
      }
      informe.altas = altas.length;

      // 2. Decidir con el motor.
      const segs = await crm.oportunidadesParaSeguimiento(db, {
        estados: [ESTADOS.BUSCANDO, ESTADOS.ESPERANDO, ESTADOS.BORRADOR, ESTADOS.CERRADA]
      });
      const buscar = [];
      const revisar = [];
      const urgentes = [];
      const borradores = [];
      for (const s of segs) {
        if (s.estado === ESTADOS.CERRADA) {
          const cerrada = new Date(s.cerrada_en || s.updated_at || 0).getTime();
          if (s.conversation_id && t.getTime() - cerrada <= VENTANA_REAPERTURA_MS) revisar.push(s);
          continue;
        }
        const sp = motor.siguientePaso(s, t, cal);
        if (sp.accion === 'detener') {
          if (await aplicarTransicion(s, motor.aplicarDetener(s), t)) informe.transiciones += 1;
        } else if (sp.accion === 'marcar_sin_envio') {
          if (await aplicarTransicion(s, motor.aplicarSinEnvio(s), t)) informe.transiciones += 1;
        } else if (sp.accion === 'buscar_envio') {
          if (s.cotizacion_id) buscar.push(s);
        } else if (sp.accion === 'esperar_envio_borrador') {
          revisar.push(s);
        } else if (['crear_borrador_1', 'crear_borrador_2', 'cerrar'].includes(sp.accion)) {
          revisar.push(s);
          if (!sp.vencida) {
            if (s.proxima_accion !== sp.accion || iso(s.proxima_accion_en) !== iso(sp.en)) {
              await repo.actualizar(s.id, s.estado, { proxima_accion: sp.accion, proxima_accion_en: iso(sp.en) });
            }
          } else if (sp.requiereRevision) {
            urgentes.push(s);
          } else if (sp.accion === 'cerrar') {
            if (await aplicarTransicion(s, motor.aplicarCierre(s, t), t)) informe.transiciones += 1;
          } else {
            borradores.push({ s, paso: sp.accion === 'crear_borrador_1' ? 1 : 2 });
          }
        }
      }

      // 3. Tareas para el agente.
      const slot = slotActual(t);
      const slotNuevo = !!slot && slot !== (await repo.leerEstado('ultimo_slot'));
      if (slotNuevo) {
        informe.tareas.buscar_envios = await encolarNuevos('buscar_envios', buscar.map(itemBuscar), 'cotizacion_id');
      }
      const aRevisar = (slotNuevo ? [...revisar, ...urgentes] : urgentes).filter((s) => s.conversation_id);
      informe.tareas.revisar_hilos = await encolarNuevos('revisar_hilos', aRevisar.map(itemRevisar), 'oportunidad_id');
      if (borradores.length) {
        const enCursoIds = await colaTareas.idsEnCurso('crear_borradores');
        const pendientes = borradores.filter(({ s }) => !enCursoIds.has(Number(s.oportunidad_id)));
        if (pendientes.length) {
          const stock = await mapaStock();
          const items = [];
          for (const { s, paso } of pendientes) items.push(await itemBorrador(s, paso, stock, t));
          informe.tareas.crear_borradores = await colaTareas.encolar('crear_borradores', items);
        }
      }
      if (slotNuevo) await repo.guardarEstado('ultimo_slot', slot);

      // 4. Resúmenes.
      informe.resumenes = await enviarResumenes(t);
      ultimoCiclo = { en: t.toISOString(), ok: true, ...informe };
      return informe;
    } catch (error) {
      ultimoCiclo = { en: t.toISOString(), ok: false, error: error?.message };
      throw error;
    } finally {
      enCurso = false;
    }
  };

  // --- Resultados del agente -------------------------------------------------------

  const aplicarResultados = async (tarea, pares) => {
    const t = new Date(ahora());
    const porCotizacion = tarea.tipo === 'buscar_envios';
    const ids = pares.map(({ resultado }) => Number(porCotizacion ? resultado.cotizacion_id : resultado.oportunidad_id));
    const segs = ids.length
      ? await crm.oportunidadesParaSeguimiento(db, porCotizacion ? { cotizacionIds: ids } : { oportunidadIds: ids })
      : [];
    const mapa = new Map(segs.map((s) => [Number(porCotizacion ? s.cotizacion_id : s.oportunidad_id), s]));
    for (const { resultado, pedido } of pares) {
      const seg = mapa.get(Number(porCotizacion ? resultado.cotizacion_id : resultado.oportunidad_id));
      if (!seg) continue;
      try {
        const r = motor.aplicarResultado(seg, tarea.tipo, resultado, t, cal, motor.CONFIG_MOTOR, pedido);
        await aplicarTransicion(seg, r, t);
      } catch (error) {
        logger.error?.({ event: 'seguimiento_aplicar_error', tarea: tarea.id, msg: error?.message }, 'No se pudo aplicar un resultado');
        await repo
          .registrarEventos(seg.oportunidad_id, [{ tipo: 'error_aplicar', detalle: { tarea: tarea.id, tipo: tarea.tipo } }])
          .catch(() => {});
      }
    }
  };

  /** Resultado del agente para una tarea: valida, aplica y responde el status HTTP. */
  const registrarResultado = (id, cuerpo) =>
    colaTareas.registrarResultado(id, cuerpo, async (tarea, pares) => {
      // Un borrador pedido que el agente no devolvió cuenta como fallido (evita reintentar
      // cada 15 minutos sin fin).
      if (tarea.tipo === 'crear_borradores') {
        const { rows } = await db.query('SELECT items FROM crm_seguimiento_tareas WHERE id = $1', [tarea.id]);
        const devueltos = new Set(pares.map((p) => Number(p.resultado.oportunidad_id)));
        for (const pedido of rows[0]?.items || []) {
          if (!devueltos.has(Number(pedido.oportunidad_id))) {
            pares.push({ resultado: { oportunidad_id: Number(pedido.oportunidad_id), creado: false }, pedido });
          }
        }
      }
      await aplicarResultados(tarea, pares);
    });

  // --- Consultas del panel ---------------------------------------------------------

  async function hoy(t = new Date(ahora())) {
    const segs = await crm.oportunidadesParaSeguimiento(db, {
      estados: [ESTADOS.BUSCANDO, ESTADOS.ESPERANDO, ESTADOS.BORRADOR, ESTADOS.RESPONDIDA, ESTADOS.SIN_ENVIO, ESTADOS.PAUSADA]
    });
    const datos = resumenes.datosHoy(segs, t, cal, { validezDias: config.validezDias });
    return { activo: config.activo, ...datos, texto: resumenes.textoDiario(datos) };
  }

  /**
   * Todas las oportunidades en seguimiento automático, con su próximo paso.
   * Solo devuelve lo que el panel muestra (sin ids de correo ni datos del hilo).
   */
  async function lista(t = new Date(ahora())) {
    const segs = await crm.oportunidadesParaSeguimiento(db);
    const items = segs.map((s) => {
      const sp = motor.siguientePaso(s, t, cal);
      return {
        oportunidad_id: s.oportunidad_id,
        cotizacion_id: s.cotizacion_id,
        numero: s.numero || null,
        titulo: s.titulo,
        empresa_nombre: s.empresa_nombre || s.cliente_empresa || null,
        contacto_nombre: s.contacto_nombre || s.cliente_nombre || null,
        monto: s.monto,
        etapa: s.etapa,
        estado: s.estado,
        paso: s.paso,
        enviado_en: iso(s.enviado_en),
        borrador_creado_en: iso(s.borrador_creado_en),
        respuesta_en: iso(s.respuesta_en),
        respuesta_resumen: s.respuesta_resumen || null,
        siguiente: sp.accion ? { accion: sp.accion, en: iso(sp.en), vencida: !!sp.vencida } : null,
        actualizado_en: iso(s.updated_at)
      };
    });
    return { activo: config.activo, total: items.length, items };
  }

  const valor = async (desde, hasta) => {
    const d = new Date(desde);
    const h = new Date(hasta);
    const [eventos, cerradas] = await Promise.all([
      repo.eventosEntre(d.toISOString(), h.toISOString()),
      crm.oportunidadesCerradasEntre(db, { desde: d.toISOString(), hasta: h.toISOString() })
    ]);
    const ganadas = cerradas.filter((o) => o.etapa === 'ganada');
    const respuestas = await repo.respuestasDe(ganadas.map((o) => Number(o.id)));
    const cotIds = ganadas.map((o) => o.cotizacion_id).filter(Boolean);
    const margenes = await repo.margenCotizaciones(cotIds);
    return calcularValor({ desde: d, hasta: h, eventos, cerradas, respuestas, margenes, minutos: config.minutos });
  };

  async function semana(t = new Date(ahora())) {
    const dow = cal.diaSemana(t);
    const lunes = cal.sumarDiasIso(cal.fechaChile(t), -((dow + 6) % 7));
    const desde = cal.instanteChile(lunes, 0, 0);
    const [v, cerradas, abiertas] = await Promise.all([
      valor(desde, t),
      crm.oportunidadesCerradasEntre(db, { desde: desde.toISOString(), hasta: t.toISOString() }),
      crm.abiertasMasGrandes(db, 5)
    ]);
    const datos = resumenes.datosSemana({ valor: v, cerradas, abiertas });
    return { ...datos, texto: resumenes.textoSemanal(datos) };
  }

  const cargar = async (oportunidadId) => {
    const id = Number.parseInt(oportunidadId, 10);
    if (!Number.isFinite(id)) return null;
    const [seg] = await crm.oportunidadesParaSeguimiento(db, { oportunidadIds: [id] });
    return seg || null;
  };

  const detalle = async (oportunidadId) => {
    const seg = await cargar(oportunidadId);
    if (!seg) return null;
    const t = new Date(ahora());
    const sp = motor.siguientePaso(seg, t, cal);
    return {
      seguimiento: seg,
      siguiente: { accion: sp.accion, en: iso(sp.en), vencida: !!sp.vencida, recordar: !!sp.recordar },
      eventos: await repo.eventosDe(seg.oportunidad_id)
    };
  };

  /** accion: 'pausar' | 'reanudar'. Devuelve { seguimiento } o { error, status }. */
  const cambiarPausa = async (oportunidadId, accion) => {
    const seg = await cargar(oportunidadId);
    if (!seg) return { status: 404, error: 'La oportunidad no está en seguimiento' };
    const t = new Date(ahora());
    const r = accion === 'pausar' ? motor.pausar(seg) : motor.reanudar(seg, t);
    if (!r) return { status: 409, error: `No se puede ${accion} un seguimiento en estado ${seg.estado}` };
    const fila = await aplicarTransicion(seg, { ...r, etapa: null, aviso: null, ignorado: null }, t);
    if (!fila) return { status: 409, error: 'El seguimiento cambió; vuelve a intentarlo' };
    return { seguimiento: fila };
  };

  const estado = async () => ({
    activo: config.activo,
    cada_min: config.cadaMin,
    activado_en: await repo.leerEstado('activado_en'),
    ultimo_ciclo: ultimoCiclo,
    ultimo_slot_revision: await repo.leerEstado('ultimo_slot'),
    resumen_diario: await repo.leerEstado('resumen_diario'),
    resumen_semanal: await repo.leerEstado('resumen_semanal'),
    whatsapp: !!whatsapp?.habilitado?.(),
    plantilla_resumen: !!config.plantilla?.nombre,
    tareas: await colaTareas.resumen()
  });

  /** Arranca el planificador. Nunca bloquea el arranque ni mantiene vivo el proceso. */
  const iniciar = ({ setIntervalImpl = setInterval, setTimeoutImpl = setTimeout, primerCicloMs = 30 * 1000 } = {}) => {
    if (timer) return timer;
    const correr = () =>
      ciclo().catch((error) =>
        logger.error?.({ event: 'seguimiento_ciclo_error', msg: error?.message }, 'Falló el ciclo de seguimiento')
      );
    timer = setIntervalImpl(correr, config.cadaMin * 60 * 1000);
    timer?.unref?.();
    const primero = setTimeoutImpl(correr, primerCicloMs);
    primero?.unref?.();
    logger.info?.({ event: 'seguimiento_planificador', activo: config.activo, cada_min: config.cadaMin }, 'Planificador de seguimiento listo');
    return timer;
  };

  const detener = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  return {
    ciclo,
    iniciar,
    detener,
    hoy,
    lista,
    semana,
    valor,
    detalle,
    pausar: (id) => cambiarPausa(id, 'pausar'),
    reanudar: (id) => cambiarPausa(id, 'reanudar'),
    estado,
    registrarResultado,
    aplicarResultados,
    cola: colaTareas,
    repo,
    inicializar: () => repo.crearEsquema(logger)
  };
};

module.exports = { crearServicioSeguimiento };
