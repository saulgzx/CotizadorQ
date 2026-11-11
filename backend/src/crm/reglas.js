/**
 * CRM: reglas de negocio puras (etapas de una oportunidad y armado del embudo).
 * Devuelven los campos a guardar; AHORA marca columnas que toman CURRENT_TIMESTAMP.
 */
const { AHORA } = require('./repositorio');
const {
  ETAPAS,
  ETAPAS_ABIERTAS,
  esEtapaCerrada,
  limpiarTexto
} = require('./normalizar');

const errorValidacion = (mensaje) =>
  Object.assign(new Error(mensaje), { status: 400 });

const MENSAJE_MOTIVO =
  'Para marcar la oportunidad como perdida indica motivo_perdida';

const CAMPOS_SIMPLES = [
  'titulo',
  'contacto_id',
  'marca',
  'es_proyecto',
  'monto_manual',
  'fecha_cierre_estimada'
];

const copiarPresentes = (origen, campos) => {
  const salida = {};
  for (const campo of campos) {
    if (
      Object.prototype.hasOwnProperty.call(origen, campo) &&
      origen[campo] !== undefined
    ) {
      salida[campo] = origen[campo];
    }
  }
  return salida;
};

/** Datos de una oportunidad nueva creada a mano (POST). Lanza 400 si perdida sin motivo. */
const datosOportunidadNueva = (body) => {
  const etapa = body.etapa || 'nueva';
  const datos = {
    ...copiarPresentes(body, CAMPOS_SIMPLES),
    empresa_id: body.empresa_id,
    etapa
  };
  if (etapa === 'perdida') {
    const motivo = limpiarTexto(body.motivo_perdida, 500);
    if (!motivo) throw errorValidacion(MENSAJE_MOTIVO);
    datos.motivo_perdida = motivo;
  }
  if (esEtapaCerrada(etapa)) datos.cerrada_en = AHORA;
  return datos;
};

/**
 * Cambios a guardar al editar una oportunidad (PATCH):
 * - cambiar de etapa actualiza etapa_desde;
 * - pasar a ganada/perdida fija cerrada_en; volver a una etapa abierta lo limpia;
 * - pasar a perdida exige motivo_perdida (400); salir de perdida lo limpia;
 * - el motivo solo se guarda si la oportunidad queda perdida.
 */
const cambiosOportunidad = (actual, body) => {
  const cambios = copiarPresentes(body, CAMPOS_SIMPLES);
  const etapaFinal = body.etapa || actual.etapa;
  const motivoEnviado =
    Object.prototype.hasOwnProperty.call(body, 'motivo_perdida') &&
    body.motivo_perdida !== undefined;
  const motivo = motivoEnviado
    ? limpiarTexto(body.motivo_perdida, 500)
    : undefined;

  if (body.etapa && body.etapa !== actual.etapa) {
    cambios.etapa = body.etapa;
    cambios.etapa_desde = AHORA;
    cambios.cerrada_en = esEtapaCerrada(body.etapa) ? AHORA : null;
    if (body.etapa === 'perdida') {
      if (!motivo) throw errorValidacion(MENSAJE_MOTIVO);
      cambios.motivo_perdida = motivo;
    } else {
      cambios.motivo_perdida = null;
    }
    return cambios;
  }

  if (etapaFinal === 'perdida' && motivoEnviado) {
    if (!motivo) throw errorValidacion(MENSAJE_MOTIVO);
    cambios.motivo_perdida = motivo;
  }
  return cambios;
};

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Embudo a partir de las filas de totalesEmbudo ({ tipo: 'etapa'|'mes', clave, cantidad, monto }).
 * Las 5 etapas siempre presentes y en orden, aunque no haya oportunidades.
 */
const armarEmbudo = (filas) => {
  const buscar = (tipo, clave) =>
    (filas || []).find((f) => f.tipo === tipo && f.clave === clave);
  const etapas = ETAPAS.map((etapa) => {
    const fila = buscar('etapa', etapa);
    return {
      etapa,
      cantidad: Number(fila?.cantidad) || 0,
      monto: redondear(fila?.monto)
    };
  });
  const abiertas = etapas
    .filter((e) => ETAPAS_ABIERTAS.includes(e.etapa))
    .reduce(
      (acc, e) => ({
        cantidad: acc.cantidad + e.cantidad,
        monto: redondear(acc.monto + e.monto)
      }),
      {
        cantidad: 0,
        monto: 0
      }
    );
  const delMes = (etapa) => {
    const fila = buscar('mes', etapa);
    return {
      cantidad: Number(fila?.cantidad) || 0,
      monto: redondear(fila?.monto)
    };
  };
  return {
    etapas,
    abiertas,
    ganadas_mes: delMes('ganada'),
    perdidas_mes: delMes('perdida')
  };
};

/** Resumen de una empresa a partir de sus oportunidades y el agregado de cotizaciones. */
const resumenEmpresa = (oportunidades, { cotizaciones, monto_cotizado }) => {
  const ganadas = oportunidades.filter((o) => o.etapa === 'ganada');
  const perdidas = oportunidades.filter((o) => o.etapa === 'perdida').length;
  const cerradas = ganadas.length + perdidas;
  return {
    cotizaciones,
    monto_cotizado: redondear(monto_cotizado),
    ganadas: ganadas.length,
    perdidas,
    monto_ganado: redondear(
      ganadas.reduce((s, o) => s + (Number(o.monto) || 0), 0)
    ),
    tasa_cierre:
      cerradas === 0
        ? null
        : Math.round((ganadas.length / cerradas) * 10000) / 10000
  };
};

module.exports = {
  MENSAJE_MOTIVO,
  errorValidacion,
  datosOportunidadNueva,
  cambiosOportunidad,
  armarEmbudo,
  resumenEmpresa
};
