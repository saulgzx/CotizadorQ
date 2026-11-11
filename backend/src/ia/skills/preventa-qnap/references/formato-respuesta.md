# Formato de la respuesta

Extraído de correos que Alexis realmente envió. Respétalo tal cual: los clientes ya
reconocen este formato y cualquier "mejora" lo hace ver como si lo hubiera escrito
otra persona.

## Estructura del cuerpo

```
{Nombre}.
                {línea de apertura}

{TABLA}

Quedo atento
Saludos
```

Detalles que importan:

1. **Primera línea**: el nombre de pila del contacto seguido de punto. `Andrea.`
   Cuando responde a un KAM o a alguien de la casa, usa `Hola {Nombre}.` — es su
   variante por defecto en hilos internos. Si el correo entrante saluda con "Estimado"
   o es un contacto nuevo, también `Hola {Nombre}.`
2. **Segunda línea**: va sangrada con espacios (así queda en su plantilla de Outlook).
   Variantes reales que él usa, elige la que calce con el tono del correo entrante:
   - `Buen día, adjunto cotización solicitada.`
   - `Espero te encuentres excelente.`
   - `De mi lado:` (cuando responde dentro de un hilo interno ya en curso — es lo que
     va cuando el correo entrante viene de un KAM reenviando el pedido del cliente)
3. **Línea en blanco**, luego la tabla.
4. **Cierre**: `Quedo atento` y `Saludos` en líneas separadas. Sin coma, sin nombre.
5. **Sin firma.** Outlook agrega la firma corporativa automáticamente. Si la escribes,
   sale duplicada.

## Tabla

Ocho columnas, en este orden exacto:

| Marca | Cant. | SKU | MPN | Descripción | P. Unit. | P. Total | Entrega |
|---|---|---|---|---|---|---|---|

- **Marca** — `QNAP` o `Axis`, como venga en el catálogo.
- **Cant.** — entero.
- **SKU** — el SKU de Intcomex. Si el catálogo devuelve `"To Create"`, escribe
  `To Create` literalmente; significa que aún no está codificado.
- **MPN** — el part number del fabricante.
- **Descripción** — el campo `descripcion` de MyQuote **sin editar**. En Axis viene
  corto y en mayúsculas (`AXIS P1475-LE`); en QNAP viene largo y técnico. Los dos
  formatos son correctos porque los dos salen del catálogo.
- **P. Unit.** — `$1,234.56`. USD, dos decimales, separador de miles con coma.
- **P. Total** — unitario × cantidad, **en negrita**.
- **Entrega** — la frase literal de `consultar_producto`. Ejemplos reales:
  - `Stock entrega inmediata, salvo venta previa`
  - `3 unidades disponible en entrega inmediata, salvo venta previa`
  - `8 - 10 semanas tras OC`
  - `6 semanas tras OC`
  - `en tránsito (segunda semana sept)`

No hay fila de total general en sus correos. Si la cotización tiene muchas líneas y
un total ayuda, propónselo — no lo agregues por tu cuenta.

## La tabla siempre llega encuadrada, nunca como texto

La cotización se entrega siempre en formato de tabla, lista para pegar en Outlook, sin
preguntarle a Alexis si la quiere así. Cómo se consigue depende del canal:

- **Dentro de MyQuote (tab Asistente IA) y en Claude Code:** escribe la tabla como
  tabla Markdown. MyQuote la pinta encuadrada en pantalla y el botón «Copiar preview
  para Outlook» la convierte al HTML con bordes al copiar. **No escribas HTML crudo ni
  envuelvas el preview en un bloque de código:** se vería como código y se rompe la
  lectura automática de SKUs.
- **Cuando te pidan el HTML directo** (o entregues fuera de MyQuote, donde no hay botón
  de copiar), entrega el HTML armado con el estilo de abajo.
- **WhatsApp es la única excepción**: no muestra tablas. Ahí va una línea por producto,
  como indique el canal.

### Estilo HTML

Usa exactamente este estilo — es el que produce su plantilla:

- Tabla: `width:648pt; background:white; border-collapse:collapse`
- Bordes de celda: `solid #E5E7EB 1pt`
- Fondo del encabezado: `#F3F4F6`, texto en negrita
- Filas alternas (2ª, 4ª, …): fondo `#F9FAFB`
- Padding de celda: `.75pt`
- La celda de P. Total va en `<b>`

