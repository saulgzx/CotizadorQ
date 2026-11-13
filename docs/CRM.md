# CRM de MyQuote (etapas A y B)

Empresas, contactos, oportunidades y embudo dentro de MyQuote, alimentados por las
cotizaciones: las existentes por migración y las nuevas por enlace automático.

- Código: `backend/src/crm/` (`normalizar.js`, `reglas.js`, `repositorio.js`, `enlace.js`,
  `esquema.js`, `rutas.js`, `index.js`). En `legacyRoutes.js` solo hay enganches: montaje del
  router, enlace en `POST /api/cotizaciones`, cambio de etapa en
  `PATCH /api/cotizaciones/:id/estado` (y en `PUT /api/cotizaciones/:id` si trae `estado`), archivado
  (`/api/cotizaciones/archivar`, `/archivar/previa`, `/restaurar`), columnas `etapa`/`motivo_perdida`
  en el listado y el detalle de cotizaciones, e `iniciarCrm(pool)` en el arranque.
- **La etapa de la oportunidad es la única fuente de verdad del estado comercial.**
  `cotizaciones.estado` se conserva como valor DERIVADO de esa etapa, por compatibilidad (compras,
  dashboard, MCP, agente). Ver "Estado y etapa" más abajo.
- Tests: `backend/tests/crm.*.test.js`. `crm.postgres.test.js` prueba el SQL contra un
  PostgreSQL real y solo corre con `CRM_TEST_DATABASE_URL` (ver al final).

## Contrato v1 (copia del acordado con el frontend)

Usuario único: el CRM es solo para admin (`authenticateToken` + `requireAdmin`). Prefijo `/api/crm`.
Montos en USD con 2 decimales (number). Fechas ISO 8601. Errores: `{ error: string }` con 400/404/409.

## Modelo de datos (PostgreSQL)

- `crm_empresas`: id, nombre (texto visible), nombre_normalizado (único), rut (nullable), sitio (nullable),
  notas (nullable), archivada (bool, default false), created_at, updated_at.
- `crm_contactos`: id, empresa_id (FK, cascade), nombre, email (nullable), telefono (nullable), cargo (nullable),
  notas (nullable), archivado (bool), created_at, updated_at. Un email no se repite dentro de la misma empresa
  (comparado en minúsculas).
- `crm_oportunidades`: id, empresa_id (FK), contacto_id (FK nullable, set null), titulo, etapa
  (`nueva` | `cotizada` | `negociacion` | `ganada` | `perdida`), marca (`AXIS` | `QNAP` | `MIXTA` | null),
  es_proyecto (bool), monto_manual (nullable), bo (nullable, único parcial: el BO de la orden OSO que
  ganó esta oportunidad), fecha_cierre_estimada (date nullable), motivo_perdida (nullable),
  etapa_desde (timestamp: cuándo entró a la etapa actual), cerrada_en (nullable), archivada_en (nullable),
  created_at, updated_at.
- `cotizaciones`: columnas nuevas nullable `empresa_id`, `contacto_id`, `oportunidad_id` y `archivada_en`.

Monto de una oportunidad: `monto_manual` si existe; si no, el `total` de la cotización vinculada más reciente
(prefiriendo las no archivadas); si no hay, 0.

Normalización de nombre de empresa: minúsculas, sin tildes, sin puntuación, espacios colapsados y sin sufijos
legales al final (`s a`, `sa`, `spa`, `ltda`, `limitada`, `eirl`, `s a c`, `inc`, `llc`, `cia`). Ejemplo:
"SONDA S.A." y "Sonda SA" → `sonda`.

## Estado y etapa (equivalencias)

Un solo lugar: `backend/src/crm/normalizar.js` (`ETAPA_POR_ESTADO`, `ESTADO_POR_ETAPA`,
`etapaDesdeEstado`, `estadoDesdeEtapa` y sus versiones SQL `etapaDesdeEstadoSql` /
`estadoDesdeEtapaSql`). Las 5 etapas (`nueva`, `cotizada`, `negociacion` abiertas; `ganada`,
`perdida` cerradas) se usan en todas partes.

| estado → etapa | | etapa → estado | |
|---|---|---|---|
| `revision`, `pendiente`, null u otro | `nueva` | `nueva` | `revision` |
| `enviada` | `cotizada` | `cotizada` | `enviada` |
| `aprobada` | `ganada` | `negociacion` | `enviada` |
| `rechazada` | `perdida` | `ganada` | `aprobada` |
| | | `perdida` | `rechazada` |

