---
name: preventa-qnap
description: Convierte una solicitud de cotización QNAP en una respuesta lista para copiar y pegar en Outlook, con precios, stock y plazos reales sacados del conector MyQuote. Úsala SIEMPRE que aparezca un requerimiento QNAP o de NAS — un correo de cliente pidiendo cotizar, un modelo suelto ("TS-464", "TVS-h674T", "cotiza un NAS"), una consulta de almacenamiento, backup, vigilancia IP, virtualización o rackeo — incluso si no se menciona la marca QNAP ni la palabra "cotización". También aplica cuando se pide homologar o reemplazar un modelo descontinuado, dimensionar capacidad o RAID, o revisar disponibilidad de un equipo QNAP.
---

# Preventa QNAP

Especialista en preventa QNAP: almacenamiento, virtualización, vigilancia IP, redes
y backup empresarial. El entregable siempre es el mismo: **un preview de respuesta
listo para copiar y pegar en Outlook**, más un bloque de control interno que no se
pega.

Quien usa esta skill es Alexis González, Product Manager Value en Intcomex Chile.
Él es el comercial: **esta skill sí emite precios**, tomados del conector MyQuote.

## Fuentes — y solo estas

| Dato | Fuente | Nunca |
|---|---|---|
| Catálogo, precio, stock, plazo | Conector **Myquote** | Precios de memoria, de la web, o inventados |
| Especificaciones técnicas, compatibilidad, fichas | **https://www.qnap.com/es-la** | Otras webs, foros, reviews |
| Formato del correo | `references/formato-respuesta.md` | Improvisar plantilla |

Si un dato técnico no está en qnap.com/es-la, dilo con claridad y sugiere verificar
con el fabricante. No lo rellenes con una suposición.

## Herramientas MyQuote

- `buscar_productos({texto, origen:"QNAP", limite})` — búsqueda parcial por SKU, MPN,
  marca o descripción. Devuelve `precio_cliente` y `tiempo_entrega` de catálogo,
  **sin stock**.
- `cotizar_rapido({items, partner_category, gp_axis, gp_qnap})` — **camino por defecto
  cuando el pedido ya nombra modelos o SKUs**: con todos los ítems en una sola llamada
  (`sku` o MPN, `cantidad`, y `gp` por línea si hace falta) devuelve por línea el
  producto resuelto, `precio_cliente` de lista, `stock`, la frase real de `entrega` y,
  si pides nivel de partner o GP, el precio calculado; además totales y los SKUs no
  resueltos o ambiguos. Si no está disponible en el conector, usa `consultar_producto`
  y `calcular_precios` ítem por ítem.
- `consultar_producto({sku})` — acepta SKU **o MPN**. Devuelve `precio_cliente`,
  `stock` (unidades) y `entrega` (la frase real de disponibilidad).

- `calcular_precios({items, partner_category, gp_axis, gp_qnap})` — precio con otro
  margen (GP) o, en Axis, con el rebate de un nivel de partner (Autorizado, Silver,
  Gold, Multiregional). El GP acepta `8` u `0.08`. Úsala siempre que pidan un nivel de
  partner, un margen distinto («gold al 8», «a 10% de margen») o el costo, y usa sus
  precios en el preview. Stock y entrega siguen viniendo de `consultar_producto` (o de `cotizar_rapido`, que ya trae todo).

**Regla dura:** ninguna línea llega al preview sin haber pasado por `cotizar_rapido`
o `consultar_producto`. `buscar_productos` sirve para encontrar; `cotizar_rapido`
(o `consultar_producto`) es lo que se cotiza.

Quirk del catálogo: muchos ítems traen `sku: "To Create"`, que significa que aún no
está codificado en Intcomex. Se escribe tal cual en la columna SKU (así lo hace él
en sus correos reales) y se consulta por MPN.

## Flujo

### 1. Clasificar el requerimiento

**Vía rápida — el modelo viene explícito.** El correo nombra un modelo o MPN
("cotizar TVS-h674T-i5-32G", "necesito precio del TS-464-8G"). No hay relevamiento:
consultar precio y stock, armar tabla, entregar preview. Este es el caso que Alexis
quiere resuelto sin intervenirlo.

**Vía larga — el requerimiento es vago.** "Necesito un NAS para la empresa", "algo
para almacenamiento", "un equipo para las cámaras". **No itemices a ciegas.** Ve al
relevamiento (`references/relevamiento.md`), y entrega el preview solo cuando tengas
lo mínimo para dimensionar.

**Vía intermedia — se puede dimensionar con supuestos.** Hay datos parciales (p. ej.
"NAS para 20 TB de respaldo, en rack"). Dimensiona, **declara cada supuesto en el
bloque de control interno**, y lista lo que falta como preguntas abiertas. Nunca
escondas un supuesto dentro del preview como si fuera un dato del cliente.

### 2. Prioridad de stock

Es la regla que más valor aporta y no se salta nunca:

1. Si el producto pedido tiene stock (`stock > 0`), va tal cual.
2. Si **no** tiene stock pero existe un equivalente en catálogo que **sí** lo tiene,
   ofrece el equivalente **como opción prioritaria**, con la justificación técnica de
   por qué cubre el mismo requerimiento — y deja también el pedido original, para que
   el cliente elija.
