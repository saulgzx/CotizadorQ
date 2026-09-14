import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  crearCotizacion,
  diagnosticoStock,
  DIAS_CREACION_SKU,
  EOL_EXTRA,
  generarPdf,
  getCatalogo,
  getCotizacion,
  getStock,
  resolverItems,
  type LecturaStock,
  type LineaResuelta,
  type SkuNoResuelto
} from './cotizador.js';
import {
  buscarProductoTolerante,
  esEol,
  garantiaDe,
  infoEntrega,
  rankearBusqueda,
  rotulos,
  textoEntrega,
  textoGarantia,
  textoStock,
  unidadesDe
} from './dominio.js';

const USD = (valor: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(valor);

const itemSchema = z.object({
  sku: z.string().describe('SKU o MPN del producto'),
  cantidad: z.number().int().positive().default(1).describe('Unidades')
});

const clienteSchema = z.object({
  nombre: z.string().optional(),
  empresa: z.string().optional(),
  email: z.string().optional(),
  telefono: z.string().optional(),
  cliente_final: z.string().optional(),
  fecha_ejecucion: z.string().optional(),
  fecha_implementacion: z.string().optional(),
  vms: z.string().optional()
});

// Toda tool devuelve texto legible + el JSON estructurado, en ese orden.
const respuesta = (texto: string, datos: unknown) => ({
  content: [
    { type: 'text' as const, text: texto },
    { type: 'text' as const, text: '```json\n' + JSON.stringify(datos, null, 2) + '\n```' }
  ]
});

// Una coincidencia no exacta se marca en la fila: el usuario tiene que poder
// ver de un vistazo que ese renglon salio de una busqueda aproximada antes de
// mandarle la cotizacion a un cliente.
const MARCA_COINCIDENCIA: Record<string, string> = {
  exacta: '',
  parcial: ' ⚠️',
  descripcion: ' ⚠️'
};

/** Aviso comun cuando el stock no se leyo en vivo. */
const avisoStock = (lectura: LecturaStock): string => {
  if (lectura.verificado) return '';
  if (lectura.origen === 'snapshot') {
    return (
      `\n\n⚠️ **Stock no verificado**: ${lectura.error} Se muestra la ultima lectura buena con su fecha. ` +
      'El plazo queda como «no verificado» hasta que el stock vuelva a leerse.'
    );
  }
  return (
    `\n\n⚠️ **Stock no disponible**: ${lectura.error} No hay lectura previa guardada. ` +
    'El plazo queda como «no verificado»: no uses el plazo de catalogo como plazo comprometido.'
  );
};

const celda = (texto: string) => texto.replace(/\|/g, '/');

const tablaLineas = (lineas: LineaResuelta[], lectura: LecturaStock): string => {
  if (lineas.length === 0) return '_Sin lineas resueltas._';
  const filas = lineas.map((l) => {
    const entrega = infoEntrega(l.producto, lectura, DIAS_CREACION_SKU);
    const marca = MARCA_COINCIDENCIA[l.coincidencia] ?? '';
    const rotulo = rotulos({ eol: esEol(l.producto, EOL_EXTRA), sku_estado: entrega.sku_estado });
    return (
      `| ${l.producto.sku}${marca}${rotulo ? ` (${rotulo})` : ''} | ${celda(l.producto.descripcion.slice(0, 45))} ` +
      `| ${l.cantidad} | ${USD(l.precio_unitario)} | ${USD(l.precio_total)} ` +
      `| ${textoStock(lectura, l.stock)} | ${celda(textoEntrega(entrega))} |`
    );
  });
  const aproximadas = lineas.filter((l) => l.coincidencia !== 'exacta');
  const nota =
    aproximadas.length === 0
      ? ''
      : `\n\n⚠️ ${aproximadas.length} linea(s) resueltas por busqueda aproximada: ` +
        aproximadas.map((l) => `${l.producto.sku} (${l.producto.mpn || 's/mpn'})`).join(', ') +
        '. Verifica que sean los productos correctos.';
  return (
    [
      '| SKU | Descripcion | Cant | Unitario | Total | Stock | Entrega |',
      '|---|---|---|---|---|---|---|',
      ...filas
    ].join('\n') +
    nota +
    avisoStock(lectura)
  );
};

const lineasJson = (lineas: LineaResuelta[], lectura: LecturaStock) =>
  lineas.map((l) => ({
    producto_id: l.producto.id,
    sku: l.producto.sku,
    mpn: l.producto.mpn,
    descripcion: l.producto.descripcion,
    cantidad: l.cantidad,
    precio_unitario: l.precio_unitario,
    precio_total: l.precio_total,
    stock: l.stock,
    eol: esEol(l.producto, EOL_EXTRA),
    ...infoEntrega(l.producto, lectura, DIAS_CREACION_SKU)
  }));

const bloqueNoResueltos = (noResueltos: SkuNoResuelto[]): string =>
  noResueltos.length === 0
    ? ''
    : `\n\n**SKUs no encontrados (${noResueltos.length}):**\n` +
      noResueltos.map((n) => `- \`${n.sku}\` — ${n.motivo}`).join('\n');

export const registrarTools = (server: McpServer): void => {
  server.registerTool(
    'consultar_producto',
    {
      description:
        'Consulta precio, stock, plazo de entrega, estado del SKU y garantia validada de un producto por SKU o MPN. ' +
        'Si stock_verificado es false, "entrega" viene null: no presentes entrega_catalogo como plazo comprometido. Solo lectura.',
      inputSchema: z.object({ sku: z.string().describe('SKU o MPN a consultar') })
    },
    async ({ sku }) => {
      // Secuencial: el catalogo obtiene el token y el stock lo reusa.
      const catalogo = await getCatalogo();
      const lectura = await getStock();
      const { producto, tipo, candidatos } = buscarProductoTolerante(catalogo, sku);

      if (!producto) {
        // Con varios candidatos no se elige uno: se muestran para que decida
        // el usuario. Elegir "el mas parecido" en codigos de producto pondria
        // el articulo equivocado en una cotizacion real.
        if (candidatos.length > 0) {
          const filas = candidatos.map(
            (c) =>
              `| ${c.sku} | ${c.mpn} | ${celda(c.descripcion.slice(0, 45))} | ${USD(c.precio_cliente)} |`
          );
          return respuesta(
            `\`${sku}\` coincide con ${candidatos.length} productos. Especifica cual:\n\n` +
              ['| SKU | MPN | Descripcion | Precio |', '|---|---|---|---|', ...filas].join('\n'),
            { encontrado: false, ambiguo: true, sku, candidatos }
          );
        }
        return respuesta(`No encontre \`${sku}\` en el catalogo activo.`, {
          encontrado: false,
          ambiguo: false,
          sku
        });
      }

      const unidades = unidadesDe(lectura, producto);
      const entrega = infoEntrega(producto, lectura, DIAS_CREACION_SKU);
      const garantia = garantiaDe(producto);
      const eol = esEol(producto, EOL_EXTRA);
      const datos = {
        encontrado: true,
        coincidencia: tipo,
        id: producto.id,
        sku: producto.sku,
        mpn: producto.mpn,
        marca: producto.marca,
        origen: producto.origen,
        descripcion: producto.descripcion,
        precio_cliente: producto.precio_cliente,
        stock: unidades,
        stock_leido_en: lectura.leido_en,
        eol,
        ...entrega,
        ...garantia,
        diagnostico_stock: diagnosticoStock(lectura)
      };

      const aviso =
        tipo === 'exacta'
          ? ''
          : `\n\n⚠️ Coincidencia **${tipo}**, no exacta: buscaste \`${sku}\`. Verifica que sea el producto correcto.`;

      const lineaSku =
        entrega.sku_estado === 'por_crear'
          ? `- SKU: **por crear** (suma ${entrega.dias_creacion_sku} dias de creacion al plazo)\n`
          : '';

      const texto =
        `**${producto.sku}** — ${producto.descripcion}\n` +
        `- Marca: ${producto.marca} (${producto.origen})\n` +
        `- MPN: ${producto.mpn}${eol ? ' · **EOL**' : ''}\n` +
        lineaSku +
        `- Precio: ${USD(producto.precio_cliente)}\n` +
        `- Stock: ${textoStock(lectura, unidades)}\n` +
        `- Entrega: ${textoEntrega(entrega)}\n` +
        (entrega.stock_verificado
          ? ''
          : `- Plazo de catalogo (referencial, no comprometido): ${entrega.entrega_catalogo || 'sin dato'}\n`) +
        `- Garantia: ${textoGarantia(garantia)}\n` +
        (lectura.verificado ? `_(stock: ${lectura.mapa.size} MPN cargados desde bodega)_` : '') +
        avisoStock(lectura) +
        aviso;

      return respuesta(texto, datos);
    }
  );

  server.registerTool(
    'buscar_productos',
    {
      description:
        'Busca productos del catalogo por texto parcial en SKU, MPN, marca o descripcion. Ordena por calidad de coincidencia ' +
        '(MPN exacto, prefijo de MPN, SKU, texto) y, dentro de cada grupo, con stock primero. EOL y "por crear" se rotulan, no se ocultan. Solo lectura.',
      inputSchema: z.object({
        texto: z
          .string()
          .default('')
          .describe('Texto parcial. Vacio devuelve los primeros resultados del catalogo.'),
        origen: z.enum(['QNAP', 'AXIS']).optional().describe('Filtra por linea de producto'),
        limite: z.number().int().positive().max(100).default(20)
      })
    },
    async ({ texto, origen, limite }) => {
      const catalogo = await getCatalogo();
      const lectura = await getStock();
      const delOrigen = origen
        ? catalogo.filter((p) => String(p.origen || '').toUpperCase() === origen)
        : catalogo;

      const rankeados = rankearBusqueda(delOrigen, String(texto || '').trim(), lectura, EOL_EXTRA);
      const pagina = rankeados.slice(0, limite);
      const datos = {
        total_catalogo: catalogo.length,
        coincidencias: rankeados.length,
        mostrados: pagina.length,
        stock: diagnosticoStock(lectura),
        productos: pagina.map((r) => {
          const entrega = infoEntrega(r.producto, lectura, DIAS_CREACION_SKU);
          return {
            sku: r.producto.sku,
            mpn: r.producto.mpn,
            marca: r.producto.marca,
            origen: r.producto.origen,
            descripcion: r.producto.descripcion,
            precio_cliente: r.producto.precio_cliente,
            coincidencia: r.grupo,
            stock: r.unidades,
            eol: r.eol,
            ...entrega
          };
        })
      };

      if (catalogo.length === 0) {
        return respuesta(
          'El catalogo esta vacio: el backend no devolvio ningun producto activo.',
          datos
        );
      }
      if (pagina.length === 0) {
        return respuesta(
          `Sin coincidencias para "${texto}". El catalogo tiene ${catalogo.length} productos activos.`,
          datos
        );
      }

      const filas = pagina.map((r) => {
        const rotulo = rotulos(r);
        const entrega = infoEntrega(r.producto, lectura, DIAS_CREACION_SKU);
        return (
          `| ${r.producto.sku} | ${r.producto.mpn}${rotulo ? ` (${rotulo})` : ''} | ${r.producto.marca} ` +
          `| ${celda(r.producto.descripcion.slice(0, 40))} | ${USD(r.producto.precio_cliente)} ` +
          `| ${textoStock(lectura, r.unidades)} | ${celda(textoEntrega(entrega))} |`
        );
      });
      const texto_salida =
        [
          `**${rankeados.length}** coincidencias de ${catalogo.length} productos (mostrando ${pagina.length}):`,
          '',
          '| SKU | MPN | Marca | Descripcion | Precio | Stock | Entrega |',
          '|---|---|---|---|---|---|---|',
          ...filas
        ].join('\n') + avisoStock(lectura);

      return respuesta(texto_salida, datos);
    }
  );

  server.registerTool(
    'simular_cotizacion',
    {
      description:
        'Calcula el total de una cotizacion sin guardarla. Es la opcion por defecto para explorar precios: no escribe nada en el sistema.',
      inputSchema: z.object({
        datos_cliente: clienteSchema.optional(),
        items: z.array(itemSchema).min(1)
      })
    },
    async ({ datos_cliente, items }) => {
      const { lineas, noResueltos, total, lectura } = await resolverItems(items);
      const texto =
        `### Simulacion (NO guardada)\n\n${tablaLineas(lineas, lectura)}\n\n**Total: ${USD(total)}**` +
        bloqueNoResueltos(noResueltos);

      return respuesta(texto, {
        guardado: false,
        cliente: datos_cliente || null,
        lineas: lineasJson(lineas, lectura),
        no_resueltos: noResueltos,
        total,
        stock: diagnosticoStock(lectura)
      });
    }
  );

  server.registerTool(
    'generar_cotizacion',
    {
      description:
        'GRABA una cotizacion real en CotizadorQ y devuelve su id. ESTO ESCRIBE EN EL SISTEMA DE PRODUCCION: invocalo unicamente despues de que el usuario haya visto una simulacion y haya confirmado explicitamente que quiere guardarla. Ante la duda, usa simular_cotizacion.',
      inputSchema: z.object({
        datos_cliente: clienteSchema,
        items: z.array(itemSchema).min(1)
      })
    },
    async ({ datos_cliente, items }) => {
      const { lineas, noResueltos, total, lectura } = await resolverItems(items);
      if (lineas.length === 0) {
        return respuesta(
          'No se guardo nada: ningun SKU se pudo resolver contra el catalogo.' +
            bloqueNoResueltos(noResueltos),
          { guardado: false, no_resueltos: noResueltos }
        );
      }

      const { id, total: totalBackend } = await crearCotizacion(datos_cliente, lineas);

      const texto =
        `### Cotizacion **#${id}** guardada\n\n${tablaLineas(lineas, lectura)}\n\n` +
        `**Total segun el backend: ${USD(totalBackend)}** (estimado local: ${USD(total)})` +
        bloqueNoResueltos(noResueltos);

      return respuesta(texto, {
        guardado: true,
        cotizacion_id: id,
        total: totalBackend,
        total_estimado_local: total,
        lineas: lineasJson(lineas, lectura),
        no_resueltos: noResueltos,
        stock: diagnosticoStock(lectura)
      });
    }
  );

  server.registerTool(
    'emitir_pdf',
    {
      description:
        'Genera el PDF de una cotizacion ya guardada y lo devuelve en base64. Solo lectura: no modifica la cotizacion.',
      inputSchema: z.object({
        cotizacion_id: z.number().int().positive().describe('Id devuelto por generar_cotizacion')
      })
    },
    async ({ cotizacion_id }) => {
      const cotizacion = await getCotizacion(cotizacion_id);
      const pdf = await generarPdf(cotizacion);
      const nombre = `cotizacion-${cotizacion_id}.pdf`;

      return {
        content: [
          {
            type: 'text' as const,
            text: `PDF de la cotizacion #${cotizacion_id} generado (${(pdf.length / 1024).toFixed(1)} KB), archivo \`${nombre}\`.`
          },
          {
            type: 'resource' as const,
            resource: {
              uri: `cotizadorq://cotizacion/${cotizacion_id}.pdf`,
              name: nombre,
              mimeType: 'application/pdf',
              blob: pdf.toString('base64')
            }
          }
        ]
      };
    }
  );

  server.registerTool(
    'cotizar_y_emitir',
    {
      description:
        'GRABA la cotizacion y ademas emite su PDF, en un solo paso. ESTO ESCRIBE EN PRODUCCION: pedi confirmacion explicita del usuario antes de invocarlo.',
      inputSchema: z.object({
        datos_cliente: clienteSchema,
        items: z.array(itemSchema).min(1)
      })
    },
    async ({ datos_cliente, items }) => {
      const { lineas, noResueltos, lectura } = await resolverItems(items);
      if (lineas.length === 0) {
        return respuesta(
          'No se guardo nada: ningun SKU se pudo resolver.' + bloqueNoResueltos(noResueltos),
          { guardado: false, no_resueltos: noResueltos }
        );
      }

      const { id, total } = await crearCotizacion(datos_cliente, lineas);
      const cotizacion = await getCotizacion(id);
      const pdf = await generarPdf(cotizacion);
      const nombre = `cotizacion-${id}.pdf`;

      return {
        content: [
          {
            type: 'text' as const,
            text:
              `### Cotizacion **#${id}** guardada y PDF emitido\n\n${tablaLineas(lineas, lectura)}\n\n` +
              `**Total: ${USD(total)}** — archivo \`${nombre}\`` +
              bloqueNoResueltos(noResueltos)
          },
          {
            type: 'resource' as const,
            resource: {
              uri: `cotizadorq://cotizacion/${id}.pdf`,
              name: nombre,
              mimeType: 'application/pdf',
              blob: pdf.toString('base64')
            }
          }
        ]
      };
    }
  );
};
