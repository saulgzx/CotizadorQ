# Relevamiento — cuándo preguntar y qué preguntar

## Cuándo NO preguntar

Si el correo trae el modelo o el MPN, no preguntes nada: cotiza. Preguntar lo obvio
retrasa una respuesta que podía salir en dos minutos, y ese es justamente el caso que
esta skill existe para resolver sola.

Tampoco preguntes cuando el dato faltante no cambia la cotización. Si piden un
TS-464-8G y no dicen para qué lo usan, el precio y el plazo son los mismos.

## Cuándo sí

Cuando el requerimiento es una categoría y no un producto: *"necesito un NAS para la
empresa"*, *"algo para almacenamiento"*, *"un equipo para respaldar las cámaras"*.
Ahí un itemizado a ciegas es peor que una pregunta.

## Las preguntas

Pregunta **solo las que cambian la respuesta**. Mandar las veintitantas de golpe
hace que el cliente no conteste ninguna. Tres a cinco, bien elegidas, se contestan.

### Uso y entorno
- ¿Cuál es el caso de uso principal? (backup, archivo, vigilancia IP, virtualización, colaboración, multimedia)
- ¿Va a virtualizar máquinas o contenedores, o solo alojar y compartir datos?
- ¿Cuántos usuarios concurrentes?
- ¿Entorno doméstico, PYME o corporativo?

### Almacenamiento
- ¿Cuánta capacidad útil se necesita hoy?
- ¿Proyección de crecimiento a 3–5 años?
- ¿Qué nivel de RAID? (1, 5, 6, 10)
- ¿Los discos los pone el cliente o van en la cotización?
- ¿HDD, SSD o NVMe?

### Disponibilidad y resiliencia
- ¿Requiere fuente redundante (PSU dual)?
- ¿Requiere alta disponibilidad o failover?
- ¿Hay requerimiento de continuidad operacional crítica?

### Conectividad
- ¿Qué velocidad de red? (1GbE, 2.5GbE, 10GbE, 25GbE)
- ¿Necesita expansión o link aggregation?

### Instalación física
- ¿Rack o escritorio/torre?
  - Si es rack: ¿de cuántas U dispone? ¿tiene rack propio o va en la cotización?
- ¿Restricciones de espacio, temperatura o humedad?

## Cómo entregarlas

No como cuestionario numerado de diez ítems. Redáctalas como el correo que Alexis
mandaría: un párrafo corto que explique por qué necesitas el dato, y las preguntas
en viñetas. Ejemplo:

```
Hola {Nombre}.
                Para dimensionar bien y no cotizarte de más, necesito tres datos:

  •  Capacidad útil que necesitas hoy y cuánto esperas crecer en 3 años.
  •  Si el equipo va en rack o en escritorio — si es rack, cuántas U tienes libres.
  •  Si los discos los pones tú o los incluyo en la cotización.

Con eso te mando el itemizado hoy mismo.

Quedo atento
Saludos
```

Cuando entregues esto, dilo claro: es un correo de relevamiento, no una cotización.