Outlook rechaza etiquetas fuera de su lista blanca. Usa solo `p`, `b`, `table`, `tr`,
`td`, `th`, `thead`, `tbody`, `br`, `ul`, `li`, `a`. Nada de `span`, `div` con estilo,
`img` ni `blockquote`.

## Cuánto texto va bajo la tabla

Casi nada. **No hay párrafo técnico.** El correo es apertura + tabla + cierre, y entre
la tabla y el cierre solo pueden aparecer estas líneas, cada una de una sola oración y
solo si aplica:

1. La línea de alternativa por stock (ver más abajo).
2. La línea del accesorio obligatorio que no se cotiza, con el porqué.
3. La @mención al PM de otra línea.
4. La nota de stock corto, cuando queda poco inventario:
   `Solo quedan {n}u, por lo que conviene reservarlas con la OC.`

Nada de recitar specs, capacidad útil, RAID ni casos de uso: eso ya está en la columna
Descripción y en el precio. Todo lo que quieras explicar va al bloque de control
interno. Alexis borra sistemáticamente los párrafos de contexto: comparativas, cálculos
de capacidad, advertencias sobre lo que el cliente pidió mal. Si el dato importa, se lo
dices a él en el bloque B y él decide si lo conversa aparte.

Garantía, fichas técnicas y links **no van** salvo que el cliente los haya pedido
explícitamente en su correo. Si los pidió, la garantía se valida antes en la fuente
oficial del fabricante para ese modelo exacto; si no se puede verificar, no se escribe
y se pregunta en el bloque B.

## Cuando hay dos opciones

Por defecto va **una sola opción por requerimiento: la que tiene stock**.

Cuando las dos son legítimas (dos modelos que cubren el requerimiento por caminos
distintos), van **las dos en la tabla**, en filas consecutivas, **sin párrafo
comparativo debajo**. La tabla habla sola; el análisis de por qué una u otra va al
bloque de control interno.

Lo que NO se hace: agregar una fila de gama superior que el cliente no pidió, "por si
acaso". Eso él lo borra.

### Alternativa por stock

Es la única comparación que sí va en el correo, y en **una** línea bajo la tabla, antes
de `Quedo atento`:

```
El {modelo pedido} queda sujeto a importación. Si el plazo es crítico, el
{modelo alternativo} está disponible en bodega y cubre {el requerimiento}; la
diferencia está en {diferencia concreta}.
```

## Ítems fuera de la línea QNAP

Cuando el pedido incluye cosas que no son línea QNAP (discos, cintas LTO, UPS, PDU,
switches de otra marca), **no las expliques en el cuerpo del correo**. Se delegan en el
mismo mail con una mención directa al product manager de esa línea:

```
@{Nombre PM} favor me ayudas con precios de {el requerimiento textual del cliente}.
```

Ejemplo real: `@Fernando Rojas Escalona favor me ayudas con precios de 4HDD de 4TB`.

A quién mencionar:

| Categoría | PM | Correo |
|---|---|---|
| Discos Seagate, SSD, RAM | **Fernando Rojas Escalona** | frojas@intcomex.com |
| Discos WD | **Cristian Muñoz** | cmunoz@intcomex.com |

Si el cliente tiene que elegir de una lista de compatibles, manda el link del fabricante
y cierra con `Cotizar la que necesiten con @Fernando Rojas Escalona`.

**Synology no se delega nunca**: no existe PM de esa marca en Intcomex.

Va en una línea, antes de `Quedo atento`. Nada de "esto no es línea QNAP" ni "lo derivo
a la línea correspondiente" — la mención ya lo dice.

Si de verdad no sabes a qué PM mencionar, deja el placeholder `@` y anótalo en el
bloque de control interno como pregunta abierta.

## Cuando falta un dato para cotizar un accesorio

Se pide explícito y se cierra ahí. No prometas agregarlo después:

```
Para cotizar desde QNAP {el accesorio} necesito saber {los datos}, quedo atento a
dicha información para cotizar.
```

## Nada de preguntas al cliente dentro del correo

Las preguntas de dimensionamiento (capacidad, RAID, discos, crecimiento) no van en el
cuerpo. Van al bloque de control interno para que Alexis las maneje aparte. La única
excepción es la de arriba: el dato puntual que bloquea una línea de la cotización.

Concreto y sin adornos. Nada de "excelente opción" ni "solución ideal".
