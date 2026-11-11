// cotizar_rapido: todo lo que el agente necesita para armar un preview en UNA
// llamada. No tiene logica propia de precios ni de entrega: reutiliza
// resolverItems (catalogo + stock en paralelo), dominio.ts (entrega, garantia,
// EOL) y calcularPrecios (backend). Solo lectura.
import {
  CotizadorError,
  calcularPrecios,
  diagnosticoStock,
  DIAS_CREACION_SKU,
  EOL_EXTRA,
  resolverItems,
  type LecturaStock,
  type LineaPrecio,
  type LineaResuelta,
  type RespuestaPrecios,
  type SkuNoResuelto
} from './cotizador.js';
import { esEol, garantiaDe, infoEntrega, unidadesDe, type Producto, type TipoCoincidencia } from './dominio.js';

/**
 * Datos de un producto con su stock y entrega. Es lo mismo que devuelve
 * consultar_producto (con las mismas reglas de «stock no verificado»); con
 * `cantidad` la entrega contempla stock parcial.
 */
export const fichaProducto = (
  producto: Producto,
  lectura: LecturaStock,
  coincidencia: TipoCoincidencia,
  cantidad?: number
) => ({
  coincidencia,
  id: producto.id,
  sku: producto.sku,
  mpn: producto.mpn,
  marca: producto.marca,
  origen: producto.origen,
  descripcion: producto.descripcion,
  precio_cliente: producto.precio_cliente,
  stock: unidadesDe(lectura, producto),
  stock_leido_en: lectura.leido_en,
  eol: esEol(producto, EOL_EXTRA),
  ...infoEntrega(producto, lectura, DIAS_CREACION_SKU, cantidad),
  ...garantiaDe(producto),
  diagnostico_stock: diagnosticoStock(lectura)
});

export interface ItemRapido {
  sku: string;
  cantidad: number;
  gp?: number;
}

export interface OpcionesRapido {
  partner_category?: string;
  gp_axis?: number;
  gp_qnap?: number;
}

export type CalculoLinea = Omit<LineaPrecio, 'producto_id' | 'sku' | 'mpn' | 'descripcion' | 'origen' | 'cantidad'>;

type Ficha = Omit<ReturnType<typeof fichaProducto>, 'diagnostico_stock'>;

export interface ResultadoRapido {
  lineas: Array<{
    ficha: Ficha;
    cantidad: number;
    precio_total_lista: number;
    calculo: CalculoLinea | null;
  }>;
  no_resueltos: SkuNoResuelto[];
  /** Se pidio nivel de partner o GP. */
  calculo_pedido: boolean;
  /** El backend entrego el calculo. */
  calculo_disponible: boolean;
  calculo_aviso: string | null;
  precios: RespuestaPrecios | null;
  totales: {
    lineas: number;
    unidades: number;
    total_lista: number;
    /** Solo si cada linea tiene un unico resultado (un nivel de partner, o QNAP). */
    total_calculado: number | null;
    margen_total: number | null;
  };
  stock: ReturnType<typeof diagnosticoStock>;
  lectura: LecturaStock;
  lineas_resueltas: LineaResuelta[];
}

const avisoCalculo = (error: unknown): string => {
  if (error instanceof CotizadorError && error.status === 403) {
    return (
      'El backend no autoriza el calculo por partner/GP para la cuenta del conector (403: falta PRECIOS_USUARIOS). ' +
      'Se entrega precio de lista y stock; no inventes precios por nivel ni margen.'
    );
  }
  const detalle = error instanceof Error ? error.message : String(error);
  return `No se pudo calcular el precio por partner/GP (${detalle}). Se entrega precio de lista y stock.`;
};

export const cotizarRapido = async (
  items: ItemRapido[],
  opciones: OpcionesRapido = {}
): Promise<ResultadoRapido> => {
  const { lineas, noResueltos, total, lectura } = await resolverItems(items);
  const pedido =
    opciones.partner_category !== undefined ||
    opciones.gp_axis !== undefined ||
    opciones.gp_qnap !== undefined ||
    items.some((i) => i.gp !== undefined);

  let precios: RespuestaPrecios | null = null;
  let aviso: string | null = null;
  if (pedido && lineas.length > 0) {
    try {
      precios = await calcularPrecios({
        items: lineas.map((l) => ({ producto_id: Number(l.producto.id), cantidad: l.cantidad, gp: l.gp })),
        partner_category: opciones.partner_category,
        gp_axis: opciones.gp_axis,
        gp_qnap: opciones.gp_qnap
      });
    } catch (error) {
      aviso = avisoCalculo(error);
    }
  }

  const calculoDe = new Map<number, LineaPrecio>((precios?.lineas ?? []).map((l) => [Number(l.producto_id), l]));
  const salida: ResultadoRapido['lineas'] = lineas.map((l) => {
    const { diagnostico_stock: _omitido, ...ficha } = fichaProducto(l.producto, lectura, l.coincidencia, l.cantidad);
    const c = calculoDe.get(Number(l.producto.id));
    let calculo: CalculoLinea | null = null;
    if (c) {
      const { producto_id: _a, sku: _b, mpn: _c, descripcion: _d, origen: _e, cantidad: _f, ...resto } = c;
      calculo = resto;
    }
    return { ficha, cantidad: l.cantidad, precio_total_lista: l.precio_total, calculo };
  });

  let totalCalculado: number | null = null;
  let margenTotal: number | null = null;
  if (precios && salida.length > 0 && salida.every((l) => l.calculo)) {
    let t = 0;
    let m = 0;
    let unico = true;
    for (const l of salida) {
      const c = l.calculo!;
      if (c.niveles) {
        if (c.niveles.length !== 1) unico = false;
        else {
          t += c.niveles[0].precio_total;
          m += c.niveles[0].margen_total;
        }
      } else {
        t += c.precio_total ?? 0;
        m += c.margen_total ?? 0;
      }
    }
    if (unico) {
      totalCalculado = Number(t.toFixed(2));
      margenTotal = Number(m.toFixed(2));
    }
  }

  return {
    lineas: salida,
    no_resueltos: noResueltos,
    calculo_pedido: pedido,
    calculo_disponible: precios !== null,
    calculo_aviso: aviso,
    precios,
    totales: {
      lineas: lineas.length,
      unidades: lineas.reduce((a, l) => a + l.cantidad, 0),
      total_lista: total,
      total_calculado: totalCalculado,
      margen_total: margenTotal
    },
    stock: diagnosticoStock(lectura),
    lectura,
    lineas_resueltas: lineas
  };
};
