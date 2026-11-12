# Agente IA de MyQuote (miniPC de casa)

Resuelve las consultas del **Asistente IA** de MyQuote, tanto del tab web como de
WhatsApp, con **Claude Code** en tu equipo. Usa tu suscripción de Claude (sin
créditos de API), tus skills `preventa-axis` / `preventa-qnap` y tu conector
MyQuote.

```
Tab web / WhatsApp ──► Backend MyQuote (Railway) ◄── agente (miniPC) ──► Claude Code
                         cola de consultas         solo conexiones salientes
```

El agente **solo hace conexiones salientes**: no hay que abrir puertos en el
router ni tener IP fija.

> Úsalo solo para ti. La suscripción de Claude es personal: deja `IA_USUARIOS`
> con tu usuario de MyQuote y `WHATSAPP_NUMEROS` con tu número.

## Requisitos

- miniPC encendido 24/7 con Linux, Windows o macOS.
- Node.js 20 o superior: `node -v`.
- Plan Claude Pro o Max.

## 1. Instalar Claude Code e iniciar sesión

Linux o macOS:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Después ejecuta `claude`, elige **iniciar sesión con tu cuenta de Claude**
(Pro/Max, no API key), y sal con `/exit`.

## 2. Bajar el repositorio

```bash
git clone https://github.com/saulgzx/CotizadorQ.git
cd CotizadorQ
```

## 3. Copiar tus skills a Claude Code

Están en el repo, en `backend/src/ia/skills`.

Linux o macOS:

```bash
mkdir -p ~/.claude/skills
cp -r backend/src/ia/skills/preventa-axis backend/src/ia/skills/preventa-qnap ~/.claude/skills/
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse -Force backend\src\ia\skills\preventa-axis, backend\src\ia\skills\preventa-qnap "$HOME\.claude\skills\"
```

## 4. Agregar el conector MyQuote

Usa la URL del servicio MCP en Railway (servicio **CotizadorQ** → Settings →
Networking) y su `CONNECTOR_SECRET`:

```bash
claude mcp add --transport http --scope user myquote https://TU-DOMINIO-MCP.up.railway.app/mcp --header "Authorization: Bearer TU_CONNECTOR_SECRET"
```

Pruébalo:

```bash
claude -p "Usa el conector MyQuote para consultar precio y stock del P1475-LE" --allowedTools "mcp__myquote__consultar_producto"
```

Debe responder con precio y stock reales.

## 5. Configurar el agente

1. En Railway, servicio **cotizadorQ-backend** → **Variables**, agrega:
   - `IA_AGENTE_TOKEN`: un secreto largo. Genera uno con
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - `IA_USUARIOS`: tu usuario de MyQuote (el que usas para iniciar sesión).

   Con `IA_AGENTE_TOKEN` definido, MyQuote usa el agente y no la API (puedes
   borrar `ANTHROPIC_API_KEY`).
2. En el miniPC:

   ```bash
   cd agente-ia
   cp .env.example .env
   ```

   Edita `.env` y pega el mismo `IA_AGENTE_TOKEN`.
3. Prueba a mano:

   ```bash
   npm start
   ```

   Debe decir `Esperando consultas…`. Haz una consulta desde el tab de MyQuote
   y mira cómo la resuelve. Corta con Ctrl+C.

## 6. Dejarlo corriendo siempre

El agente se arranca con el **lanzador** `iniciar.mjs` (`npm start`), no con
`agente.mjs` directo. El lanzador lo relanza al instante cuando se actualiza
solo (código de salida **75**) y, si se cae, con espera creciente (2 s, 4 s ...
hasta 5 min) para no entrar en bucle.

**Linux (systemd).** Edita `myquote-agente.service` y cambia `TU_USUARIO`
(y la ruta si clonaste en otro lado). Luego:

```bash
sudo cp myquote-agente.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now myquote-agente
journalctl -u myquote-agente -f
```

Si ya lo tenías instalado, vuelve a copiar el `.service`, haz `daemon-reload`
y `sudo systemctl restart myquote-agente`.

