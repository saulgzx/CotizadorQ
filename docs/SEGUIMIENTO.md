# Seguimiento automático de cotizaciones

Backend del contrato "Seguimiento automático de MyQuote v1". Todo el código vive en
`backend/src/seguimiento/`; `legacyRoutes.js` solo monta las rutas, crea el esquema al arrancar y
arranca el planificador.

**Nada se envía solo.** El sistema crea borradores de respuesta en Outlook (a través del agente del
miniPC) y avisa al dueño. El dueño revisa y envía.

## Cómo funciona

1. **Alta automática.** En cada ciclo, toda oportunidad del CRM en etapa `nueva` o `cotizada` con una
   cotización vinculada (no archivada) creada en los últimos 30 días (`SEGUIMIENTO_DIAS_ALTA`) y sin
   seguimiento entra en `buscando_envio`. Así, al activar el módulo por primera vez no entran cotizaciones
   viejas. Una cotización recién creada (estado `revision`) tiene su oportunidad en `nueva`.
2. **Vincular el correo.** En cada turno de revisión se crea una tarea `buscar_envios`: el agente busca
   en Enviados el correo con el PDF de la cotización. Si en 10 días hábiles no aparece, queda `sin_envio`
   (aparece en el resumen; "reanudar" vuelve a buscar).
   - El PDF se llama `<base>_v<N>.pdf` (`buildPdfFilename` en `POST /api/cotizaciones/pdf`; `N` es la
     `version` de la cotización que manda el frontend, por defecto 1). Como la cotización puede editarse
     después de enviarla, no se sabe qué versión salió: cada ítem lleva `pdf_nombre_base` (`<base>`, de
     `buildPdfBaseName`, sin versión ni extensión) y `pdf_nombre` (`<base>_v1.pdf`, por compatibilidad
     con el agente actual, cuyo prompt nombra ese campo). Las `instrucciones` de la tarea piden aceptar
     cualquier sufijo `_v<N>.pdf`, y se mantiene el respaldo por folio ("COT-<numero>" / "Cotización
     N°<numero>"), que también encuentra cualquier versión.
3. **Cadencia** (días hábiles de Chile, acciones a las 08:00 de Chile del día que toca):
   - 1er seguimiento: 3 días hábiles después del envío.
   - 2º seguimiento: 7 días hábiles después de que el dueño **envió** el 1º.
   - Cierre: 7 días hábiles después de que el dueño envió el 2º → oportunidad `perdida`,
     motivo "Sin respuesta".
   - Antes de crear un borrador o cerrar, el hilo debe haberse revisado en las últimas ~2 h (si no, se
     pide una revisión urgente y se decide en el ciclo siguiente).
4. **Revisar hilos** 3 veces por día hábil (`SEGUIMIENTO_REVISION_HORAS`, por defecto 07:30, 13:00 y
   17:30): hilos `esperando`, `borrador_listo` y cerrados "Sin respuesta" de los últimos 30 días.
   - Respuesta del cliente en cualquier momento: se detiene, la oportunidad pasa a `negociacion` (si
     estaba `nueva`/`cotizada`, o `perdida` por "Sin respuesta" → se reabre) y se avisa por WhatsApp.
   - Borrador enviado por el dueño: avanza el paso.
   - Borrador sin enviar 2+ días hábiles: no se crea otro, se recuerda en el resumen diario.
   - Borrador borrado sin enviar: el seguimiento queda `pausada` (se reanuda desde el panel).
   - Un correo manual del dueño en el hilo reinicia la espera del paso actual.
5. **Oportunidad cambiada a mano** a `ganada`, `perdida` o `negociacion` mientras está en seguimiento:
   el seguimiento se pausa.
6. **Estado de la cotización.** Cuando el seguimiento cambia la etapa (`crmAdaptador.cambiarEtapa`:
   `negociacion` al responder, `perdida` "Sin respuesta" al cerrar...), deriva `cotizaciones.estado` de
   todas las cotizaciones de la oportunidad con la tabla del CRM (`docs/CRM.md`, "Estado y etapa").
   Es best-effort: si ese `UPDATE` falla se registra `crm_estado_error` y el cambio de etapa queda.
7. **Archivadas.** Una oportunidad archivada (`crm_oportunidades.archivada_en`, ver archivado en
   `docs/CRM.md`) queda congelada: no entra al alta, no la toma el ciclo y no sale en `/hoy`, `/lista`,
   `/oportunidad/:id` (404), ni en las 5 abiertas más grandes del resumen semanal. Su fila de
   `crm_seguimientos` no se borra: al restaurarla, el seguimiento sigue donde estaba.

Solo se guarda del correo lo que pide el contrato: ids (message/conversation/borrador), fechas,
remitente (en el evento de respuesta) y un resumen de ≤ 400 caracteres al que además se le quitan
correos, teléfonos y enlaces. Los destinatarios y asuntos que devuelve el agente se descartan.

## Tareas del agente

- `GET /api/seguimiento/agente/tarea?espera=25` → 204 o `{ id, tipo, creada_en, items, instrucciones }`.
- `POST /api/seguimiento/agente/tarea/:id/resultado` `{ ok, items, error?, metricas? }` → 204.
  Mismo token que `/api/ia/agente/*` (`IA_AGENTE_TOKEN`, `Authorization: Bearer`).
- Máximo 20 ítems por tarea. Una tarea tomada y no devuelta en 15 minutos vuelve a la cola; un
  resultado con `ok: false` o malformado (validación estricta con zod; responde 400) no toca el estado,
  se registra y se reintenta a los 15 minutos. Máximo 3 intentos; después la tarea queda `fallida`.
- Un borrador pedido que el agente no devuelve cuenta como fallido: se reintenta a las 2 h y al
  tercer fallo el seguimiento se pausa (evita crear tareas cada 15 minutos sin fin).
- Las tareas viven en `crm_seguimiento_tareas` (sobreviven a reinicios).

## Resúmenes

- **Diario**: días hábiles desde las 08:30 de Chile (`GET /api/seguimiento/hoy` da lo mismo en JSON):
  borradores para enviar, respuestas desde el día hábil anterior, borradores sin enviar hace 2+ días,
  cotizaciones que vencen esta semana (validez 15 días desde la emisión) y cotizaciones sin correo.
  Si no hay nada que contar no se manda.
- **Semanal**: viernes desde las 17:00 de Chile: respuestas por paso, ganadas y perdidas, motivos de
  pérdida, 5 abiertas más grandes y valor generado de la semana.
- Un resumen de cada tipo por día (se recuerda en `crm_seguimiento_estado`, sobrevive a reinicios). Si
  el envío falla, se reintenta en el siguiente ciclo del mismo día.

### WhatsApp: límite de 24 horas

Meta solo entrega **texto libre** dentro de las 24 h desde el último mensaje que el dueño envió al
número de WhatsApp Business. Fuera de esa ventana el resumen no llega. Para resúmenes garantizados hay
que crear y aprobar en Meta una **plantilla** (categoría "utility") con un único parámetro en el cuerpo,
por ejemplo `Resumen MyQuote: {{1}}`, y configurar `WHATSAPP_PLANTILLA_RESUMEN` con su nombre. Con esa
variable el resumen se manda como plantilla en una sola línea (los parámetros de plantilla no admiten
saltos de línea; se reemplazan por " | " y se corta a 1000 caracteres). Sin ella, se manda texto libre.
Los avisos de "respondió X" siempre van como texto libre.

## Valor generado

`GET /api/seguimiento/valor?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (por defecto los últimos 30 días;
las fechas cortas son medianoche de Chile).

- `tiempo_ahorrado_min`: acciones automáticas × minutos estándar (detalle en `acciones`):
  vincular envío (evento `envio_vinculado`), revisar hilo (`hilo_revisado`), redactar borrador
  (`borrador_creado`), actualizar CRM (`crm_actualizado`), resumen diario (`resumen_diario`).
- `ingreso_atribuido`: monto (regla del CRM) de las oportunidades ganadas en el rango cuyo cliente
  respondió después de al menos un seguimiento automático enviado (paso ≥ 1).
- `margen_atribuido`: suma de `precio_total − costo_unitario × cantidad` de las líneas con costo de la
  cotización más reciente de esas oportunidades; `null` si ninguna tiene costo.
- `respuestas_por_paso` (enviados, respuestas y tasa por paso 0/1/2), `tasa_cierre` y
  `ciclo_promedio_dias` (oportunidades en seguimiento cerradas en el rango).

## Endpoints admin (`authenticateToken` + `requireAdmin`)

- `GET /api/seguimiento/hoy`
- `GET /api/seguimiento/lista` → `{ activo, total, items }`: todas las oportunidades en seguimiento con su
  estado, paso y próximo paso (sin ids de correo). Alimenta la pestaña "Seguimiento automático" del CRM.
- `GET /api/seguimiento/valor?desde=&hasta=`
- `GET /api/seguimiento/oportunidad/:id` → `{ seguimiento, siguiente, eventos }`
- `POST /api/seguimiento/oportunidad/:id/pausar` y `/reanudar` (404 si no está en seguimiento, 409 si
  el estado no lo permite; reanudar también reinicia la búsqueda de un `sin_envio`).
- `GET /api/seguimiento/estado` (extra, para verificar): activo, último ciclo, último turno de
  revisión, últimos resúmenes y conteo de tareas.

## Variables de entorno

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `SEGUIMIENTO_ACTIVO` | `false` | Con `false` el planificador no da de alta, no crea tareas ni manda resúmenes. Los endpoints responden igual. |
| `SEGUIMIENTO_CADA_MIN` | `15` | Minutos entre ciclos del planificador. |
| `SEGUIMIENTO_REVISION_HORAS` | `07:30,13:00,17:30` | Turnos (hora de Chile, días hábiles) para `buscar_envios` y `revisar_hilos`. |
| `SEGUIMIENTO_RESUMEN_DIARIO` | `08:30` | Hora del resumen diario. |
| `SEGUIMIENTO_RESUMEN_SEMANAL` | `17:00` | Hora del resumen del viernes. |
| `SEGUIMIENTO_DIAS_ALTA` | `30` | Antigüedad máxima (días corridos) de una cotización para entrar al seguimiento. |
| `SEGUIMIENTO_VALIDEZ_DIAS` | `15` | Validez de la cotización desde su emisión. |
| `SEGUIMIENTO_MIN_VINCULAR` | `2` | Minutos estándar por correo vinculado. |
| `SEGUIMIENTO_MIN_REVISAR` | `2` | Minutos estándar por hilo revisado. |
| `SEGUIMIENTO_MIN_BORRADOR` | `6` | Minutos estándar por borrador redactado. |
| `SEGUIMIENTO_MIN_CRM` | `3` | Minutos estándar por actualización del CRM. |
| `SEGUIMIENTO_MIN_RESUMEN` | `10` | Minutos estándar por resumen diario enviado. |
| `FERIADOS_EXTRA` | — | Fechas ISO separadas por coma que no son hábiles (p. ej. elecciones). |
| `WHATSAPP_PLANTILLA_RESUMEN` | — | Nombre de la plantilla aprobada para los resúmenes. |
| `WHATSAPP_PLANTILLA_IDIOMA` | `es` | Código de idioma de esa plantilla. |

También se usan `IA_AGENTE_TOKEN` y las variables `WHATSAPP_*` existentes.

Feriados: `backend/src/seguimiento/feriados.js` (2026 y 2027, nacionales, con los trasladables ya
corridos). Los marcados `// verificar` deben confirmarse con el decreto oficial; para 2028 en adelante
hay que agregarlos al archivo.

## Tablas

`crm_seguimientos` (una fila por oportunidad; columnas del contrato más columnas internas del motor:
`borrador_paso`, `borrador_fallos`, `borrador_fallo_en`, `ultima_revision_en`, `estado_antes_pausa`,
`busqueda_desde`, `cerrada_en`), `crm_seguimiento_eventos`, `crm_seguimiento_tareas` y
`crm_seguimiento_estado`. Se crean al arrancar (idempotente). Las claves foráneas hacia
`crm_oportunidades` se agregan solo cuando esa tabla existe (se reintenta en cada arranque).

Todo acceso a las tablas del CRM pasa por `backend/src/seguimiento/crmAdaptador.js` (que para derivar el
estado reutiliza `crm/enlace.derivarEstadoSinFallar`).

## Cómo verificar tras el deploy

1. Con `SEGUIMIENTO_ACTIVO=false` (por defecto): `GET /api/seguimiento/estado` con sesión admin →
   `activo: false`; en los logs aparece `seguimiento_planificador`. `GET /api/seguimiento/hoy` → 200.
   Si el CRM aún no está desplegado, `/hoy` responde 500 (faltan las tablas `crm_*`): es esperado.
2. Con el agente listo: `curl -H "Authorization: Bearer $IA_AGENTE_TOKEN"
   https://<backend>/api/seguimiento/agente/tarea?espera=1` → 204.
3. Poner `SEGUIMIENTO_ACTIVO=true` en Railway. Unos 30 s después del arranque corre el primer ciclo:
   `GET /api/seguimiento/estado` muestra `activado_en` y `ultimo_ciclo` con `altas`. En el siguiente
   turno de revisión aparecen tareas `buscar_envios` (ver `tareas` en `/estado`).
4. Tras la primera vinculación, `GET /api/seguimiento/oportunidad/:id` muestra `esperando`, la próxima
   acción y los eventos.
5. El primer día hábil a las 08:30 llega el resumen (si hay algo que contar y estás dentro de la
   ventana de 24 h de WhatsApp o configuraste la plantilla).
