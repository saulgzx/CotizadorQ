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
   node agente.mjs
   ```

   Debe decir `Esperando consultas…`. Haz una consulta desde el tab de MyQuote
   y mira cómo la resuelve. Corta con Ctrl+C.

## 6. Dejarlo corriendo siempre

**Linux (systemd).** Edita `myquote-agente.service` y cambia `TU_USUARIO`
(y la ruta si clonaste en otro lado). Luego:

```bash
sudo cp myquote-agente.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now myquote-agente
journalctl -u myquote-agente -f
```

**Windows (Programador de tareas).**

1. Abre **Programador de tareas** → **Crear tarea…**
2. **General**: nombre `MyQuote agente IA`, marca **Ejecutar tanto si el usuario
   inició sesión como si no**.
3. **Desencadenadores** → Nuevo → **Al iniciar el sistema**.
4. **Acciones** → Nuevo → Programa: `node`, Argumentos: `agente.mjs`,
   Iniciar en: la carpeta `agente-ia` completa.
5. **Configuración**: marca **Si la tarea no se ejecuta, reiniciarla cada 1 minuto**.

Ponle al miniPC el arranque automático tras un corte de luz (opción de la BIOS
"Restore on AC power loss") para que vuelva solo.

## Problemas comunes

| Síntoma | Causa |
|---|---|
| El tab dice "servidor IA de casa desconectado" | El agente no está corriendo o no tiene internet |
| `IA_AGENTE_TOKEN rechazado por MyQuote` | El token del `.env` no coincide con el de Railway |
| `No se encontró "claude"` | Claude Code no está en el PATH del servicio: pon la ruta completa en `CLAUDE_BIN` |
| La respuesta no trae precios | El conector no se llama `myquote`: ajusta `MCP_NOMBRE` |
| "límite de uso alcanzado" | Se agotó el cupo de tu plan de Claude; vuelve a intentarlo cuando se renueve |
