// Motor de la cadencia de seguimiento. Funciones PURAS: reciben el seguimiento (fila de
// crm_seguimientos con la etapa de la oportunidad), la hora y el calendario hábil, y
// devuelven qué hacer. No tocan la base ni el reloj: el planificador y la cola aplican
// lo que devuelven.
//
// Reglas (contrato v1):
// - paso 0 (cotización enviada): 1er borrador a los 3 días hábiles del último envío del dueño.
// - paso 1 (1er seguimiento enviado): 2º borrador a los 7 días hábiles.
// - paso 2 (2º seguimiento enviado): a los 7 días hábiles se cierra como perdida "Sin respuesta".
// - Las acciones vencen a las 08:00 de Chile del día hábil que toca.
// - La cadencia solo avanza cuando el dueño ENVÍA el borrador; nunca hay dos borradores
//   para el mismo paso.
// - Una respuesta del cliente detiene todo y mueve la oportunidad a negociación (y reabre
//   una perdida por "Sin respuesta").

const ESTADOS = Object.freeze({
  BUSCANDO: 'buscando_envio',
  ESPERANDO: 'esperando',
  BORRADOR: 'borrador_listo',
  RESPONDIDA: 'respondida',
  CERRADA: 'cerrada_sin_respuesta',
  PAUSADA: 'pausada',
  SIN_ENVIO: 'sin_envio'
});
const ACTIVOS = [ESTADOS.BUSCANDO, ESTADOS.ESPERANDO, ESTADOS.BORRADOR];
const MOTIVO_SIN_RESPUESTA = 'Sin respuesta';
const ACCION_POR_PASO = ['crear_borrador_1', 'crear_borrador_2', 'cerrar'];

const CONFIG_MOTOR = Object.freeze({
  diasPorPaso: [3, 7, 7], // tras el envío original, tras el 1er y tras el 2º seguimiento
  diasSinEnvio: 10,
  diasRecordatorio: 2,
  horaAcciones: 8, // 08:00 Chile
  frescuraRevisionMs: 2 * 60 * 60 * 1000, // una revisión del hilo de hasta 2 h antes sirve
  esperaTrasFalloMs: 2 * 60 * 60 * 1000,
  maxFallosBorrador: 3,
  maxResumen: 400
});

const ms = (v) => (v === null || v === undefined ? null : new Date(v).getTime());
const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());

/** Saca correos, teléfonos, URLs y números largos; colapsa espacios y corta a 400. */
const limpiarResumen = (texto, max = CONFIG_MOTOR.maxResumen) => {
  if (!texto) return null;
  const limpio = String(texto)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]')
    .replace(/https?:\/\/\S+/gi, '[enlace]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[número]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpio) return null;
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio;
};

/** La oportunidad se cerró o pasó a negociación por fuera del seguimiento. */
const cerradaPorFuera = (seg) =>
  ACTIVOS.includes(seg.estado) &&
  ['ganada', 'perdida', 'negociacion'].includes(seg.etapa);

/** Instante (08:00 Chile) en que vence la acción del paso actual en estado esperando. */
const vencimientoPaso = (seg, cal, cfg = CONFIG_MOTOR) => {
  const paso = Number(seg.paso) || 0;
  const base = seg.ultimo_envio_mio_en || seg.enviado_en;
  if (!base || paso < 0 || paso > 2) return null;
  const dia = cal.sumarDiasHabilesIso(cal.fechaChile(base), cfg.diasPorPaso[paso]);
  return cal.instanteChile(dia, cfg.horaAcciones, 0);
};

/**
 * Próxima acción de un seguimiento.
 * Devuelve { accion, en, vencida, requiereRevision, recordar? } o { accion: null }.
 * accion: buscar_envio | marcar_sin_envio | crear_borrador_1 | crear_borrador_2 | cerrar |
 *         esperar_envio_borrador | detener | null
 */