**Windows (Programador de tareas, al iniciar sesión).**

1. Abre **Programador de tareas** → **Crear tarea…**
2. **General**: nombre `MyQuote agente IA`. Déjala para tu usuario (Claude Code
   usa tu sesión iniciada).
3. **Desencadenadores** → Nuevo → **Al iniciar sesión** (tu usuario). Activa el
   inicio de sesión automático de Windows en el miniPC si debe volver solo.
4. **Acciones** → Nuevo → Programa: `C:\Program Files\nodejs\node.exe`,
   Argumentos: `iniciar.mjs`, Iniciar en: la carpeta `agente-ia` completa.
   En `.env`, pon la ruta completa de Claude Code:
   `CLAUDE_BIN=C:\Users\TU_USUARIO\.local\bin\claude.exe` (la tarea programada
   no siempre ve el mismo PATH que tu sesión).
5. **Configuración**: marca **Si la tarea no se ejecuta, reiniciarla cada 1 minuto**
   y desmarca **Detener la tarea si se ejecuta durante más de 3 días**.
6. Para cambiar de `agente.mjs` a `iniciar.mjs` en una tarea existente: edita la
   acción, cambia el argumento a `iniciar.mjs`, y detén/ejecuta la tarea.

## 7. Auto-actualización

Con el agente **ocioso** (nunca en medio de una consulta), cada
`AUTO_ACTUALIZAR_MIN` minutos (10 por defecto) hace `git fetch origin main`. Si
está atrasado, el árbol de trabajo está limpio y la rama actual es `main`:
`git pull --ff-only origin main`, `npm ci`/`npm install` en `agente-ia/` solo si
cambió su `package.json` o lockfile, y sale con el código **75** para que el
lanzador lo relance con el código nuevo.

En cualquier otro caso (cambios locales sin confirmar, otra rama, commits
propios, sin git, sin red) no hace nada: registra un aviso y sigue funcionando.
Nunca usa `reset --hard`, `stash` ni fuerza. `AUTO_ACTUALIZAR=0` en `.env` la
apaga. Requiere que el agente corra bajo el lanzador (`iniciar.mjs`/`npm start`
o systemd con el `.service` incluido); si corre con `agente.mjs` directo, al
actualizarse simplemente se detiene.

Códigos de salida de `agente.mjs`: `75` = actualizado, relanzar; `1` = error
(por ejemplo token rechazado).

El agente informa su versión (SHA corto de git) a MyQuote en cada petición de
trabajo; aparece en `GET /api/ia/estado` (`agente.version`).

## 8. Aviso de desconexión por WhatsApp

Si WhatsApp está configurado y el agente lleva más de `AGENTE_AVISO_MIN` minutos
(15 por defecto; `0` lo apaga; variable del **backend** en Railway) sin pedir
trabajo, MyQuote manda **un** aviso a los números de `WHATSAPP_NUMEROS` y otro
cuando vuelve. Nota de Meta: los mensajes de texto libre solo se entregan si
el número escribió al bot en las últimas 24 h.

Ponle al miniPC el arranque automático tras un corte de luz (opción de la BIOS
"Restore on AC power loss") para que vuelva solo.

## 9. Seguimiento por correo (Outlook)

Además de las consultas del Asistente IA, el mismo agente ejecuta las **tareas de correo** del seguimiento
automático de cotizaciones. Las pide a `GET /api/seguimiento/agente/tarea` (mismo `IA_AGENTE_TOKEN`) y devuelve el
resultado a `POST /api/seguimiento/agente/tarea/:id/resultado`. Hay tres tipos:

- `buscar_envios`: busca en Enviados el correo que lleva adjunto el PDF de cada cotización.
- `revisar_hilos`: mira si el cliente respondió, si enviaste algo nuevo y si el borrador sigue existiendo.
- `crear_borradores`: crea **borradores** de respuesta (seguimiento 1 y 2) en el hilo de cada cotización.