- Una cotización nueva (estado `revision`) crea su oportunidad en etapa **`nueva`** (antes `cotizada`).
  La migración inicial usa la misma tabla (`rechazada` → motivo "Rechazada (migrado)").
- **Sincronización etapa → estado.** Siempre que cambia la etapa de una oportunidad se ejecuta
  `repositorio.derivarEstadoCotizaciones(db, oportunidadId)`:
  `UPDATE cotizaciones SET estado = <derivado de la etapa actual> WHERE oportunidad_id = $1`. Lo llaman:
  `PATCH /api/crm/oportunidades/:id` (si cambia la etapa, en su transacción),
  `POST /api/crm/oportunidades/:id/cotizaciones` y el enlace a una oportunidad existente (la
  cotización entra con el estado de la etapa), `PATCH /api/cotizaciones/:id/estado` y `PUT
  /api/cotizaciones/:id` con `estado` (en su transacción), y el seguimiento automático
  (`crmAdaptador.cambiarEtapa`, sin transacción: best-effort con `enlace.derivarEstadoSinFallar`, un fallo
  se registra como `crm_estado_error` y no deshace el cambio de etapa).
- Datos anteriores a este cambio no se reescriben: oportunidades migradas como `cotizada` desde
  cotizaciones en `revision` siguen así hasta su próximo cambio de etapa (el listado muestra la
  `etapa` de la oportunidad, que es la que manda).

## Endpoints

### Empresas
- `GET /api/crm/empresas?q=&archivadas=0&limite=50&offset=0`
  → `{ items: [{ id, nombre, rut, contactos, oportunidades_abiertas, monto_abierto, ultima_cotizacion_en }], total }`
  `q` busca en nombre, rut, y nombre/email de contactos.
- `POST /api/crm/empresas` `{ nombre, rut?, sitio?, notas? }` → empresa (201).
  409 `{ error, empresa_id }` si ya existe una con el mismo nombre normalizado.
- `GET /api/crm/empresas/:id` →
  `{ empresa, contactos: [...], oportunidades: [OportunidadResumen], cotizaciones: [{ id, numero, total, estado,
  created_at, contacto_id, oportunidad_id }], resumen: { cotizaciones, monto_cotizado, ganadas, perdidas,
  monto_ganado, tasa_cierre }, archivadas: { oportunidades, cotizaciones } }`
  `tasa_cierre` = ganadas / (ganadas + perdidas), o null si no hay cerradas. Oportunidades y cotizaciones
  **archivadas no salen** (ni cuentan en `resumen`); `archivadas` trae cuántas hay.
- `PATCH /api/crm/empresas/:id` `{ nombre?, rut?, sitio?, notas?, archivada? }` → empresa. 409 si el nuevo nombre
  choca con otra.
- `GET /api/crm/empresas/duplicados` → `{ grupos: [{ empresas: [{ id, nombre, cotizaciones }], motivo }] }`
  (nombres normalizados muy parecidos: uno contiene al otro o distancia de edición pequeña).
- `POST /api/crm/empresas/:id/fusionar` `{ origen_id }` → mueve contactos, oportunidades y cotizaciones de
  `origen_id` a `:id` (fusionando contactos con el mismo email) y borra la empresa origen. → `{ empresa, movidos:
  { contactos, oportunidades, cotizaciones } }`.

### Contactos
- `POST /api/crm/contactos` `{ empresa_id, nombre, email?, telefono?, cargo?, notas? }` → contacto (201).
  409 si el email ya existe en esa empresa.
- `PATCH /api/crm/contactos/:id` `{ nombre?, email?, telefono?, cargo?, notas?, archivado? }` → contacto.

### Oportunidades
- `OportunidadResumen` = `{ id, titulo, etapa, empresa_id, empresa_nombre, contacto_id, contacto_nombre, marca,
  es_proyecto, monto, fecha_cierre_estimada, motivo_perdida, cotizaciones, cotizacion_id, cotizacion_numero,
  dias_en_etapa, cerrada_en, archivada_en, created_at, updated_at }`. `cotizacion_id`/`cotizacion_numero`: la
  cotización vinculada más reciente **no archivada** (null si no hay), para que el tablero enlace a ella.
- `GET /api/crm/oportunidades?etapa=&empresa_id=&q=&abiertas=1` → `{ items: [OportunidadResumen] }`. Excluye
  las archivadas. `GET /api/crm/embudo` y los agregados de `GET /api/crm/empresas` (oportunidades abiertas,
  monto abierto) también.
- `GET /api/crm/embudo` → `{ etapas: [{ etapa, cantidad, monto }], abiertas: { cantidad, monto },
  ganadas_mes: { cantidad, monto }, perdidas_mes: { cantidad, monto } }` (las 5 etapas siempre presentes, en orden).
