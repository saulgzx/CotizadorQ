// Quotes de fabricantes sin lista de precios (ISS, Neural Labs, Milestone).
// El fabricante manda un quote (PDF o imagen) y de ahí salen las líneas: MPN,
// cantidad, descripción y costo unitario en USD.
//
// Módulo puro: sin React y sin red. Es plata, así que nunca adivina en silencio:
// lo dudoso queda marcado en `problemas` o en `avisos` para que lo vea una persona.
//
// Reglas de negocio (decididas por el dueño):
//   costo puesto en Chile = costo del quote x (1 + % de transporte y arancel), sin más factores
//     ISS 15% · Neural Labs 15% · Milestone 0% si es licencia, 12% si es servidor
//   precio al cliente = costo Chile / (1 - margen); margen por defecto 8%, editable por línea.

import { normalizarMonto } from './pantallazoMontos';

export const GP_QUOTE_POR_DEFECTO = 0.08;

export const FABRICANTES = Object.freeze({
  ISS: Object.freeze({ nombre: 'ISS', internacion: 0.15 }),
  NEURAL: Object.freeze({ nombre: 'Neural Labs', internacion: 0.15 }),
  // Milestone depende del tipo de línea.
  MILESTONE: Object.freeze({
    nombre: 'Milestone',
    internacion: Object.freeze({ licencia: 0, servidor: 0.12 })
  })
});

export const TIPOS_MILESTONE = Object.freeze(['licencia', 'servidor']);

const TIEMPO_QUOTE = 'ETA por confirmar';
export const SKU_POR_CREAR = 'To Create';

/** Orígenes de línea que salen de un quote (los mismos que conoce el backend). */
export const ORIGENES_QUOTE = Object.freeze(['ISS', 'NEURAL', 'MILESTONE', 'MILESTONE_HW']);

export const esOrigenQuote = (origen) => ORIGENES_QUOTE.includes(String(origen ?? '').trim().toUpperCase());

/** Origen con que se guarda la línea: Milestone servidor es MILESTONE_HW; el resto, el fabricante. */
export const origenDeQuote = (fabricante, tipo) => {
  const k = String(fabricante ?? '').trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(FABRICANTES, k)) return null;
  return k === 'MILESTONE' && String(tipo ?? '').trim().toLowerCase() === 'servidor' ? 'MILESTONE_HW' : k;
};
const PREFIJO_QUOTE = 'quote:';

// Redondeo a centavos "como en la calculadora". 80,5 x 1,15 da 92,57499999999999 en coma
// flotante y un redondeo directo lo dejaba en 92,57 (un centavo menos, en ~0,8% de los costos).
// toPrecision(12) limpia ese ruido antes de redondear.
const redondear2 = (n) => Math.round(Number((n * 100).toPrecision(12))) / 100;
const clave = (valor) => String(valor ?? '').trim().toUpperCase();
const texto = (valor) => String(valor ?? '').trim();

const claveFabricante = (fabricante) => {
  const k = clave(fabricante);
  return Object.prototype.hasOwnProperty.call(FABRICANTES, k) ? k : null;
};

