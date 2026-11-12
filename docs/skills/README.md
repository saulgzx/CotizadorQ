# Skills de preventa — dónde vive cada cosa

Hay **dos consumidores** de las mismas skills, y conviene tener claro cuál lee qué.

## 1. El agente de MyQuote (este repo)

`backend/src/ia/skills/preventa-axis/` y `.../preventa-qnap/`.

`backend/src/services/asistenteIA.js` lee **solo** `SKILL.md` y `references/*.md`, y los
inyecta en el prompt. Cualquier otro archivo que pongas en esa carpeta **se ignora en
silencio**. Esta es la fuente de verdad: lo que se edita acá es lo que cambia la
respuesta del agente en el tab Asistente IA y en WhatsApp.

## 2. Claude Code / Claude.ai (la cuenta de Alexis)

Las skills viven en `~/.claude/skills/` y se instalan pegando un MD instalador. Ahí sí
existen `INSTRUCCIONES.md` y `MEMORIA.md`, que van dentro de `CLAUDE.md`.

Esa copia **no se actualiza desde el repo**: hay que reinstalarla cuando las skills
cambian. Por eso existe el generador.

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `MEMORIA.md` | Contexto y correcciones de Alexis. **La misma para las dos marcas.** Manda sobre la skill cuando hay conflicto. |
| `preventa-axis-INSTRUCCIONES.md` | Rol y reglas de ingeniería de la línea Axis: evidencia, jerarquía de fuentes, homologaciones, EETT, control de calidad. |
| `preventa-qnap-INSTRUCCIONES.md` | Lo mismo para QNAP. |
| `instalador-preventa-axis.md` | **Generado.** No editar a mano. |
| `instalador-preventa-qnap.md` | **Generado.** No editar a mano. |

## Regenerar los instaladores

Después de tocar cualquier `SKILL.md`, `references/*.md`, `MEMORIA.md` o
`*-INSTRUCCIONES.md`:

```bash
npm run skills:instalador --prefix backend
```

El script empaqueta las skills del repo, les suma INSTRUCCIONES y MEMORIA, y **verifica
que cada bloque del MD coincida byte a byte con su archivo fuente** antes de escribir.
Si algo no calza, falla en vez de generar un instalador silenciosamente distinto.

Después: abrir el MD generado, copiarlo entero y pegarlo en una sesión de Claude Code
con el conector MyQuote disponible. El propio MD trae la verificación al final.