- `POST /api/crm/oportunidades` `{ empresa_id, titulo, contacto_id?, etapa?, marca?, es_proyecto?, monto_manual?,
  fecha_cierre_estimada? }` → OportunidadResumen (201).
- `PATCH /api/crm/oportunidades/:id` `{ titulo?, etapa?, contacto_id?, marca?, es_proyecto?, monto_manual?,
  fecha_cierre_estimada?, motivo_perdida? }` → OportunidadResumen.
  Pasar a `perdida` exige `motivo_perdida` (400 si falta). Pasar a `ganada`/`perdida` fija `cerrada_en`; volver a
  una etapa abierta lo limpia. Cambiar de etapa actualiza `etapa_desde` y deriva el `estado` de todas sus
  cotizaciones (misma transacción).
- `POST /api/crm/oportunidades/:id/cotizaciones` `{ cotizacion_id }` → vincula la cotización (y le fija empresa_id
  de la oportunidad; su `estado` se deriva de la etapa). → OportunidadResumen.

### Cotizaciones (endpoints del cotizador que tocan el CRM)
- `PATCH /api/cotizaciones/:id/estado` (`authenticateToken` + dueño o admin, como antes). Dos formas de cuerpo:
  - nueva: `{ etapa: 'nueva'|'cotizada'|'negociacion'|'ganada'|'perdida', motivo_perdida?: string }`. `perdida`
    sin motivo (o solo espacios) → 400 `{ error: 'Indica el motivo de la pérdida' }`. Etapa desconocida → 400
    `{ error: 'Etapa invalida' }`. El motivo se recorta (espacios colapsados, máx. 500).
  - heredada: `{ estado: 'enviada'|'revision'|'rechazada'|'aprobada'|'pendiente' }` (`pendiente` = `revision`);
    se traduce con la tabla. `rechazada` usa el motivo "Rechazada en el cotizador" al pasar a perdida (no pisa
    el motivo de una oportunidad que ya estaba perdida). Si la etapa actual ya deriva ese estado no se toca
    (p. ej. `enviada` con la oportunidad en `negociacion` no la hace retroceder a `cotizada`). Otro valor o
    cuerpo vacío → 400 `{ error: 'Estado invalido' }`.
  - Con oportunidad: cambia su etapa con las reglas del CRM (`reglas.cambiosOportunidad`: `etapa_desde`,
    `cerrada_en`, salir de `perdida` borra el motivo) y **puede reabrir** una cerrada (`ganada` → `nueva`,
    `perdida` → `cotizada`...); luego deriva el estado de todas sus cotizaciones. Una transacción (si la BD
    falla → 500 y no cambia nada). Sin oportunidad: intenta enlazarla (`enlazarCotizacionNueva`) y, si no se
    puede, guarda solo el estado derivado.
  - Respuesta 200: la fila de la cotización (`c.*`, como antes) más `etapa` y `motivo_perdida`.
    404 `{ error: 'Cotización no encontrada' }`; 403 si no es dueño ni admin; 400 'Id invalido'.
- `PUT /api/cotizaciones/:id` con `estado` (forma heredada): misma vía, dentro de la transacción de la edición.
  Sin oportunidad, guarda el estado y después del COMMIT intenta enlazarla.
- `GET /api/cotizaciones` y `GET /api/cotizaciones/:id`: cada fila agrega `etapa` (la de su oportunidad; sin
  oportunidad, derivada del estado), `motivo_perdida` (de la oportunidad, o null), `archivada_en` (ya venía en
  `c.*`) y, **solo para admin**, `empresa_crm` (nombre en `crm_empresas` o null).
- `GET /api/cotizaciones/funnel` (admin): excluye archivadas; además de `stages` (por estado) trae
  `etapas: [{ etapa, count, amount }]` con las 5 etapas en orden. `amount` ahora es number.

### Versiones de una cotización (v1…vN)
Cada edición que cambia algo deja una versión completa (`cotizacion_versiones`, snapshot JSONB de la
cotización y sus líneas). Código: `legacyRoutes.js` (rutas) y `services/cotizacionVersiones.js` (comparación).
- `PUT /api/cotizaciones/:id` (admin; mismo cuerpo de siempre, `FOR UPDATE` y 409 por `expected_version`):
  - Si lo enviado no cambia nada respecto de lo guardado (cabecera del cliente, `estado` si viene, líneas en
    el mismo orden con cantidades, precios, costos y demás campos normalizados como los guarda el editor):
    no incrementa la versión ni escribe → 200 con la cotización actual, sus `items`, `resumen` y
    `sin_cambios: true`.
  - Si cambia: asegura la fila de la versión anterior (`ON CONFLICT DO NOTHING`; si se crea ahora: `nota`
    null, `creado_por` = `updated_by` o `usuario`, `creado_en` = `updated_at` o `created_at`), incrementa
    `version` y guarda la fila de la versión NUEVA con el snapshot ya actualizado, la `nota` de esta edición,
    `creado_por` = quien edita y `creado_en` = ahora. Responde la cotización con `items`, `resumen` y
    `sin_cambios: false`. La nota pertenece a la versión que produjo.
