# Asistente IA por WhatsApp

Usa la **WhatsApp Business Cloud API** oficial de Meta. Los mensajes llegan al
backend de MyQuote en Railway, entran a la misma cola que el tab web y los
resuelve el agente de tu miniPC. Responder mensajes que tú inicias no tiene costo.

Necesitas el agente funcionando (ver `README.md`).

## 1. Crear la app en Meta

1. Entra a **developers.facebook.com** → **Mis apps** → **Crear app**.
2. Tipo **Empresa** (Business) y asóciala a tu cuenta de Meta Business (si no
   tienes, la crea en el camino).
3. En la app, agrega el producto **WhatsApp** → **Configurar**.

## 2. Número

- **Para probar:** Meta te da un **número de prueba** gratis. En **WhatsApp →
  Configuración de la API**, en "Para", agrega tu número personal y confírmalo
  con el código que te llega.
- **Definitivo:** agrega un número propio (un chip que **no** esté usando la app
  de WhatsApp) en **WhatsApp → Configuración de la API → Agregar número**.

Anota el **Identificador del número de teléfono** (Phone number ID).

## 3. Token permanente

El token que aparece en la página de la API dura 24 horas. Para uno permanente:

1. **business.facebook.com** → **Configuración** → **Usuarios del sistema** →
   **Agregar** (rol Administrador).
2. **Asignar activos** → tu app → control total.
3. **Generar token** → tu app → caducidad **Nunca** → permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`.

## 4. Variables en Railway

Servicio **cotizadorQ-backend** → **Variables**:

| Variable | Valor |
|---|---|
| `WHATSAPP_TOKEN` | el token permanente del paso 3 |
| `WHATSAPP_PHONE_NUMBER_ID` | el identificador del paso 2 |
| `WHATSAPP_APP_SECRET` | en developers.facebook.com → tu app → **Configuración de la app → Básica → Clave secreta** |
| `WHATSAPP_VERIFY_TOKEN` | un texto que inventes (por ejemplo `myquote-wa-2026`) |
| `WHATSAPP_NUMEROS` | tu número con código de país, sin `+` ni espacios: `56912345678`. Varios separados por coma |

Aprieta **Deploy**.

## 5. Conectar el webhook

1. developers.facebook.com → tu app → **WhatsApp → Configuración**.
2. **Webhook → Editar**:
   - URL de devolución de llamada:
     `https://cotizadorq-backend-production.up.railway.app/api/whatsapp/webhook`
   - Token de verificación: el mismo `WHATSAPP_VERIFY_TOKEN`.
3. **Verificar y guardar**. Luego, en **Campos del webhook**, suscribe **messages**.

## 6. Usarlo

Escríbele al número de WhatsApp:

- El requerimiento tal cual, o el correo pegado. La IA deduce la marca.
- Empieza con `axis` o `qnap` para forzar la skill.
- Sigue escribiendo para ajustar la última respuesta.
- `nueva` empieza una conversación nueva. `ayuda` muestra estos comandos.

Solo se atienden los números de `WHATSAPP_NUMEROS`; los demás se ignoran.