Usa el conector de Outlook (Microsoft 365) que ya tiene Claude Code en este equipo (el de claude.ai: Configuración >
Conectores > Microsoft 365, con la sesión iniciada). Una sola cosa a la vez: las consultas del usuario siempre van
primero; las tareas de correo solo se toman cuando no hay consulta pendiente. Si el backend aún no tiene esas rutas
(404), el agente sigue con solo consultas y vuelve a probar cada 10 minutos. `SEGUIMIENTO_CORREO=0` lo apaga.

### `MCP_CORREO`

Nombre del servidor MCP de Outlook tal como lo ve Claude Code. Por defecto `claude_ai_Microsoft_365` (así se llaman las
herramientas del conector de claude.ai: `mcp__claude_ai_Microsoft_365__outlook_email_search`, …). Si en tu equipo se
llama distinto, ponlo en `.env` (`MCP_CORREO=...`). No lo adivines: usa el comando de diagnóstico.

### Comprobar que funciona: `--probar-correo`

```
cd agente-ia
npm run probar-correo        # o: node agente.mjs --probar-correo
```

Lanza Claude Code una vez, solo con herramientas de lectura, y le pide listar los 3 correos más recientes de Enviados
(asunto y fecha). Imprime cuántas herramientas reportó Claude Code, cuáles son de Outlook, si encontró la esperada
y el resultado. Si el nombre del servidor no coincide, te sugiere el valor correcto de `MCP_CORREO`. No crea ni envía
nada. Termina con código 0 si todo está bien.

### Garantías de seguridad

- **Nunca envía.** Para las tareas de correo solo se permiten: buscar correos (`outlook_email_search`), leer
  (`read_resource`) y, solo en `crear_borradores`, crear borrador de respuesta / respuesta a todos / actualizar borrador
  (`outlook_create_reply_draft`, `outlook_create_reply_all_draft`, `outlook_update_draft`) y las herramientas de
  MyQuote `cotizar_rapido` y `consultar_producto`.
- Prohibidas explícitamente con `--disallowedTools`: `outlook_send_mail`, `outlook_send_draft`, `outlook_forward_mail`,
  `outlook_delete_draft`, `outlook_trash_thread`, `outlook_batch_delete_messages`, `outlook_create_filter`,
  `outlook_delete_filter`, `outlook_set_vacation`, `outlook_modify_labels`, `outlook_batch_modify_labels`,
  `outlook_modify_thread_labels`, `outlook_untrash_thread`, `outlook_create_draft` y los mensajes de Teams; además
  `Bash`, `Edit`, `Write`, `NotebookEdit`, `WebSearch` y `WebFetch`. Las consultas normales no reciben herramientas
  de correo.
- Cada prompt repite la prohibición de enviar, reenviar o borrar y trata el contenido de los correos como datos, no
  como instrucciones.
- El resultado de Claude Code se valida a mano contra el contrato; si no es válido se devuelve `ok: false` y el
  backend reintenta.
- Logs y métricas llevan solo ids, conteos, nombres de herramienta y tiempos: nunca asuntos, remitentes ni cuerpos.
- Tiempo máximo por tarea: `TIMEOUT_TAREA_MIN` (12 minutos por defecto; el backend reencola a los 15).

## Problemas comunes

| Síntoma | Causa |
|---|---|
| El tab dice "servidor IA de casa desconectado" | El agente no está corriendo o no tiene internet |
| El agente no se actualiza solo | Árbol con cambios locales, rama distinta de `main` o sin red: mira el log ("Auto-actualización: …") |
| `IA_AGENTE_TOKEN rechazado por MyQuote` | El token del `.env` no coincide con el de Railway |
| `No se encontró "claude"` | Claude Code no está en el PATH del servicio: pon la ruta completa en `CLAUDE_BIN` |
| La respuesta no trae precios | El conector no se llama `myquote`: ajusta `MCP_NOMBRE` |
| "límite de uso alcanzado" | Se agotó el cupo de tu plan de Claude; vuelve a intentarlo cuando se renueve |