- `GET /api/cotizaciones/:id/versiones` (admin) → `[{ version, total, nota, creado_por, creado_en, vigente }]`,
  v1…vN que existan, DESC. Si la vigente no tiene fila (nunca editada, o editada antes de este cambio), se
  sintetiza desde `cotizaciones` (`nota` null, `creado_por` = `updated_by` o `usuario`, `creado_en` =
  `updated_at` o `created_at`). 404 si la cotización no existe; 400 id inválido.
- `GET /api/cotizaciones/:id/versiones/:version` (admin) → `{ version, total, nota, creado_por, creado_en,
  cotizacion, items }` (igual que antes). Para la vigente sin fila, el snapshot sale de las tablas actuales.
  404 si no existe.
- Datos anteriores a este cambio: cada fila vieja guardaba el snapshot de la versión k con la nota, autor y
  fecha de la edición que produjo k+1. No se reescriben.
- PDF: `POST /api/cotizaciones/pdf` acepta `version` en el cuerpo y el archivo se llama
  `COT-<numero>_<fecha>_<proyecto>_v<version>.pdf` (sin `version` o inválida: `_v1`, como antes). El frontend
  debe mandar la `version` de la cotización.

### Archivado
Archivar una cotización archiva también su oportunidad cuando ya no le queda ninguna cotización vigente. Lo
archivado sale de listados, embudos, resumen de empresas y seguimiento, y se puede restaurar. No se borra nada.
Todas solo admin (`authenticateToken` + `requireAdmin`: 401 sin token, 403 no admin). Validación zod
(`middlewares/validation.js`); cuerpo inválido → 400 `{ error: 'Payload invalido', details: [...] }`.
- `POST /api/cotizaciones/archivar` — cuerpo `{ ids: number[] }` (1..500 enteros positivos; los repetidos cuentan
  una vez) **o** `{ antes_de: 'YYYY-MM-DD' }` (día real), exactamente uno; claves extra → 400. En una transacción:
  marca `archivada_en = ahora` en esas cotizaciones (por ids, o todas las no archivadas con
  `created_at < antes_de`); luego archiva las oportunidades que se quedaron sin cotizaciones vigentes (con
  `ids`, entre las de esas cotizaciones; con `antes_de`, todas) y, con `antes_de`, también las oportunidades
  sin cotizaciones con `created_at < antes_de`. → 200 `{ cotizaciones: n, oportunidades: m }` (cuántas
  cambiaron; las ya archivadas no cuentan).
- `GET /api/cotizaciones/archivar/previa?antes_de=YYYY-MM-DD` → 200 `{ cotizaciones, oportunidades }`: lo que
  archivaría `{ antes_de }`, sin modificar nada (para el diálogo de confirmación). Sin fecha válida → 400.
- `POST /api/cotizaciones/restaurar` — `{ ids: number[] }` (1..500) → quita `archivada_en` a esas cotizaciones y a
  sus oportunidades. → 200 `{ cotizaciones, oportunidades }`.
- `GET /api/cotizaciones`: para admin excluye las archivadas por defecto; con `?archivadas=1` (o `true`)
  devuelve **solo** las archivadas (con y sin paginación). Para el resto de roles no cambia nada: ven todas las
  suyas.
- Las rutas se declaran antes de `/api/cotizaciones/:id`. Restaurar por ids no alcanza a una oportunidad
  archivada sin cotizaciones (archivada por fecha); hoy solo se puede ver/restaurar desde la BD.

## Enlace automático
Al crear una cotización (`POST /api/cotizaciones`, también desde el conector MCP), el backend busca o crea la
empresa por nombre normalizado de `cliente.empresa` (o `cliente.nombre` si no hay empresa), busca o crea el contacto
(por email dentro de la empresa; sin email, por nombre), y crea una oportunidad en etapa `nueva` con título
"Cotización #<numero>" y marca según los ítems, salvo que el body traiga `oportunidad_id`. Si el CRM falla, la
cotización se crea igual (el fallo se registra en el log).

---

# Notas de implementación

