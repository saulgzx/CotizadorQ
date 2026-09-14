# CotizadorQ MCP

Servidor MCP **remoto** para operar CotizadorQ desde Claude Code y Claude Desktop
sin instalar nada local. Se despliega en Railway como un servicio aparte del
backend, dentro del mismo repo.

## Tools

| Tool | Escribe? | Que hace |
|---|---|---|
| `consultar_producto` | No | Precio, stock, plazo, estado del SKU y garantia de un SKU o MPN |
| `buscar_productos` | No | Busqueda por texto, ordenada por coincidencia y stock |
| `simular_cotizacion` | No | Calcula el total sin guardar nada. **Es el camino por defecto** |
| `generar_cotizacion` | **Si** | Graba la cotizacion y devuelve su id |
| `emitir_pdf` | No | PDF en base64 de una cotizacion existente |
| `cotizar_y_emitir` | **Si** | Encadena las dos anteriores |

Las dos que escriben lo dicen explicitamente en su descripcion, para que el
modelo pida confirmacion antes de invocarlas.

## Como calcula los precios

El servidor **no calcula precios**. Manda `producto_id` + `cantidad` y el backend
resuelve el resto contra la tabla `productos` usando el GP de la cuenta de
servicio.

Esto no es un detalle de implementacion, es la garantia de seguridad: con una
cuenta rol `client` el backend **descarta** cualquier precio que llegue en la
peticion. Aunque alguien logre inyectar instrucciones en el texto que procesa el
modelo, no puede escribir un precio arbitrario en una cotizacion real.

> Con una cuenta rol `admin` esa proteccion **desaparece**: el backend acepta los
> precios tal como llegan. Usa siempre una cuenta `client`.

## Cuenta de servicio

Creala desde CotizadorQ (**Usuarios → Nuevo**, requiere admin):

- Usuario: `mcp_bot`
- Rol: `client`
- GP QNAP: `15%` · GP AXIS: `13%`
- Partner category: la que corresponda (afecta el rebate AXIS)

## Deploy en Railway

1. En el proyecto de Railway: **New → GitHub Repo → `saulgzx/CotizadorQ`**.
2. En el servicio nuevo, **Settings → Root Directory** = `mcp-server`.
3. **Settings → Build**: Railway detecta el `Dockerfile` automaticamente.
4. **Variables** (ver `.env.example` para la lista completa):

   | Variable | Valor |
   |---|---|
   | `COTIZADOR_API_URL` | `https://cotizadorq-backend-production.up.railway.app` |
   | `COTIZADOR_USER` | usuario de la cuenta de servicio |
   | `COTIZADOR_PASS` | su password |
   | `CONNECTOR_SECRET` | un secreto largo y aleatorio |

5. **Settings → Networking → Generate Domain**. Esa es la URL del MCP.

Si falta cualquier variable el proceso sale con error al arrancar y el deploy
queda en rojo, en vez de quedar vivo y fallar en la primera consulta.

Para generar el secreto, en PowerShell. **Usa hexadecimal**: base64 produce
`+`, `/` y `=`, y una barra dentro del secreto rompe la variante `/mcp/<secreto>`
porque parte la URL en varios segmentos.

```bash
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

## Conectar Claude Code

```bash
claude mcp add --transport http cotizadorq https://TU-DOMINIO.up.railway.app/mcp --header "Authorization: Bearer TU_SECRETO"
```

## Conectar Claude Desktop

Claude Desktop no siempre permite headers, por eso el servidor acepta el secreto
tambien como segmento de la ruta. En **Settings → Connectors → Add custom
connector**, usa:

```
https://TU-DOMINIO.up.railway.app/mcp/TU_SECRETO
```

> El secreto va en la URL: tratala como una credencial. No la pegues en chats,
> tickets ni capturas.

## Verificar

```bash
curl https://TU-DOMINIO.up.railway.app/health
```

Sin secreto valido, `/mcp` responde `401`.

## Ejemplos de uso

**Consultar un producto**
> "Consultá el precio y stock del SKU Q8752-E"

**Simular sin guardar** (lo habitual)
> "Simulá una cotización para Acme Corp: 2 unidades de TS-464U-RP y 3 de Q8752-E"

**Guardar y emitir** (pide confirmacion)
> "Ya validé la simulación, guardala para Acme Corp y emití el PDF"

## Stock, plazos y rotulos

- **`entrega` solo se afirma con stock leido en vivo.** Si la lectura falla,
  `entrega` es `null`, `stock_verificado` es `false` y el texto dice «plazo no
  verificado». El plazo de catalogo va aparte en `entrega_catalogo`, rotulado
  como referencial.
- **Ultima lectura buena.** Cada lectura exitosa se guarda en
  `STOCK_SNAPSHOT_PATH`. Si el stock se cae, se muestra ese dato con su fecha:
  `12 u. al 12-sep 09:40 · no verificado hoy`. Para que sobreviva deploys, monta
  un volumen en Railway.
- **Aviso de caida.** Cada `MONITOR_INTERVALO_MIN` se hace un login nuevo y se
  lee el stock. Al segundo fallo seguido se avisa a `ALERTA_WEBHOOK_URL` (una
  vez por caida, y otra al recuperarse). `/health` muestra el semaforo.
- **`sku_estado`**: `por_crear` cuando el SKU es «To Create»; el plazo suma
  `DIAS_CREACION_SKU`.
- **Garantia**: solo la de `src/datos/garantias.ts`, validada a mano. Un modelo
  sin fila responde «sin validar»; nunca se hereda de la familia.
- **Busqueda**: ordena MPN exacto → prefijo de MPN → SKU → texto y, dentro de
  cada grupo, con stock primero. EOL (`src/datos/eol.ts` + `MCP_EOL_MPN`) y
  «por crear» se rotulan y bajan dentro de su grupo, sin ocultarse.

## Tests

```bash
npm test
```

## Notas

- El catalogo se cachea 10 min y el stock 5 min (`CATALOGO_TTL_MIN`,
  `STOCK_TTL_MIN`). El backend no tiene endpoint de busqueda, asi que se trae el
  catalogo completo y se filtra en memoria.
- Hay un solo login en vuelo a la vez. Dos logins simultaneos con el mismo
  `X-Session-Id` chocaban con el indice unico de `sesiones` y el backend
  respondia 500. Es la causa mas probable de la caida de stock del 14-sep-2026
  (el catalogo cargaba y el stock no).
- El stock se cruza por **MPN**, no por SKU.
- Un SKU inexistente se reporta aparte y no tumba la corrida.
- El JWT se cachea; ante un `401` se re-loguea una vez y reintenta.
- `429` y `5xx` se reintentan con backoff exponencial, respetando `Retry-After`.
- Ni el password ni el token aparecen en logs ni en mensajes de error.