const siguientePaso = (seg, ahora, cal, cfg = CONFIG_MOTOR) => {
  const t = ms(ahora);
  if (cerradaPorFuera(seg)) return { accion: 'detener', en: new Date(t), vencida: true, requiereRevision: false };

  switch (seg.estado) {
    case ESTADOS.BUSCANDO: {
      const desde = seg.busqueda_desde || seg.created_at || ahora;
      const limite = cal.sumarDiasHabiles(desde, cfg.diasSinEnvio);
      if (cal.diasHabilesEntre(desde, ahora) >= cfg.diasSinEnvio) {
        return { accion: 'marcar_sin_envio', en: limite, vencida: true, requiereRevision: false };
      }
      return { accion: 'buscar_envio', en: new Date(t), vencida: true, requiereRevision: false };
    }
    case ESTADOS.ESPERANDO: {
      const paso = Number(seg.paso) || 0;
      let en = vencimientoPaso(seg, cal, cfg);
      if (!en) return { accion: null };
      const accion = ACCION_POR_PASO[paso];
      if (accion !== 'cerrar' && seg.borrador_fallo_en) {
        const reintento = ms(seg.borrador_fallo_en) + cfg.esperaTrasFalloMs;
        if (reintento > en.getTime()) en = new Date(reintento);
      }
      const vencida =
        t >= en.getTime() && cal.esHabil(ahora) && cal.minutosChile(ahora) >= cfg.horaAcciones * 60;
      const revision = ms(seg.ultima_revision_en);
      const requiereRevision =
        vencida && (revision === null || revision < en.getTime() - cfg.frescuraRevisionMs);
      return { accion, en, vencida, requiereRevision };
    }
    case ESTADOS.BORRADOR: {
      const creado = seg.borrador_creado_en || ahora;
      const recordar = cal.diasHabilesEntre(creado, ahora) >= cfg.diasRecordatorio;
      return { accion: 'esperar_envio_borrador', en: null, vencida: false, requiereRevision: false, recordar };
    }
    default:
      return { accion: null };
  }
};

/** Columnas proxima_accion / proxima_accion_en coherentes con el estado. */
const proximaAccion = (seg, ahora, cal, cfg = CONFIG_MOTOR) => {
  const s = siguientePaso(seg, ahora, cal, cfg);
  if (['crear_borrador_1', 'crear_borrador_2', 'cerrar'].includes(s.accion)) {
    return { proxima_accion: s.accion, proxima_accion_en: iso(s.en) };
  }
  return { proxima_accion: null, proxima_accion_en: null };
};

const resultadoVacio = (motivo) => ({ cambios: {}, eventos: [], etapa: null, aviso: null, ignorado: motivo || null });

/** Cambio de etapa que pide una respuesta del cliente, o null. */
const etapaTrasRespuesta = (seg) => {
  if (['nueva', 'cotizada'].includes(seg.etapa)) return { etapa: 'negociacion', motivo: null, reabre: false };
  if (seg.etapa === 'perdida' && seg.motivo_perdida === MOTIVO_SIN_RESPUESTA) {
    return { etapa: 'negociacion', motivo: null, reabre: true };
  }
  return null;
};

const aplicarBuscarEnvio = (seg, item, ahora, cal, cfg) => {
  if (seg.estado !== ESTADOS.BUSCANDO) return resultadoVacio('estado');
  if (item.encontrado) {
    const enviado = iso(item.enviado_en);
    return {
      cambios: {
        estado: ESTADOS.ESPERANDO,
        paso: 0,
        message_id: item.message_id,
        conversation_id: item.conversation_id,
        enviado_en: enviado,
        ultimo_envio_mio_en: enviado
      },
      eventos: [{ tipo: 'envio_vinculado', detalle: { cotizacion_id: seg.cotizacion_id } }],
      etapa: null,
      aviso: null,
      ignorado: null
    };
  }
  const intentos = (Number(seg.intentos_busqueda) || 0) + 1;
  const desde = seg.busqueda_desde || seg.created_at || ahora;
  if (cal.diasHabilesEntre(desde, ahora) >= cfg.diasSinEnvio) {
    return {
      cambios: { estado: ESTADOS.SIN_ENVIO, intentos_busqueda: intentos },
      eventos: [{ tipo: 'sin_envio', detalle: { intentos } }],
      etapa: null,
      aviso: null,
      ignorado: null
    };
  }
  return { cambios: { intentos_busqueda: intentos }, eventos: [], etapa: null, aviso: null, ignorado: null };
};

