# CRM de MyQuote (etapas A y B)

Empresas, contactos, oportunidades y embudo dentro de MyQuote, alimentados por las
cotizaciones: las existentes por migración y las nuevas por enlace automático.

- Código: `backend/src/crm/` (`normalizar.js`, `reglas.js`, `repositorio.js`, `enlace.js`,
  `esquema.js`, `rutas.js`, `index.js`). En `legacyRoutes.js` solo hay enganches: montaje del
  router, enlace en `POST /api/cotizaciones`, cierre de la oportunidad en
  `PATCH /api/cotizaciones/:id/estado` (y en `PUT /api/cotizaciones/:id` si trae `estado`), e
  `iniciarCrm(pool)` en el arranque.
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
  es_proyecto (bool), monto_manual (nullable), fecha_cierre_estimada (date nullable), motivo_perdida (nullable),
  etapa_desde (timestamp: cuándo entró a la etapa actual), cerrada_en (nullable), created_at, updated_at.
- `cotizaciones`: columnas nuevas nullable `empresa_id`, `contacto_id`, `oportunidad_id`.

Monto de una oportunidad: `monto_manual` si existe; si no, el `total` de la cotización vinculada más reciente; si no
hay, 0.

Normalización de nombre de empresa: minúsculas, sin tildes, sin puntuación, espacios colapsados y sin sufijos
legales al final (`s a`, `sa`, `spa`, `ltda`, `limitada`, `eirl`, `s a c`, `inc`, `llc`, `cia`). Ejemplo:
"SONDA S.A." y "Sonda SA" → `sonda`.

Mapeo de estado de cotización a etapa (solo para la migración inicial y para el enlace automático):
`revision`/`pendiente` → `cotizada`, `enviada` → `cotizada`, `aprobada` → `ganada`, `rechazada` → `perdida`
(motivo_perdida = "Rechazada (migrado)").

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
  monto_ganado, tasa_cierre } }`
  `tasa_cierre` = ganadas / (ganadas + perdidas), o null si no hay cerradas.
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
  es_proyecto, monto, fecha_cierre_estimada, motivo_perdida, cotizaciones, dias_en_etapa, created_at, updated_at }`
- `GET /api/crm/oportunidades?etapa=&empresa_id=&q=&abiertas=1` → `{ items: [OportunidadResumen] }`
- `GET /api/crm/embudo` → `{ etapas: [{ etapa, cantidad, monto }], abiertas: { cantidad, monto },
  ganadas_mes: { cantidad, monto }, perdidas_mes: { cantidad, monto } }` (las 5 etapas siempre presentes, en orden).
- `POST /api/crm/oportunidades` `{ empresa_id, titulo, contacto_id?, etapa?, marca?, es_proyecto?, monto_manual?,
  fecha_cierre_estimada? }` → OportunidadResumen (201).
- `PATCH /api/crm/oportunidades/:id` `{ titulo?, etapa?, contacto_id?, marca?, es_proyecto?, monto_manual?,
  fecha_cierre_estimada?, motivo_perdida? }` → OportunidadResumen.
  Pasar a `perdida` exige `motivo_perdida` (400 si falta). Pasar a `ganada`/`perdida` fija `cerrada_en`; volver a
  una etapa abierta lo limpia. Cambiar de etapa actualiza `etapa_desde`.
- `POST /api/crm/oportunidades/:id/cotizaciones` `{ cotizacion_id }` → vincula la cotización (y le fija empresa_id
  de la oportunidad). → OportunidadResumen.

## Enlace automático
Al crear una cotización (`POST /api/cotizaciones`, también desde el conector MCP), el backend busca o crea la
empresa por nombre normalizado de `cliente.empresa` (o `cliente.nombre` si no hay empresa), busca o crea el contacto
(por email dentro de la empresa; sin email, por nombre), y crea una oportunidad en etapa `cotizada` con título
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
- Oportunidad: etapa según el estado (siempre `cotizada` para una cotización nueva), título
  `Cotización #<numero>` y marca según el `origen` de las líneas guardadas (AXIS, QNAP, MIXTA o null).
- `oportunidad_id` en el body: si existe, no se crea oportunidad; la cotización toma la empresa de la
  oportunidad, el contacto se busca o crea dentro de esa empresa (sin datos, se usa el de la
  oportunidad), la oportunidad pasa de `nueva` a `cotizada`, su marca se combina (AXIS + QNAP = MIXTA)
  y toma el contacto si no tenía. **Si no existe** (o no es un entero), se registra
  `crm_oportunidad_inexistente` y se sigue el flujo normal (oportunidad nueva) en vez de responder
  400: el requisito es que la cotización se cree siempre.
- La respuesta de `POST /api/cotizaciones` agrega `empresa_id`, `contacto_id` y `oportunidad_id` a
  `cotizacion` (campos nuevos; los existentes no cambian).
- Aplica a todas las cotizaciones (admin, clientes y `mcp_bot`), igual que la migración.

## Cambio de estado

- `PATCH /api/cotizaciones/:id/estado`, y `PUT /api/cotizaciones/:id` cuando trae `estado`: si la
  cotización tiene `oportunidad_id` y la oportunidad está abierta, `aprobada` → `ganada` y
  `rechazada` → `perdida` con motivo "Rechazada en el cotizador"; fija `etapa_desde` y `cerrada_en`.
  Una oportunidad ya cerrada no se toca. Best-effort: un error se registra (`crm_estado_error`) y la
  ruta responde igual.

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
- `GET /oportunidades`: sin `abiertas=1` lista todas las etapas. Acepta además `limite` (1–1000,
  default 500) y `offset`. Orden: `updated_at` descendente. Los items traen además `cerrada_en`.
- `GET /empresas/:id`: `contactos` incluye los archivados (al final); `cotizaciones` trae hasta las 500
  más recientes (el `resumen` cuenta todas). `tasa_cierre` con 4 decimales.
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
enlace, rutas y fusión, y lo borra al terminar. No toca `public`.
