// Lista pegada desde un correo o un Excel -> lineas de cotizacion.
//
// Acepta una linea por producto, con el codigo (SKU o MPN) y opcionalmente
// la cantidad, en cualquier orden y separados por tab, coma, punto y coma o
// espacios: "TS-464-8G\t2", "2 x RAIL-B02", "03181-001; 4", "Q8752-E".
// Nunca adivina entre dos productos parecidos: si hay mas de un candidato,
// la linea queda como ambigua para que se elija.

const clave = (valor) => String(valor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ENCABEZADOS = new Set(['SKU', 'MPN', 'CANTIDAD', 'CANT', 'QTY', 'CODIGO', 'MODELO', 'PRODUCTO', 'DESCRIPCION', 'UNIDADES']);
const MAX_CANTIDAD = 100000;

export const parsearLista = (texto) => {
  const salida = [];
  for (const cruda of String(texto || '').split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;
    const tokens = linea
      .split(/[\t;,]+|\s+x\s+|\s+/i)
      .map((t) => t.trim())
      .filter(Boolean);
    const numericos = tokens.filter((t) => /^\d+$/.test(t) && Number(t) > 0 && Number(t) <= MAX_CANTIDAD);
    // Un numero demasiado grande para ser cantidad es un codigo (SKU numerico).
    const codigos = tokens.filter((t) => !numericos.includes(t) && !/^\d+[.,]\d+$/.test(t) && t.toLowerCase() !== 'x');
    // Una linea solo con numeros puede ser un SKU numerico (100010879): el
    // resolvedor lo prueba como codigo antes de descartarla.
    if (codigos.length === 0 && numericos.length === 0) continue;
    if (codigos.length > 0 && codigos.every((t) => ENCABEZADOS.has(clave(t)))) continue;
    salida.push({
      linea,
      tokens: codigos,
      numericos,
      cantidad: codigos.length > 0 && numericos.length > 0 ? Number(numericos[numericos.length - 1]) : 1
    });
  }
  return salida;
};

const coincideExacto = (producto, token) => {
  const k = clave(token);
  if (!k) return false;
  const sku = clave(producto.sku);
  return (sku && sku !== 'TOCREATE' && sku === k) || clave(producto.mpn) === k;
};

/**
 * Resuelve contra el catalogo. Un SKU puramente numerico (p. ej. 100010879)
 * se prueba como codigo antes que como cantidad.
 */
export const resolverLista = (productos, entradas) => {
  const resueltas = new Map();
  const ambiguas = [];
  const noEncontradas = [];

  for (const entrada of entradas) {
    let cantidad = entrada.cantidad;
    let candidatos = [];
    for (const token of entrada.tokens) {
      candidatos = productos.filter((p) => coincideExacto(p, token));
      if (candidatos.length) break;
    }
    if (candidatos.length === 0 && entrada.numericos.length > 0) {
      for (const numero of entrada.numericos) {
        const porNumero = productos.filter((p) => coincideExacto(p, numero));
        if (porNumero.length) {
          candidatos = porNumero;
          const otros = entrada.numericos.filter((n) => n !== numero);
          cantidad = otros.length ? Number(otros[otros.length - 1]) : 1;
          break;
        }
      }
    }
    if (candidatos.length === 0) {
      // Codigo incompleto: el codigo contiene lo escrito.
      const k = clave(entrada.tokens.join(''));
      if (entrada.tokens.length > 0 && k.length >= 4) {
        candidatos = productos.filter((p) => clave(p.mpn).includes(k) || (clave(p.sku) !== 'TOCREATE' && clave(p.sku).includes(k)));
      }
    }

    if (candidatos.length === 1) {
      const producto = candidatos[0];
      const previa = resueltas.get(producto.id);
      resueltas.set(producto.id, { producto, cantidad: (previa?.cantidad || 0) + cantidad });
    } else if (candidatos.length > 1) {
      ambiguas.push({ linea: entrada.linea, cantidad, candidatos: candidatos.slice(0, 6) });
    } else {
      noEncontradas.push(entrada.linea);
    }
  }

  return { resueltas: [...resueltas.values()], ambiguas, noEncontradas };
};

/** Heuristica para decidir si un pegado en el buscador es una lista y no un codigo suelto. */
export const pareceLista = (texto) => /\r?\n/.test(String(texto || '').trim()) || /\t/.test(String(texto || ''));