const aplicarRevisarHilo = (seg, item, ahora) => {
  const revisables = [ESTADOS.ESPERANDO, ESTADOS.BORRADOR, ESTADOS.CERRADA];
  if (!revisables.includes(seg.estado)) return resultadoVacio('estado');
  const base = { ultima_revision_en: iso(ahora) };
  const eventos = [{ tipo: 'hilo_revisado', detalle: {} }];

  if (item.respuesta_recibida) {
    const etapa = etapaTrasRespuesta(seg);
    const resumen = limpiarResumen(item.resumen);
    eventos.push({
      tipo: 'respuesta',
      detalle: {
        paso: Number(seg.paso) || 0,
        remitente: item.remitente ? String(item.remitente).slice(0, 200) : null,
        reabierta: !!etapa?.reabre,
        borrador_sin_enviar: seg.estado === ESTADOS.BORRADOR
      }
    });
    if (etapa) eventos.push({ tipo: 'crm_actualizado', detalle: { etapa: etapa.etapa, reabierta: etapa.reabre } });
    const quien = seg.empresa_nombre || seg.cliente_empresa || `oportunidad ${seg.oportunidad_id}`;
    const folio = seg.numero ? ` (cotización N°${seg.numero})` : '';
    return {
      cambios: {
        ...base,
        estado: ESTADOS.RESPONDIDA,
        respuesta_en: iso(item.respuesta_en || ahora),
        respuesta_resumen: resumen,
        proxima_accion: null,
        proxima_accion_en: null
      },
      eventos,
      etapa: etapa ? { etapa: etapa.etapa, motivo: etapa.motivo } : null,
      aviso: `Respondió ${quien}${folio}${etapa?.reabre ? ' (se reabre)' : ''}.${resumen ? ` ${resumen}` : ''}`,
      ignorado: null
    };
  }

  if (seg.estado === ESTADOS.CERRADA) return { cambios: base, eventos, etapa: null, aviso: null, ignorado: null };

  const anterior = ms(seg.ultimo_envio_mio_en);
  const nuevo = ms(item.ultimo_envio_mio_en);
  const envioNuevo = nuevo !== null && (anterior === null || nuevo > anterior);

  if (seg.estado === ESTADOS.BORRADOR) {
    const enviado = item.borrador_enviado === true || (envioNuevo && item.borrador_existe === false);
    if (enviado) {
      const paso = Number(seg.borrador_paso) || (Number(seg.paso) || 0) + 1;
      eventos.push({ tipo: 'seguimiento_enviado', detalle: { paso } });
      return {
        cambios: {
          ...base,
          estado: ESTADOS.ESPERANDO,
          paso,
          ultimo_envio_mio_en: iso(envioNuevo ? item.ultimo_envio_mio_en : ahora),
          borrador_id: null,
          borrador_creado_en: null,
          borrador_paso: null
        },
        eventos,
        etapa: null,
        aviso: null,
        ignorado: null
      };
    }
    if (item.borrador_existe === false) {
      // El dueño borró el borrador sin enviarlo: no se crea otro para ese paso. Queda en
      // pausa hasta que lo reanude desde el panel.
      eventos.push({ tipo: 'borrador_descartado', detalle: { paso: Number(seg.borrador_paso) || null } });
      return {
        cambios: {
          ...base,
          estado: ESTADOS.PAUSADA,
          estado_antes_pausa: ESTADOS.ESPERANDO,
          borrador_id: null,
          borrador_creado_en: null,
          borrador_paso: null
        },
        eventos,
        etapa: null,
        aviso: null,
        ignorado: null
      };
    }
  }

  if (envioNuevo) {
    // Correo del dueño en el hilo que no es el borrador: reinicia la espera del paso actual.
    eventos.push({ tipo: 'envio_manual', detalle: { paso: Number(seg.paso) || 0 } });
    return {
      cambios: { ...base, ultimo_envio_mio_en: iso(item.ultimo_envio_mio_en) },
      eventos,
      etapa: null,
      aviso: null,
      ignorado: null
    };
  }
  return { cambios: base, eventos, etapa: null, aviso: null, ignorado: null };
};

const aplicarCrearBorrador = (seg, item, ahora, _cal, cfg, contexto) => {
  const pasoPedido = Number(contexto?.paso);
  const esperado = (Number(seg.paso) || 0) + 1;
  if (seg.estado === ESTADOS.BORRADOR && item.creado && Number(seg.borrador_paso) === pasoPedido) {
    return {
      ...resultadoVacio('duplicado'),
      eventos: [{ tipo: 'borrador_duplicado', detalle: { paso: pasoPedido } }]
    };
  }
  if (seg.estado !== ESTADOS.ESPERANDO || pasoPedido !== esperado) return resultadoVacio('estado');
  if (item.creado) {
    return {
      cambios: {
        estado: ESTADOS.BORRADOR,
        borrador_id: item.borrador_id || null,
        borrador_creado_en: iso(ahora),
        borrador_paso: pasoPedido,
        borrador_fallos: 0,
        borrador_fallo_en: null,
        proxima_accion: null,
        proxima_accion_en: null
      },
      eventos: [{ tipo: 'borrador_creado', detalle: { paso: pasoPedido } }],
      etapa: null,
      aviso: null,
      ignorado: null
    };
  }
  const fallos = (Number(seg.borrador_fallos) || 0) + 1;
  const eventos = [{ tipo: 'borrador_fallido', detalle: { paso: pasoPedido, fallos } }];
  const cambios = { borrador_fallos: fallos, borrador_fallo_en: iso(ahora) };
  if (fallos >= cfg.maxFallosBorrador) {
    cambios.estado = ESTADOS.PAUSADA;
    cambios.estado_antes_pausa = ESTADOS.ESPERANDO;
    eventos.push({ tipo: 'pausada', detalle: { motivo: 'fallos_borrador' } });
  }
  return { cambios, eventos, etapa: null, aviso: null, ignorado: null };
};