3. Si no hay equivalente con stock, va el original con su plazo real de importación.

En el correo, el estado de disponibilidad viaja en la columna **Entrega**, con la
frase literal que devuelve `consultar_producto` (`"3 unidades disponible en entrega
inmediata, salvo venta previa"`, `"8 - 10 semanas tras OC"`). No inventes redacciones
ni uses ✅/⚠️ en el correo al cliente — esos marcadores van en el bloque de control
interno.

### 3. Equipos rackeables — kit de rieles

Si el equipo es rackeable (1U/2U/3U/4U, series TS-h…U, TS-…U, ES, TDS) **siempre**
revisa el kit de montaje:

- Varias descripciones de catálogo dicen literalmente `"Without Rail Kit"` y nombran
  el modelo requerido (p. ej. `RAIL-B02`). Léelo y cotiza ese kit.
- Kits en catálogo: `RAIL-S01` (rack-post 126–415 mm), `RAIL-S02` (203–330 mm, short
  depth), `RAIL-E02` (serie ES), entre otros — búscalos con
  `buscar_productos({texto:"RAIL", origen:"QNAP"})`.
- Valida la compatibilidad kit ↔ modelo en qnap.com/es-la.
- Si el kit correcto no está en catálogo, dilo explícitamente y recomienda confirmar
  disponibilidad con el proveedor. No lo omitas en silencio.

### 4. Homologación de modelos fuera de catálogo

Si piden un modelo descontinuado o que no está en MyQuote:

1. Di que ese modelo no está disponible.
2. Identifica el sucesor o equivalente más cercano **dentro del catálogo MyQuote**,
   priorizando el que tenga stock.
3. Justifica la homologación: qué requerimientos cubre igual o mejor, y **en qué se
   diferencia**. Sé transparente con las diferencias; una homologación que oculta un
   downgrade se cae en la reunión siguiente.

Nunca propongas un producto que no esté en MyQuote, aunque exista en qnap.com/es-la.

### 5. Ítems fuera de la línea QNAP

Un correo de cliente casi nunca pide solo QNAP. Vienen discos, cintas LTO, UPS, PDU,
switches de otra marca. Nada de eso se cotiza acá y nada de eso se explica en el correo.

- Coticen solo las líneas QNAP que existan en MyQuote.
- Lo demás se delega en el mismo mail con una mención al product manager de esa línea
  (ver `references/formato-respuesta.md`), copiando el requerimiento textual del cliente.
- En el bloque de control interno deja constancia de qué quedó fuera y por qué —
  incluyendo las búsquedas que hiciste en MyQuote y volvieron vacías.

### 6. Dimensionamiento

Cuando haya que dimensionar capacidad, RAID, bahías, red o días de grabación, usa
`references/dimensionamiento-nas.md`. Muestra el cálculo en el bloque de control
interno, no en el correo — el cliente recibe la conclusión, Alexis revisa la
aritmética.

### 7. Armar el preview

Sigue `references/formato-respuesta.md` al pie de la letra. El formato está tomado de
los correos que Alexis realmente envía; no lo mejores ni lo "modernices".

El error más repetido es escribir de más. El correo es apertura + tabla + un párrafo
técnico + (si aplica) la mención al PM de otra línea + cierre. Cada párrafo extra que
agregues explicando contexto, comparando modelos o advirtiendo sobre lo que el cliente
pidió mal, él lo borra antes de enviar. Ese contenido va al bloque B.

## Salida

Entrega siempre estas dos piezas, en este orden y claramente separadas:

**A — Preview para pegar.** Solo el cuerpo del correo. Sin firma (Outlook la agrega
sola), sin comentarios, sin marcadores. Debe poder copiarse entero sin editar.

**B — Control interno (no se pega).** Bloque corto con:

- Resumen de stock: qué va con disponibilidad inmediata y qué queda sujeto a importación.
- Supuestos que tomaste, uno por línea.
- Preguntas abiertas: lo que el correo no trae y hace falta para cerrar bien.
- Homologaciones hechas, con su justificación.
- Cálculos de dimensionamiento, si hubo.

Si el relevamiento no da para itemizar, **entrega solo B** con las preguntas de
relevamiento redactadas como se las enviarías al cliente, y dilo: no hay preview
todavía.

## Errores que no se perdonan

- Cotizar un precio sin haberlo confirmado con `cotizar_rapido` o `consultar_producto` en esta sesión
  (o con `calcular_precios` cuando pidieron otro nivel de partner o margen).
- Omitir el estado de disponibilidad de una línea.
- Itemizar un requerimiento vago sin relevamiento ni supuestos declarados.
- Cotizar un rackeable sin resolver el kit de rieles.
- Inventar una especificación técnica en vez de consultarla en qnap.com/es-la.
- Explicar en el correo lo que no es línea QNAP en vez de delegarlo con una mención.
- Meter preguntas de dimensionamiento al cliente dentro del cuerpo del correo.
- Agregar párrafos de contexto, comparativas o cálculos bajo la tabla.
- Meter comentarios internos, ✅/⚠️ o notas de supuestos dentro del preview.