## Esquema (`esquema.js`)

- Se aplica en cada arranque con `CREATE TABLE/INDEX IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS`
  (lista `SENTENCIAS`). Corre después de `ensureCotizacionNumero` y `ensureCotizacionEdicion`,
  porque la migración usa `cotizaciones.numero` y `cotizacion_items.origen`.
- Usa una conexión propia con `lock_timeout = 10s`: si una transacción larga tiene tomada
  `cotizaciones`, el `ALTER` se rinde, se registra `crm_esquema_error` y se reintenta en el
  siguiente arranque, en vez de encolar detrás todas las consultas de cotizaciones. Si el esquema
  falla, la migración no corre y `/api/crm` responde 500; el resto de la app sigue igual y el
  enlace automático solo registra el error.
- Las columnas nuevas de `cotizaciones` son nullable y sin DEFAULT: el `ALTER` no reescribe la tabla.
- Archivado: `crm_oportunidades.archivada_en` (+ índice parcial `crm_oportunidades_vigentes_idx (etapa) WHERE
  archivada_en IS NULL`) aquí; `cotizaciones.archivada_en` (+ `cotizaciones_vigentes_created_idx (created_at)
  WHERE archivada_en IS NULL`) en `ensureCotizacionEdicion` (`services/cotizacionItems.js`).
- Índices: `crm_empresas(nombre_normalizado)` único; `crm_contactos(empresa_id, LOWER(email))` único
  parcial (`WHERE email IS NOT NULL`); `crm_contactos(empresa_id)`; `crm_oportunidades(empresa_id)`,
  `(contacto_id)` y `(etapa)`; `cotizaciones(empresa_id)`, `(contacto_id)` y `(oportunidad_id)`.
- FKs: contacto → empresa `ON DELETE CASCADE`; oportunidad → empresa sin cascada (una empresa solo
  se borra al fusionar, después de mover todo); oportunidad → contacto `ON DELETE SET NULL`;
  `cotizaciones.empresa_id/contacto_id/oportunidad_id` → `ON DELETE SET NULL`. `CHECK` en `etapa`
  y `marca`. Fechas `TIMESTAMP` sin zona, como el resto de la BD.
- **Tabla adicional `crm_empresas_alias`** (`nombre_normalizado` PK → `empresa_id`), interna y no
  expuesta en la API. Al fusionar, el nombre normalizado de la empresa origen queda como alias de la
  destino; al renombrar, el nombre viejo queda como alias. El enlace automático busca primero por
  nombre y luego por alias, así una cotización nueva con el nombre de una empresa fusionada o
  renombrada no la vuelve a crear. `POST /empresas` y `PATCH /empresas/:id` responden 409 también si
  el nombre coincide con un alias de otra empresa.

## Normalización y duplicados (`normalizar.js`)

- Nombre normalizado: minúsculas, sin tildes, la puntuación pasa a espacio, espacios colapsados, y
  se quitan al final (repetidamente) los sufijos del contrato más `s p a` ("S.p.A."), `e i r l`
  ("E.I.R.L.") e `y cia` ("Pérez y Cía. Ltda." → `perez`). Nunca deja el nombre vacío: "S.A." solo
  queda `s a`.
- Valores basura (no son empresa ni contacto): vacío, solo puntuación ('-', '...'), 'N/A', 'NA',
  'S/N', 'sin empresa', 'null', 'x', etc. Los emails solo se guardan si parecen un email, en
  minúsculas; 'PID-1' o 'N/A' se ignoran.
- Duplicados (`GET /empresas/duplicados`): dos nombres normalizados se parecen si uno contiene al otro
  **por palabras** (el corto con al menos 4 letras), si son iguales sin espacios, o si la distancia de
  edición es ≤ 1 (5 a 10 letras) o ≤ 2 (más de 10). Nombres con números distintos no se agrupan
  ("Empresa 75" / "Empresa 76"). Los grupos se arman por semilla, sin encadenar (A~B y B~C no juntan A
  con C), para no producir un grupo gigante. Solo empresas no archivadas. Es O(n²): ~80 ms con 550
  empresas.

## Enlace automático (`enlace.js`)

- **Corre después del `COMMIT` de la cotización**, con la misma conexión de la ruta y en su propia
  transacción (no con un SAVEPOINT dentro de la transacción de la cotización). Motivos: (1) nada del
  CRM puede deshacer ni demorar el commit de la cotización (un error, un timeout o una conexión rota
  en el CRM no la tocan); (2) la ruta tenía `catch → ROLLBACK → 500`, y un fallo del CRM dentro de la
  transacción habría que aislarlo con cuidado para no caer ahí; (3) si el proceso muere entre el
  commit y el enlace, la cotización queda sin `empresa_id` y la migración del siguiente arranque la
  enlaza (hace de reconciliador). La función nunca lanza y además la ruta la envuelve en `try/catch`.
