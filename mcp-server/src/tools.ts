import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  crearCotizacion,
  generarPdf,
  getCatalogo,
  getCotizacion,
  getStock,
  buscarProductoTolerante,
  resolverItems,
  type LineaResuelta,
  type SkuNoResuelto
} from './cotizador.js';

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

const tablaLineas = (lineas: LineaResuelta[]): string => {
  if (lineas.length === 0) return '_Sin lineas resueltas._';
  const filas = lineas.map((l) => {
    const stock = l.stock === null || l.stock === '' ? 's/d' : String(l.stock);
    const marca = MARCA_COINCIDENCIA[l.coincidencia] ?? '';
    return `| ${l.producto.sku}${marca} | ${l.producto.descripcion.slice(0, 45)} | ${l.cantidad} | ${USD(l.precio_unitario)} | ${USD(l.precio_total)} | ${stock} | ${l.producto.tiempo_entrega || 's/d'} |`;
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
    ].join('\n') + nota
  );
};

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
        'Consulta precio, stock y plazo de entrega de un producto por SKU o MPN. Solo lectura.',
      inputSchema: z.object({ sku: z.string().describe('SKU o MPN a consultar') })
    },
    async ({ sku }) => {
      const [catalogo, stock] = await Promise.all([getCatalogo(), getStock()]);
      const { producto, tipo, candidatos } = buscarProductoTolerante(catalogo, sku);

      if (!producto) {
        // Con varios candidatos no se elige uno: se muestran para que decida
        // el usuario. Elegir "el mas parecido" en codigos de producto pondria
        // el articulo equivocado en una cotizacion real.
        if (candidatos.length > 0) {
          const filas = candidatos.map(
            (c) => `| ${c.sku} | ${c.mpn} | ${c.descripcion.slice(0, 45)} | ${USD(c.precio_cliente)} |`
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

      const cantidad = stock.get(String(producto.mpn || '').trim().toUpperCase()) ?? null;
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
        stock: cantidad,
        tiempo_entrega: producto.tiempo_entrega
      };

      const aviso =
        tipo === 'exacta'
          ? ''
          : `\n\n⚠️ Coincidencia **${tipo}**, no exacta: buscaste \`${sku}\`. Verifica que sea el producto correcto.`;

      const texto =
        `**${producto.sku}** — ${producto.descripcion}\n` +
        `- Marca: ${producto.marca} (${producto.origen})\n` +
        `- MPN: ${producto.mpn}\n` +
        `- Precio: ${USD(producto.precio_cliente)}\n` +
        `- Stock: ${cantidad === null || cantidad === '' ? 'sin dato' : cantidad}\n` +
        `- Entrega: ${producto.tiempo_entrega || 'sin dato'}` + aviso;

      return respuesta(texto, datos);
    }
  );

  server.registerTool(
    'buscar_productos',
    {
      description:
        'Busca productos del catalogo por texto parcial en SKU, MPN, marca o descripcion. Usalo cuando no sepas el SKU exacto, o para explorar que hay disponible. Solo lectura.',
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
      const busqueda = String(texto || '').trim().toLowerCase();

      const filtrados = catalogo.filter((p) => {
        if (origen && String(p.origen || '').toUpperCase() !== origen) return false;
        if (!busqueda) return true;
        return [p.sku, p.mpn, p.marca, p.descripcion]
          .map((campo) => String(campo || '').toLowerCase())
          .some((campo) => campo.includes(busqueda));
      });

      const pagina = filtrados.slice(0, limite);
      const datos = {
        total_catalogo: catalogo.length,
        coincidencias: filtrados.length,
        mostrados: pagina.length,
        productos: pagina.map((p) => ({
          sku: p.sku,
          mpn: p.mpn,
          marca: p.marca,
          origen: p.origen,
          descripcion: p.descripcion,
          precio_cliente: p.precio_cliente,
          tiempo_entrega: p.tiempo_entrega
        }))
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

      const filas = pagina.map(
        (p) =>
          `| ${p.sku} | ${p.mpn} | ${p.marca} | ${p.descripcion.slice(0, 40)} | ${USD(p.precio_cliente)} |`
      );
      const texto_salida = [
        `**${filtrados.length}** coincidencias de ${catalogo.length} productos (mostrando ${pagina.length}):`,
        '',
        '| SKU | MPN | Marca | Descripcion | Precio |',
        '|---|---|---|---|---|',
        ...filas
      ].join('\n');

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
      const { lineas, noResueltos, total } = await resolverItems(items);
      const texto =
        `### Simulacion (NO guardada)\n\n${tablaLineas(lineas)}\n\n**Total: ${USD(total)}**` +
        bloqueNoResueltos(noResueltos);

      return respuesta(texto, {
        guardado: false,
        cliente: datos_cliente || null,
        lineas: lineas.map((l) => ({
          producto_id: l.producto.id,
          sku: l.producto.sku,
          descripcion: l.producto.descripcion,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          precio_total: l.precio_total,
          stock: l.stock,
          tiempo_entrega: l.producto.tiempo_entrega
        })),
        no_resueltos: noResueltos,
        total
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
      const { lineas, noResueltos, total } = await resolverItems(items);
      if (lineas.length === 0) {
        return respuesta(
          'No se guardo nada: ningun SKU se pudo resolver contra el catalogo.' +
            bloqueNoResueltos(noResueltos),
          { guardado: false, no_resueltos: noResueltos }
        );
      }

      const { id, total: totalBackend } = await crearCotizacion(datos_cliente, lineas);

      const texto =
        `### Cotizacion **#${id}** guardada\n\n${tablaLineas(lineas)}\n\n` +
        `**Total segun el backend: ${USD(totalBackend)}** (estimado local: ${USD(total)})` +
        bloqueNoResueltos(noResueltos);

      return respuesta(texto, {
        guardado: true,
        cotizacion_id: id,
        total: totalBackend,
        total_estimado_local: total,
        no_resueltos: noResueltos
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
      const { lineas, noResueltos } = await resolverItems(items);
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
              `### Cotizacion **#${id}** guardada y PDF emitido\n\n${tablaLineas(lineas)}\n\n` +
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