const costoValido = (valor) => {
  if (valor === null || valor === undefined || valor === '' || typeof valor === 'boolean') return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// --- Tipo de línea de Milestone ---------------------------------------------------

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Hardware inequívoco: gana aunque la descripción también diga "license"
// (p. ej. un Husky "con licencia XProtect incluida" sigue siendo un equipo).
const HARDWARE_FUERTE = /husky|chassis|\b(appliances?|nvrs?|workstations?|racks?|hardware|kiosks?)\b/;
// Ambiguas: "Management Server License" o "Storage license" son licencias, así que solo
// cuentan como hardware si no aparece ninguna palabra de licencia.
const HARDWARE_DEBIL = /\b(servers?|servidor(?:es)?|storage|almacenamiento)\b/;
const PALABRA_LICENCIA = /licen[cs]|subscri|suscrip|\bcare\b|\bsupport\b|\bsoporte\b/;

const senales = (linea) => {
  const t = sinTildes(`${linea?.descripcion ?? linea?.desc ?? ''} ${linea?.mpn ?? ''}`);
  return {
    fuerte: HARDWARE_FUERTE.test(t),
    debil: HARDWARE_DEBIL.test(t),
    licencia: PALABRA_LICENCIA.test(t)
  };
};

/**
 * Sugerencia de tipo para una línea de Milestone (el usuario puede cambiarla).
 * Criterio sobre descripción + MPN, sin tildes ni mayúsculas:
 *  - 'servidor' si aparece una palabra de hardware fuerte (husky, chassis, appliance, nvr,
 *    workstation, rack, hardware, kiosk), aunque diga "license";
 *  - 'servidor' si aparece una débil (server, servidor, storage, almacenamiento) y NO hay
 *    palabra de licencia (licencia, license, subscription, suscripcion, care, support, soporte);
 *  - en cualquier otro caso 'licencia'.
 * Ojo: 'licencia' es 0% de internación, o sea subestima el costo; por eso existe tipoEsDudoso.
 */
export const tipoMilestoneSugerido = (linea) => {
  const s = senales(linea);
  if (s.fuerte) return 'servidor';
  if (s.debil && !s.licencia) return 'servidor';
  return 'licencia';
};

/**
 * true si la sugerencia no es de fiar y conviene marcar la línea "revisar":
 *  - hay señales de hardware Y de licencia a la vez (p. ej. "Husky ... license"), o
 *  - no hay ninguna señal (ni hardware ni licencia): se cayó a 'licencia' por defecto.
 */
export const tipoEsDudoso = (linea) => {
  const s = senales(linea);
  const hardware = s.fuerte || s.debil;
  if (hardware && s.licencia) return true;
  return !hardware && !s.licencia;
};

// --- Plata ------------------------------------------------------------------------

/**
 * Porcentaje de transporte y arancel como decimal (0.15, 0.12, 0), o null si el fabricante no
 * existe o, en Milestone, el tipo no es 'licencia' ni 'servidor'. Nunca 0 por defecto: un
 * fabricante desconocido no puede pasar por "sin recargo".
 */
export const porcentajeInternacion = (fabricante, tipo) => {
  const k = claveFabricante(fabricante);
  if (!k) return null;
  const { internacion } = FABRICANTES[k];
  if (typeof internacion === 'number') return internacion;
  const t = String(tipo ?? '').trim().toLowerCase();
  return TIPOS_MILESTONE.includes(t) ? internacion[t] : null;
};

/** Costo puesto en Chile con 2 decimales, o null si el costo no es > 0 o no hay porcentaje. */
export const costoChileQuote = (costoUnitario, fabricante, tipo) => {
  const costo = costoValido(costoUnitario);
  const pct = porcentajeInternacion(fabricante, tipo);
  if (costo === null || pct === null) return null;
  return redondear2(costo * (1 + pct));
};

/** Precio al cliente = costo Chile / (1 - gp), 2 decimales. gp decimal en [0, 1). */
export const precioClienteQuote = (costoChile, gp) => {
  const costo = costoValido(costoChile);
  const g = gp === null || gp === undefined || gp === '' ? NaN : Number(gp);
  if (costo === null || !Number.isFinite(g) || g < 0 || g >= 1) return null;
  return redondear2(costo / (1 - g));
};

// --- Normalización de líneas --------------------------------------------------------

const primero = (...valores) => valores.find((v) => v !== undefined && v !== null);

const cantidadEntera = (valor) => {
  if (valor === null || valor === undefined || typeof valor === 'boolean') return null;
  const t = typeof valor === 'string' ? valor.trim() : valor;
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

const filaVacia = (c) =>
  [c.mpn, c.descripcion, c.cantidad, c.costo, c.total].every(
    (v) => v === undefined || v === null || String(v).trim() === ''
  );

const iguales = (a, b) => Math.abs(a - b) < 0.005;

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Líneas crudas del lector -> líneas limpias + avisos. Acepta las claves del lector
 * (costo_unitario, total_linea) y las camelCase (costoUnitario, totalLinea).
 */
export const normalizarLineasQuote = (lineasCrudas, { fabricante } = {}) => {
  const k = claveFabricante(fabricante);
  const avisos = [];
  if (!k) avisos.push('Fabricante desconocido: no se puede calcular el costo en Chile de estas líneas.');
  const esMilestone = k === 'MILESTONE';

  const lineas = [];
  for (const cruda of Array.isArray(lineasCrudas) ? lineasCrudas : []) {
    if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) continue;
    const c = {
      mpn: cruda.mpn,
      descripcion: primero(cruda.descripcion, cruda.desc),
      cantidad: primero(cruda.cantidad, cruda.qty),
      costo: primero(cruda.costo_unitario, cruda.costoUnitario),
      total: primero(cruda.total_linea, cruda.totalLinea)
    };
    if (filaVacia(c)) continue;

    const mpn = texto(c.mpn);
    const descripcion = texto(c.descripcion);
    const cantidad = cantidadEntera(c.cantidad);
    const costoUnitario = normalizarMonto(c.costo);
    const totalLinea = normalizarMonto(c.total);
    const problemas = [];
    if (!mpn) problemas.push('sin-mpn');
    if (cantidad === null) problemas.push('sin-cantidad');
    if (costoUnitario === null) problemas.push('sin-costo');
    if (
      costoUnitario !== null &&
      cantidad !== null &&
      totalLinea !== null &&
      Math.abs(costoUnitario * cantidad - totalLinea) > totalLinea * 0.01
    ) {
      problemas.push('total-no-cuadra');
    }
    lineas.push({
      mpn,
      descripcion,
      cantidad,
      costoUnitario,
      totalLinea,
      tipo: esMilestone ? tipoMilestoneSugerido({ mpn, descripcion }) : null,
      problemas
    });
  }

  // MPN repetido: mismo costo -> se suman cantidades; costo distinto (o dato faltante) -> separadas y marcadas.
  const porMpn = new Map();
  lineas.forEach((l, i) => {
    if (!l.mpn) return;
    const m = clave(l.mpn);
    if (!porMpn.has(m)) porMpn.set(m, []);
    porMpn.get(m).push(i);
  });
  const eliminadas = new Set();
  const sumadas = [];
  for (const indices of porMpn.values()) {
    if (indices.length < 2) continue;
    const sumables = indices.filter((i) => lineas[i].costoUnitario !== null && lineas[i].cantidad !== null);
    const vistos = [];
    for (const i of sumables) {
      const destino = vistos.find((j) => iguales(lineas[j].costoUnitario, lineas[i].costoUnitario));
      if (destino === undefined) {
        vistos.push(i);
        continue;
      }
      const d = lineas[destino];
      d.cantidad += lineas[i].cantidad;
      d.totalLinea = d.totalLinea !== null && lineas[i].totalLinea !== null ? redondear2(d.totalLinea + lineas[i].totalLinea) : null;
      d.problemas = [...new Set([...d.problemas, ...lineas[i].problemas])];
      eliminadas.add(i);
      sumadas.push(lineas[destino].mpn);
    }
    const quedan = indices.filter((i) => !eliminadas.has(i));
    if (quedan.length > 1) {
      for (const i of quedan) lineas[i].problemas.push('mpn-repetido');
    }
  }
  const finales = lineas.filter((_, i) => !eliminadas.has(i));

  if (!finales.length) avisos.push('No se encontraron líneas en el quote.');
  if (sumadas.length) {
    const mpns = [...new Set(sumadas)].join(', ');
    avisos.push(`Se sumaron las cantidades de líneas repetidas con el mismo MPN y el mismo costo: ${mpns}.`);
  }
  const conProblemas = finales.filter((l) => l.problemas.length).length;
  if (conProblemas) {
    avisos.push(
      `${plural(conProblemas, 'línea tiene', 'líneas tienen')} problemas y hay que revisarlas antes de cotizar.`
    );
  }
  const cuenta = (p) => finales.filter((l) => l.problemas.includes(p)).length;
  const sinCosto = cuenta('sin-costo');
  if (sinCosto) avisos.push(`${plural(sinCosto, 'línea no tiene', 'líneas no tienen')} costo unitario: no se pueden cotizar.`);
  const noCuadra = cuenta('total-no-cuadra');
  if (noCuadra) {
    avisos.push(
      `En ${plural(noCuadra, 'línea', 'líneas')} el costo unitario por la cantidad no cuadra con el total: puede que se haya leído el total como unitario.`
    );
  }
  const sinCantidad = cuenta('sin-cantidad');
  if (sinCantidad) avisos.push(`${plural(sinCantidad, 'línea no tiene', 'líneas no tienen')} cantidad legible.`);
  const repetidas = cuenta('mpn-repetido');
  if (repetidas) avisos.push(`${plural(repetidas, 'línea repite', 'líneas repiten')} un MPN con costos distintos: revisa cuál vale.`);
  const sinMpn = cuenta('sin-mpn');
  if (sinMpn) avisos.push(`${plural(sinMpn, 'línea no tiene', 'líneas no tienen')} MPN (puede ser un servicio).`);
  if (esMilestone) {
    const dudosas = finales.filter((l) => tipoEsDudoso(l)).length;
    if (dudosas) {
      avisos.push(
        `En ${plural(dudosas, 'línea', 'líneas')} de Milestone no está claro si es licencia (0%) o servidor (12%): revisa el tipo.`
      );
    }
  }
  return { lineas: finales, avisos };
};

// --- Producto para el carrito -------------------------------------------------------

let contadorId = 0;

/**
 * Producto para el carrito con la misma forma que `productoFueraDeLista`, o null si la línea
 * no tiene costo válido o el fabricante/tipo no permite calcular el costo Chile.
 * El id no es numérico (al guardar queda sin producto_id) y es único por línea: `indice`
 * lo hace determinista; sin él se usa un contador del módulo.
 * `cantidadSugerida` es la cantidad del quote, o 1 si no se pudo leer.
 */
export const productoDeQuote = (linea, { fabricante, gp = GP_QUOTE_POR_DEFECTO, tipo, indice } = {}) => {
  const k = claveFabricante(fabricante);
  if (!k) return null;
  const costoFabricante = costoValido(linea?.costoUnitario);
  if (costoFabricante === null) return null;
  const tipoQuote =
    k === 'MILESTONE' ? String(tipo ?? linea?.tipo ?? tipoMilestoneSugerido(linea)).trim().toLowerCase() : null;
  const costoChile = costoChileQuote(costoFabricante, k, tipoQuote);
  if (costoChile === null) return null;
  const mpn = texto(linea?.mpn);
  const gpFinal = Number.isFinite(Number(gp)) && gp !== null && gp !== '' && Number(gp) >= 0 && Number(gp) < 1 ? Number(gp) : GP_QUOTE_POR_DEFECTO;
  const n = indice ?? ++contadorId;
  return {
    id: `${PREFIJO_QUOTE}${k}:${clave(mpn).replace(/\s+/g, '') || 'SINMPN'}#${n}`,
    fueraDeLista: true,
    // El origen decide la cadena de costo al guardar (backend/src/services/cotizacionItems.js):
    // un servidor Milestone lleva 12% y una licencia 0%, así que son dos orígenes distintos.
    origen: origenDeQuote(k, tipoQuote),
    marca: FABRICANTES[k].nombre,
    // Estos equipos no tienen SKU Intcomex todavía: se cotizan igual, con el literal "To Create".
    sku: SKU_POR_CREAR,
    mpn,
    desc: texto(linea?.descripcion) || mpn || 'Línea de quote',
    // precio = costo del quote del fabricante: es lo que se guarda como precio_disty. El precio
    // al cliente sale de costoChile (más abajo), que ya trae el transporte y arancel.
    precio: costoFabricante,
    gp: gpFinal,
    rebate_partner_autorizado: 0,
    rebate_partner_silver: 0,
    rebate_partner_gold: 0,
    rebate_partner_multiregional: 0,
    costoChile,
    tiempo: TIEMPO_QUOTE,
    deQuote: true,
    costoFabricante,
    tipoQuote,
    cantidadSugerida: cantidadEntera(linea?.cantidad) ?? 1
  };
};

// --- Advertencias del quote entero ---------------------------------------------------

/** Avisos de plata sobre el quote completo: moneda, descuento global no aplicado y notas del lector. */
export const resumenQuote = ({ moneda, descuentoGlobalPct, notas } = {}) => {
  const avisos = [];
  const m = clave(moneda);
  if (!m) {
    avisos.push('El quote no indica la moneda: se asumió USD, revisa.');
  } else if (m !== 'USD' && m !== 'US$') {
    avisos.push(`El quote viene en ${m}: los costos se cargaron sin convertir, revisa.`);
  }
  const d = typeof descuentoGlobalPct === 'string' ? normalizarMonto(descuentoGlobalPct.replace('%', '')) : normalizarMonto(descuentoGlobalPct);
  if (d !== null) {
    avisos.push(`Hay un descuento global de ${String(d).replace('.', ',')}% que NO está aplicado a los costos: revisa.`);
  }
  const nota = texto(notas);
  if (nota) avisos.push(`Nota del lector: ${nota}`);
  return { avisos };
};