- La cotización se bloquea con `SELECT ... WHERE empresa_id IS NULL AND oportunidad_id IS NULL FOR
  UPDATE`: si la migración (que usa `SKIP LOCKED`) ya la tomó, no se enlaza dos veces.
- Empresa: `cliente.empresa`, o `cliente.nombre` si la empresa es basura; si ambos lo son, la
  cotización queda sin CRM. Se busca por nombre normalizado o alias y, si no existe, se crea con
  `INSERT ... ON CONFLICT DO NOTHING` (seguro ante dos creaciones simultáneas).
- Contacto: por email dentro de la empresa; sin email, por nombre (sin distinguir mayúsculas ni
  espacios). Con email y sin coincidencia, se reutiliza un homónimo **sin** email (y se le asigna); un
  homónimo con otro email es otra persona. Completa teléfono o email faltantes. Si el nombre es basura
  y hay email, el contacto se llama como el email.
- Oportunidad: etapa según el estado (`nueva` para una cotización nueva, que nace en `revision`), título
  `Cotización #<numero>` y marca según el `origen` de las líneas guardadas (AXIS, QNAP, MIXTA o null).
- `oportunidad_id` en el body: si existe, no se crea oportunidad; la cotización toma la empresa de la
  oportunidad, el contacto se busca o crea dentro de esa empresa (sin datos, se usa el de la
  oportunidad), la oportunidad pasa de `nueva` a `cotizada`, su marca se combina (AXIS + QNAP = MIXTA)
  y toma el contacto si no tenía; la cotización toma el estado derivado de la etapa. **Si no existe** (o no es un entero), se registra
  `crm_oportunidad_inexistente` y se sigue el flujo normal (oportunidad nueva) en vez de responder
  400: el requisito es que la cotización se cree siempre.
- La respuesta de `POST /api/cotizaciones` agrega `empresa_id`, `contacto_id` y `oportunidad_id` a
  `cotizacion` (campos nuevos; los existentes no cambian).
- Aplica a todas las cotizaciones (admin, clientes y `mcp_bot`), igual que la migración.

## Cambio de estado (`enlace.js`)

- `cambiarEtapaDeCotizacion(pool, ...)` (PATCH) y `aplicarEtapaOportunidad(client, ...)` (dentro de una
  transacción; lo usan el PATCH y el PUT). Antes era un `UPDATE` del estado más un cierre best-effort de la
  oportunidad solo para `aprobada`/`rechazada` (`sincronizarEstadoCotizacion`, eliminado junto con
  `repositorio.cerrarOportunidadAbierta`); ahora la etapa manda y un fallo de BD da 500 sin cambios.
- Orden de bloqueo: oportunidad (`FOR UPDATE`) y después el `UPDATE` de sus cotizaciones, igual que el
  `PATCH` del CRM, para no cruzar bloqueos.

## Migración inicial (`esquema.js`, `migrarCotizaciones`)

- Corre en segundo plano al arrancar (no se espera; el servidor ya está escuchando). Toma lotes de
  `CRM_MIGRACION_LOTE` cotizaciones (default 200) sin `empresa_id` ni `oportunidad_id`, por id con
  cursor y `FOR UPDATE OF c SKIP LOCKED`; una transacción por lote y un `SAVEPOINT` por cotización
  (una que falla se registra como `crm_migracion_cotizacion_error` y el resto sigue). Al final
  registra `crm_migracion_lista` con `{ procesadas, enlazadas, omitidas, errores, lotes, ms }`; si se
  cae, `crm_migracion_error`, y se reintenta en el siguiente arranque.
- Idempotente: solo toma cotizaciones sin enlazar. Las que no tienen un nombre útil quedan sin enlazar
  y se vuelven a revisar (sin efecto) en cada arranque.
- Oportunidades migradas: `etapa_desde`, `created_at` y, si quedó cerrada, `cerrada_en` = `created_at`
  de la cotización; `rechazada` → motivo "Rechazada (migrado)".
- Medido con PostgreSQL 16 local: ~1,2–1,4 s por cada 1000 cotizaciones (8–9 consultas cada una). En
  Railway, con ~0,5–1 ms de ida y vuelta a la BD, se esperan ~5–10 s por cada 1000. Mientras corre,
  cada lote mantiene bloqueadas sus ≤ 200 cotizaciones una fracción de segundo; editar justo una de
  ellas espera a que termine ese lote.

