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
   También aparece como `Hola Aida.` cuando la relación es más cercana. Si el correo
   entrante saluda con "Estimado" o es un contacto nuevo, usa `Hola {Nombre}.`
2. **Segunda línea**: va sangrada con espacios (así queda en su plantilla de Outlook).
   Variantes reales que él usa, elige la que calce con el tono del correo entrante:
   - `Buen día, adjunto cotización solicitada.`
   - `Espero te encuentres excelente.`
   - `De mi lado:` (cuando responde dentro de un hilo interno ya en curso)
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

## Versión HTML

Cuando entregues HTML para pegar en Outlook, usa exactamente este estilo — es el que
produce su plantilla:

- Tabla: `width:648pt; background:white; border-collapse:collapse`
- Bordes de celda: `solid #E5E7EB 1pt`
- Fondo del encabezado: `#F3F4F6`, texto en negrita
- Filas alternas (2ª, 4ª, …): fondo `#F9FAFB`
- Padding de celda: `.75pt`
- La celda de P. Total va en `<b>`

Outlook rechaza etiquetas fuera de su lista blanca. Usa solo `p`, `b`, `table`, `tr`,
`td`, `th`, `thead`, `tbody`, `br`, `ul`, `li`, `a`. Nada de `span`, `div` con estilo,
`img` ni `blockquote`.

## Cuando hay alternativa por stock

El pedido original y la alternativa van **los dos en la tabla**, en filas consecutivas,
y la diferencia se explica en una línea de texto bajo la tabla, antes de `Quedo atento`:

```
El {modelo pedido} queda sujeto a importación. Si el plazo es crítico, el
{modelo alternativo} está disponible en bodega y cubre {el requerimiento}; la
diferencia está en {diferencia concreta}.
```

Concreto y sin adornos. Nada de "excelente opción" ni "solución ideal".
