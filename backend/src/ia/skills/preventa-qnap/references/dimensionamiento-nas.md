# Dimensionamiento NAS

Todos estos cálculos van al **bloque de control interno**, no al correo. El cliente
recibe la conclusión ("el TS-464 con 4×8 TB en RAID 5 te deja ~21 TB útiles"); Alexis
revisa la aritmética.

## Capacidad útil según RAID

Con `n` discos de `c` TB cada uno:

| RAID | Capacidad bruta | Tolera | Uso típico |
|---|---|---|---|
| 0 | `n × c` | 0 discos | Nunca en producción |
| 1 | `c` (con n=2) | 1 disco | 2 bahías, datos críticos |
| 5 | `(n−1) × c` | 1 disco | 4+ bahías, el caso más común |
| 6 | `(n−2) × c` | 2 discos | 8+ bahías, o discos >8 TB |
| 10 | `(n/2) × c` | 1 por espejo | Cuando pesa el IOPS |

Dos ajustes que hay que aplicar siempre y que la gente olvida:

1. **TB comerciales → TiB reales**: multiplica por 0,909. Un disco de "8 TB" formatea
   ~7,3 TiB.
2. **Margen de operación**: reserva 15–20 % libre. Un NAS sobre 85 % de ocupación se
   degrada.

Fórmula práctica de capacidad útil real:

```
útil ≈ (bruta_según_RAID) × 0,909 × 0,85
```

Ejemplo: TS-464 con 4 × 8 TB en RAID 5 → (3 × 8) × 0,909 × 0,85 ≈ **18,5 TB
utilizables**. No prometas 24 TB.

Con discos de 8 TB o más, RAID 6 sobre RAID 5: la reconstrucción de un disco grande
tarda tanto que la probabilidad de un segundo fallo durante el rebuild deja de ser
despreciable.

## Bahías: dimensionar para crecer

Regla: si el cliente proyecta crecimiento a 3–5 años, no llenes todas las bahías en la
compra inicial. Un 4 bahías lleno hoy obliga a reemplazar discos completos para crecer;
un 6 u 8 bahías con la mitad poblada crece agregando.

Advertencia que conviene decir: en la mayoría de los modelos no se puede expandir un
grupo RAID existente agregando un disco sin migración. Verifica el caso puntual en
qnap.com/es-la antes de afirmarlo.

## Vigilancia IP — días de grabación

```
GB/día por cámara = (bitrate_Mbps × 3600 × horas_día) / 8 / 1000
capacidad_necesaria_TB = GB/día × n_cámaras × días_retención / 1000
```

Bitrates de referencia (H.265, escena de movimiento medio):

| Resolución | Bitrate típico |
|---|---|
| 1080p @ 15 fps | 2–3 Mbps |
| 1080p @ 30 fps | 3–5 Mbps |
| 4 MP @ 15 fps | 4–6 Mbps |
| 4K @ 15 fps | 8–12 Mbps |

Son estimaciones. Si el proyecto es grande o va a licitación, dilo: el cálculo fino se
hace con la herramienta del fabricante de cámaras, no con una tabla.

Además: QNAP licencia canales de QVR Pro/Elite por separado del hardware. Si el
requerimiento es vigilancia, revisa en catálogo si hacen falta licencias de canal y
cotízalas — olvidarlas es el error clásico de esta línea.

## Red

- 1GbE satura ~110 MB/s. Con más de 5 usuarios concurrentes sobre archivos grandes,
  se nota.
- 2.5GbE viene de fábrica en buena parte de la línea actual y no siempre requiere
  switch nuevo (muchos switches lo negocian).
- 10GbE tiene sentido con edición de video, virtualización o backup con ventana corta.
  Si lo propones, verifica que el cliente tenga switch 10GbE — si no, hay que cotizarlo
  y eso cambia el presupuesto.

## Cuándo NO dimensionar solo

Devuélvelo a Alexis, con lo que alcanzaste a avanzar, cuando:

- Es una licitación o proyecto con especificación técnica formal.
- Hay alta disponibilidad, failover o clustering de por medio.
- Hay que homologar contra un equipo de otra marca en un pliego.
- El cliente pide una arquitectura, no un equipo.

Estos son los casos que él prefiere revisar personalmente.