## Rutas (`rutas.js`)

- Validación con zod 4; los errores responden 400 `{ error: "Datos invalidos: campo: motivo" }`. Ids
  inválidos en la URL también dan 400. Los textos se recortan y colapsan; `''` o `null` en un campo
  opcional lo borra; un campo ausente no se toca.
- Búsquedas con `ILIKE` parametrizado; `%`, `_` y `\` del usuario se escapan (son literales).
  `GET /empresas?q=` busca en nombre, rut, nombre normalizado (así "ingenieria" encuentra "Ingeniería
  Ltda.") y nombre/email de contactos.
- `GET /empresas`: `archivadas=1` **incluye** las archivadas (no muestra solo esas) y los items traen
  además `archivada`. `limite` 1–200 (default 50), `offset` ≥ 0. Orden: última cotización más reciente
  primero, luego nombre.
- `GET /oportunidades`: sin `abiertas=1` lista todas las etapas (nunca las archivadas). Acepta además
  `limite` (1–1000, default 500) y `offset`. Orden: `updated_at` descendente. Los items traen además
  `cerrada_en` y `archivada_en`. `cotizaciones` cuenta todas las vinculadas (también archivadas).
- `GET /empresas/:id`: `contactos` incluye los archivados (al final); `cotizaciones` trae hasta las 500
  más recientes no archivadas (el `resumen` cuenta todas las no archivadas). `tasa_cierre` con 4 decimales.
- `POST /empresas`: 409 `{ error, empresa_id }` también si el nombre es alias de otra.
  `POST /contactos`: 404 si la empresa no existe; 409 `{ error, contacto_id }` por email repetido.
- Oportunidades: `contacto_id` debe ser de la misma empresa (400). `POST` acepta además
  `motivo_perdida`, necesario si se crea directamente en `perdida`. En `PATCH`, salir de `perdida`
  limpia `motivo_perdida`; el motivo solo se guarda mientras la oportunidad esté perdida.
  `monto_manual` acepta número o texto numérico ≥ 0; `null` lo borra. `fecha_cierre_estimada` es
  `YYYY-MM-DD` (se valida que el día exista) y se devuelve igual.
- `POST /oportunidades/:id/cotizaciones`: conserva el contacto de la cotización si es de la empresa de
  la oportunidad; si no, usa el de la oportunidad. Si la oportunidad estaba en `nueva`, pasa a
  `cotizada`. La oportunidad anterior de esa cotización, si tenía, no se borra.
- Fusión: una transacción; bloquea ambas empresas en orden de id. `movidos.contactos` cuenta los
  contactos de origen movidos más los fundidos por email. Completa `rut`, `sitio` y `notas` vacíos de
  la destino con los de origen.
- Errores de BD: unicidad → 409, FK → 400, el resto → 500 `{ error: 'Error del servidor' }` con log
  `crm_error`.

## Pendiente / fuera de alcance

- Editar el cliente de una cotización en el editor (`PUT`) no la cambia de empresa.
- Borrar una cotización deja su oportunidad (con 0 cotizaciones y monto 0 si no tiene `monto_manual`).
- No hay `GET /api/crm/oportunidades/:id` ni borrado de empresas, contactos u oportunidades (no
  estaban en el contrato).

## Probar contra PostgreSQL

```bash
cd backend
CRM_TEST_DATABASE_URL=postgres://usuario@localhost:5432/bd_de_prueba npx jest crm.postgres
```

Crea un schema `crm_test_<aleatorio>` con tablas mínimas del cotizador, prueba esquema, migración,
enlace, cambio de etapa y derivación del estado, rutas, fusión y archivado, y lo borra al terminar. No toca
`public`.

## Órdenes como oportunidades ganadas

Código: `backend/src/crm/ordenes.js`.

**Corre sola.** Se dispara en dos momentos, los dos en segundo plano y sin bloquear nada:

1. Después de cada lectura de `GET /api/oso/orders` que haya refrescado `bo_meta` (es decir,
   cada vez que se abre la vista de Órdenes y el caché estaba vencido). Se lanza **después**
   de responder, así que no demora la pantalla.
2. Al arrancar el backend, junto a `iniciarCrm`, por si no se abre la vista de Órdenes en
   todo el día.

Un fallo en la sincronización nunca tumba la lectura de órdenes ni el arranque: queda en el
log como `crm_ordenes_auto_fallo` o `crm_ordenes_boot_fallo`.

Además está el disparo manual: `POST /api/crm/oportunidades/sincronizar-ordenes` (admin, como
todo el CRM), que en el frontend es el botón «Traer órdenes» del embudo. Sirve para no esperar,
y para ver el resumen de lo que hizo. **El botón manual y el arranque no traen montos** (ver
"Monto"): crean oportunidades con monto `null` y no corrigen los existentes; los montos solo los
aporta la lectura de `GET /api/oso/orders`.

Las órdenes **no son cotizaciones**: viven en la pestaña OSO de Google Sheets y
`GET /api/oso/orders` ya las persiste en `bo_meta` (cliente, PO, borrado lógico). La
sincronización lee de esa tabla, no de la planilla: así no depende de Sheets ni duplica el parseo
de 200 líneas del endpoint. El monto, en cambio, no sale de la base (ver "Monto").

Por cada BO vigente (`bo_meta.deleted IS NOT TRUE`):

1. Si ese BO ya tiene oportunidad (columna `bo`, única), se asegura de que esté en `ganada` y no
   crea nada. Esto hace la operación **idempotente**: se puede repetir sin duplicar.
2. Si no, resuelve la empresa por nombre normalizado (`normalizar.js`, el mismo que usa el enlace
   de cotizaciones) y la crea si no existe. Una orden sin nombre de cliente no crea nada: se
   cuenta en `sinCliente`.
3. Con la empresa resuelta:
   - si tiene **exactamente una** oportunidad abierta sin BO, la orden es su cierre: se le engancha
     el BO y se gana. Evita dejar el mismo negocio duplicado en el embudo (la cotización por un
     lado, la orden por otro).
   - si tiene cero o varias, no hay forma de saber cuál cerró: se crea una oportunidad nueva para
     ese BO, titulada `Orden <BO> · OC <customer_po>`.

### Monto

`bo_line_meta.monto_intcomex` es el precio **unitario** de la línea; la cantidad (`orderQty`)
vive solo en la planilla. Por eso el total de una orden es Σ(`montoIntcomex` × `orderQty`) y lo
calcula `totalesPorBo(orders)` (puro, en `ordenes.js`) con las órdenes que `GET /api/oso/orders`
acaba de leer (ya con `montoIntcomex` fusionado desde `bo_line_meta`). El endpoint pasa ese
mapa `{ [bo]: total }` a `sincronizarOrdenes(pool, { montos })`. Una línea sin monto o sin
cantidad válida aporta 0; una orden sin ningún monto no aparece en el mapa (no se escribe 0);
el total se redondea a 2 decimales.

- **Oportunidad nueva:** `monto_manual` = total del mapa, o `null` si no hay.
- **Oportunidad existente:** si hay total (> 0), la oportunidad **no tiene ninguna cotización
  vinculada** y su `monto_manual` difiere del total, se actualiza `monto_manual` y se cuenta en
  `montosActualizados`. Es el flujo normal: la orden llega primero y los precios se cargan días
  después. Con cotización vinculada el monto sale de la cotización y `monto_manual` no se toca
  nunca.
- Sin mapa (arranque, botón manual) no se escribe ningún monto en oportunidades existentes.

Ganar la oportunidad deriva `cotizaciones.estado = 'aprobada'` en todas sus cotizaciones, como
cualquier otro cambio de etapa (ver "Estado y etapa").

**Costo en la base.** Antes de recorrer las órdenes hay **una sola consulta**,
`repositorio.oportunidadesConBo` (`{ id, bo, etapa, monto_manual, con_cotizacion }` de todas las
oportunidades con BO; `con_cotizacion` = `EXISTS` en `cotizaciones`). Con ella se decide en
memoria qué órdenes necesitan escribir algo; solo esas abren transacción. Una orden cuya
oportunidad ya está ganada y sin monto que actualizar se cuenta en `sinCambio` sin tocar la base.
Si esa consulta falla, se sincroniza orden por orden como antes (la sincronización nunca lanza).

Cada orden que escribe corre en su propia transacción: una que falle se cuenta en `errores` y no
arrastra al resto. La respuesta es el resumen `{ ordenes, creadas, enlazadas, ganadas,
montosActualizados, sinCambio, sinCliente, errores, ms }`.

Tests: `backend/tests/crm.ordenes.test.js` (repositorio en memoria, sin PostgreSQL) y dos casos en
`crm.postgres.test.js` que ejecutan el SQL de verdad: el registro en `bo_meta` (un solo `INSERT` con
`unnest`, en `backend/src/services/boMeta.js`) y la sincronización de punta a punta con el repositorio
real. Esos dos solo corren con `CRM_TEST_DATABASE_URL`; conviene correrlos al tocar cualquier SQL de
órdenes, porque el repositorio en memoria no detecta un error de tipos ni de sintaxis.
