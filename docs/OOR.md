# OOR: cambios del reporte de Axis cruzados con las BO

El dueño reemplaza cada ~2 días la pestaña **OOR** de la planilla maestra (reporte de órdenes
abiertas de Axis). Axis suele atrasar las fechas de entrega, y eso descuadra el mes y la semana de
facturación que él ya configuró en cada BO. La app guarda cada versión distinta del OOR, la compara
con la última que el dueño dio por revisada y le muestra un pop-up con lo que cambió, agrupado por BO.

Código: `backend/src/oor/` (`comparar.js` es la lógica pura de lectura, comparación y cruce;
`servicio.js` decide cuándo guardar y cuándo anunciar; `repositorio.js` es el SQL; `rutas.js` el
router). Los tests usan `backend/tests/helpers/oorMemoria.js` en lugar de la base.

## Tablas (`esquema.js`, idempotente, se aplica al arrancar)

- `oor_snapshots`: una fila por cada versión **distinta** del OOR que la app ha visto
  (`huella` = hash del contenido que importa; `lineas` y `avisos` en JSONB).
- `oor_revisiones`: cada vez que el dueño da por revisado un cambio (`automatica = false`), o la app
  avanza la base sola (`automatica = true`: base inicial, o cambios que solo tocaron líneas cerradas).
  Son globales, no por usuario.

Limpieza al guardar una versión nueva: se conservan los 10 snapshots más recientes y los que alguna
revisión referencia; se conservan solo las 60 revisiones más recientes.

## Cuándo se toma nota del OOR

- Cada vez que se lee `GET /api/oso/orders` (de pasada, sin esperar y sin afectar la respuesta; un fallo
  queda en el log).
- Cuando el dueño aprieta **«Actualizar OOR»**: `POST /api/oor/actualizar` lee la pestaña en ese momento.
- `GET /api/oor/cambios/pendiente` NO lee la planilla: solo mira la base.
- Un OOR sin líneas (la pestaña vacía un instante mientras se reemplaza) **nunca** se guarda.
  Una versión con la misma huella que la última tampoco.

## Rutas (admin; `/api/oor`)

| Ruta | Respuesta |
| --- | --- |
| `GET /cambios/pendiente` | solo base de datos; ver abajo |
| `POST /actualizar` | lee la pestaña OOR ahora y devuelve lo pendiente sin esperar la estabilidad; ver abajo |
| `POST /cambios/visto` `{ hasta_id }` | `{ ok: true, revision_id }`. Idempotente. 400 si `hasta_id` no existe o es anterior a la base |
| `GET /cambios/historial?limite=` | `{ items: [{ id, visto_en, desde: {id, tomado_en} \| null, hasta: {id, tomado_en}, resumen }] }`, más reciente primero, solo revisiones no automáticas |
| `GET /cambios/revisiones/:id` | igual que un pendiente con `hay: true` más `visto_en`, recalculado desde los dos snapshots. 404 si no existe |

Errores: `{ error }` en español (400 validación, 404, 500 genérico).

`GET /cambios/pendiente`:

- `{ hay: false, motivo }` con `motivo` = `sin_datos` | `primera_vez` | `sin_cambios` | `estabilizando` (más `revisar_en_seg`).
- `{ hay: true, desde: {id, tomado_en}, hasta: {id, tomado_en}, resumen, grupos, sinBo, avisos }`.

`POST /actualizar` (acción explícita del botón, por eso aquí los fallos sí se informan):

- Mismo contrato que el pendiente (`hay: true` con `desde`, `hasta`, `resumen`, `grupos`, `sinBo`, `avisos`, o
  `{ hay: false, motivo }` con `sin_cambios` | `primera_vez` | `sin_datos`; nunca `estabilizando`), más
  `lineas`: cuántas líneas se leyeron del OOR.
- Pestaña vacía o sin "Order No": 200 `{ hay: false, motivo: 'sin_datos', lineas: 0, avisos }`; no se guarda nada.
- Planilla no configurada: 400 `{ error: 'La planilla maestra no está configurada' }`.
- Google falla: 502 `{ error: 'No se pudo leer la pestaña OOR de la planilla' }` (y queda en el log).

`grupos`, `sinBo` y `resumen` son la salida de `cruzarConBo` (ver `comparar.js` y su test). Fechas
`YYYY-MM-DD` o null; `tomado_en` y `visto_en` en ISO 8601.

## Reglas

- **Primera vez**: sin ninguna revisión no hay con qué comparar; se crea una revisión automática sobre la
  última versión y no se muestra nada.
- **Base** = `hasta` de la última revisión. **Vigente** = el último snapshot. Si son la misma versión (o la
  misma huella): `sin_cambios`.
- **Estabilidad** (solo `GET /cambios/pendiente`): si el snapshot vigente tiene menos de 90 s, `estabilizando`
  con `revisar_en_seg` (lo que falta, mínimo 15). Los snapshots también se registran de pasada al abrir
  Órdenes, y el dueño pega la pestaña en uno o dos pasos: no se anuncia nada hasta que la versión lleve 90 s
  sin cambiar. `POST /actualizar` no espera (opción `sinEspera` del servicio): el dueño lo aprieta cuando
  terminó de pegar.
- Si la comparación no da cambios (p. ej. solo cambiaron líneas cerradas) la base avanza sola y no se avisa.
- Dos cambios seguidos sin revisar se informan **juntos** (base → vigente). `POST /visto` con un
  `hasta_id` intermedio deja pendiente solo lo que vino después.

## Cruce con las BO

El vínculo es `bo_meta.po_axis` (lo escribe el dueño en la app) = columna "Customer PO No" del OOR; un
BO puede llevar varias PO separadas por coma, espacio o `/`. Se usan las BO no eliminadas, no facturadas
y con `po_axis` no vacío. El mes de facturación llega como `YYYY-MM`: `estimated_invoice_month`, o si está
vacío, el mes de `estimated_invoice_date` (misma regla que `normalizarMesFacturacion` del frontend).
Por BO: la fecha de despacho más tardía de sus líneas abiertas (antes y ahora), ETA = despacho + 15 días
(`DIAS_A_ETA`), días movidos, y `facturacion.afectada` = la nueva ETA cae en un mes posterior al
configurado. Los cambios de una PO sin BO van en `sinBo`.

Fechas: la planilla mezcla fechas reales (número de serie) y texto día-mes-año (`10-12-2026` es 10 de
diciembre); `parsearFecha` lo resuelve y también lo usa la vista de Órdenes (`plannedShipDate`).