/**
 * Aplica el resultado de un ítem de tarea del agente.
 * tipo: buscar_envios | revisar_hilos | crear_borradores
 * contexto: el ítem original de la tarea (para crear_borradores, trae el paso pedido).
 * Devuelve { cambios, eventos, etapa: {etapa, motivo}|null, aviso: texto|null, ignorado }.
 */
const aplicarResultado = (seg, tipo, item, ahora, cal, cfg = CONFIG_MOTOR, contexto = null) => {
  if (tipo === 'buscar_envios') return aplicarBuscarEnvio(seg, item, ahora, cal, cfg);
  if (tipo === 'revisar_hilos') return aplicarRevisarHilo(seg, item, ahora, cal, cfg);
  if (tipo === 'crear_borradores') return aplicarCrearBorrador(seg, item, ahora, cal, cfg, contexto);
  return resultadoVacio('tipo');
};

/** Cierre por falta de respuesta tras el 2º seguimiento (lo ejecuta el backend). */
const aplicarCierre = (seg, ahora) => {
  if (seg.estado !== ESTADOS.ESPERANDO || Number(seg.paso) !== 2) return resultadoVacio('estado');
  const yaCerrada = ['ganada', 'perdida'].includes(seg.etapa);
  return {
    cambios: { estado: ESTADOS.CERRADA, cerrada_en: iso(ahora), proxima_accion: null, proxima_accion_en: null },
    eventos: [
      { tipo: 'cerrada_sin_respuesta', detalle: { paso: 2 } },
      ...(yaCerrada ? [] : [{ tipo: 'crm_actualizado', detalle: { etapa: 'perdida', motivo: MOTIVO_SIN_RESPUESTA } }])
    ],
    etapa: yaCerrada ? null : { etapa: 'perdida', motivo: MOTIVO_SIN_RESPUESTA },
    aviso: null,
    ignorado: null
  };
};

/** Sin correo de envío tras el plazo: deja de buscar. */
const aplicarSinEnvio = (seg) => {
  if (seg.estado !== ESTADOS.BUSCANDO) return resultadoVacio('estado');
  return {
    cambios: { estado: ESTADOS.SIN_ENVIO },
    eventos: [{ tipo: 'sin_envio', detalle: { intentos: Number(seg.intentos_busqueda) || 0 } }],
    etapa: null,
    aviso: null,
    ignorado: null
  };
};

/** La oportunidad cambió de etapa por fuera (ganada, perdida o negociación manual). */
const aplicarDetener = (seg) => ({
  cambios: { estado: ESTADOS.PAUSADA, estado_antes_pausa: seg.estado, proxima_accion: null, proxima_accion_en: null },
  eventos: [{ tipo: 'pausada', detalle: { motivo: 'etapa_crm', etapa: seg.etapa } }],
  etapa: null,
  aviso: null,
  ignorado: null
});

const pausar = (seg) => {
  if (!ACTIVOS.includes(seg.estado)) return null;
  return {
    cambios: { estado: ESTADOS.PAUSADA, estado_antes_pausa: seg.estado, proxima_accion: null, proxima_accion_en: null },
    eventos: [{ tipo: 'pausada', detalle: { motivo: 'manual' } }]
  };
};

/** Reanuda una pausa (vuelve al estado anterior) o reinicia la búsqueda de un sin_envio. */
const reanudar = (seg, ahora) => {
  if (seg.estado === ESTADOS.SIN_ENVIO) {
    return {
      cambios: { estado: ESTADOS.BUSCANDO, intentos_busqueda: 0, busqueda_desde: iso(ahora) },
      eventos: [{ tipo: 'reanudada', detalle: { desde: ESTADOS.SIN_ENVIO } }]
    };
  }
  if (seg.estado !== ESTADOS.PAUSADA) return null;
  let estado = seg.estado_antes_pausa || (seg.message_id ? ESTADOS.ESPERANDO : ESTADOS.BUSCANDO);
  if (estado === ESTADOS.BORRADOR && !seg.borrador_id) estado = ESTADOS.ESPERANDO;
  if (estado === ESTADOS.ESPERANDO && !seg.message_id) estado = ESTADOS.BUSCANDO;
  const cambios = { estado, estado_antes_pausa: null, borrador_fallos: 0, borrador_fallo_en: null };
  if (estado === ESTADOS.BUSCANDO) cambios.busqueda_desde = iso(ahora);
  return { cambios, eventos: [{ tipo: 'reanudada', detalle: { estado } }] };
};

module.exports = {
  ESTADOS,
  ACTIVOS,
  MOTIVO_SIN_RESPUESTA,
  CONFIG_MOTOR,
  limpiarResumen,
  vencimientoPaso,
  siguientePaso,
  proximaAccion,
  aplicarResultado,
  aplicarCierre,
  aplicarSinEnvio,
  aplicarDetener,
  pausar,
  reanudar
};
