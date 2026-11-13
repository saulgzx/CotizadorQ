// Montos por línea de una orden ("Monto Axis" y "Monto Intcomex"): lógica pura.
// Es dinero: vive aquí, sin React ni red, para poder probarla. El componente
// solo guarda el estado (borradores) y llama a estas funciones.
import { claveLinea } from './pantallazoMontos';

// Clave estable de una línea (sku y mpn normalizados). Es LA MISMA función con la
// que se calzan las filas leídas de un archivo: una sola definición, para que el
// borrador y el calce no puedan divergir.
export { claveLinea };

// Valor de un input o de la base → número o null (vacío / no numérico).
export const normalizarMontoLinea = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;
  const parsed = parseFloat(valor);
  return Number.isNaN(parsed) ? null : parsed;
};

// Lo que muestra el input: borrador si existe (aunque sea ''), si no el guardado, si no ''.
// campo = 'montoAxis' | 'montoIntcomex'. draftDelBo = { [clave]: string } del BO.
export const valorMonto = (draftDelBo, linea, campo) => {
  if (!linea) return '';
  const borrador = draftDelBo ? draftDelBo[claveLinea(linea)] : undefined;
  if (borrador !== undefined) return borrador;
  const guardado = linea[campo];
  if (guardado === undefined || guardado === null || guardado === '') return '';
  return String(guardado);
};

export const numeroMonto = (draftDelBo, linea, campo) => {
  const parsed = parseFloat(valorMonto(draftDelBo, linea, campo));
  return Number.isNaN(parsed) ? 0 : parsed;
};

// Nuevo estado de borradores { [bo]: { [clave]: string } }. No muta `prev`.
// value undefined borra la clave; un BO sin claves se elimina.
export const cambiarBorrador = (prev, bo, clave, valor) => {
  const next = { ...prev };
  const current = { ...(next[bo] || {}) };
  if (valor === undefined) {
    delete current[clave];
  } else {
    current[clave] = valor;
  }
  if (Object.keys(current).length === 0) {
    delete next[bo];
  } else {
    next[bo] = current;
  }
  return next;
};

// ¿Hay cambios sin guardar en este campo? Una clave sin línea cuenta como sucia.
export const borradorSucio = (order, draftDelBo, campo) => {
  if (!order?.bo) return false;
  if (!draftDelBo) return false;
  return Object.entries(draftDelBo).some(([key, value]) => {
    const line = (order.lines || []).find(item => claveLinea(item) === key);
    if (!line) return true;
    return normalizarMontoLinea(value) !== normalizarMontoLinea(line[campo]);
  });
};

// Líneas a enviar a boLineMetaAPI.save. Claves de borrador sin línea se descartan.
export const construirPayloadMontos = (order, axisDraftDelBo, intcomexDraftDelBo) => {
  const axis = axisDraftDelBo || {};
  const intcomex = intcomexDraftDelBo || {};
  const keys = Array.from(new Set([...Object.keys(axis), ...Object.keys(intcomex)]));
  return keys
    .map((key) => {
      const line = (order?.lines || []).find(item => claveLinea(item) === key);
      if (!line) return null;
      const hasAxis = Object.prototype.hasOwnProperty.call(axis, key);
      const hasIntcomex = Object.prototype.hasOwnProperty.call(intcomex, key);
      return {
        // IMPORTANTE: se omite el campo que no se edita para no pisar el otro monto.
        ...(hasAxis ? { montoAxis: normalizarMontoLinea(axis[key]) } : {}),
        ...(hasIntcomex ? { montoIntcomex: normalizarMontoLinea(intcomex[key]) } : {}),
        sku: line.sku || '',
        mpn: line.mpn || ''
      };
    })
    .filter(Boolean);
};

// Órdenes con los montos ya guardados aplicados. Solo toca el BO y las líneas del payload.
export const aplicarMontosGuardados = (orders, bo, payloadLines) => {
  const updates = payloadLines.reduce((acc, item) => {
    acc[claveLinea(item)] = {
      montoAxis: item.montoAxis,
      montoIntcomex: item.montoIntcomex
    };
    return acc;
  }, {});
  return orders.map(orderItem => {
    if (orderItem.bo !== bo) return orderItem;
    return {
      ...orderItem,
      lines: (orderItem.lines || []).map(line => {
        const upd = updates[claveLinea(line)];
        return upd !== undefined
          ? {
            ...line,
            ...(upd.montoAxis !== undefined ? { montoAxis: upd.montoAxis } : {}),
            ...(upd.montoIntcomex !== undefined ? { montoIntcomex: upd.montoIntcomex } : {})
          }
          : line;
      })
    };
  });
};

// Borradores tras leer un archivo: mezcla las asignaciones { clave: monto } en el BO.
export const fusionarAsignaciones = (prev, bo, asignaciones) => ({
  ...prev,
  [bo]: {
    ...(prev[bo] || {}),
    ...Object.fromEntries(Object.keys(asignaciones || {}).map(k => [k, String(asignaciones[k])]))
  }
});

// Mensaje para el usuario tras leer un archivo de montos.
export const resumirLectura = (resultado) => {
  const asignaciones = resultado?.asignaciones || {};
  const claves = Object.keys(asignaciones);
  const plural = (n, una, varias) => `${n} ${n === 1 ? una : varias}`;

  // Caso aparte, y el más confuso: el archivo se leyó bien y las líneas calzaron,
  // pero ninguna traía precio (OC que solo listan producto y cantidad).
  const leidasSinMonto = resultado?.sinMonto?.length || 0;
  if (!claves.length && leidasSinMonto) {
    return {
      mensaje:
        `Se leyeron ${plural(leidasSinMonto, 'línea', 'líneas')}, pero ninguna trae precio. ` +
        '¿El archivo incluye montos? Si solo lista producto y cantidad, no hay nada que cargar.',
      tipo: 'error'
    };
  }

  // Se informa TODO lo que no se llenó.
  const avisos = [plural(claves.length, 'línea completada', 'líneas completadas')];
  // De un Excel se dice SIEMPRE qué columna se usó como precio.
  if (resultado?.origen === 'excel' && resultado?.columnas?.monto)
    avisos.push(`precio tomado de «${resultado.columnas.monto}»`);
  if (leidasSinMonto)
    avisos.push(`${plural(leidasSinMonto, 'línea', 'líneas')} sin precio en el archivo`);
  if (resultado?.ambiguas?.length)
    avisos.push(`${plural(resultado.ambiguas.length, 'ambigua', 'ambiguas')} sin llenar`);
  if (resultado?.lineasSinDato?.length)
    avisos.push(`${plural(resultado.lineasSinDato.length, 'línea', 'líneas')} sin dato`);
  if (resultado?.sinCalce?.length)
    avisos.push(`${plural(resultado.sinCalce.length, 'fila', 'filas')} sin calce`);
  return {
    mensaje: `${avisos.join(' · ')}. Revisa antes de guardar.`,
    tipo: claves.length ? 'ok' : 'error'
  };
};
