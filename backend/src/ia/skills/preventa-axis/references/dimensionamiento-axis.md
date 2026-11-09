# Dimensionamiento Axis

Los cálculos van al **bloque de control interno**, nunca al correo. El cliente recibe
la conclusión; Alexis revisa la aritmética.

Para cualquier proyecto que vaya a licitación o que el cliente vaya a auditar, el
cálculo formal se hace en **AXIS Site Designer**. Esta guía sirve para responder rápido
y para saber si la propuesta se sostiene, no para reemplazarlo. Dilo cuando aplique.

## Densidad de píxeles — qué se puede hacer con la imagen

El criterio que decide el lente. Se mide en píxeles por metro (px/m) sobre el objetivo:

| Objetivo | px/m | Qué permite |
|---|---|---|
| Detección | ~25 | Hay alguien / algo se movió |
| Observación | ~62 | Qué está pasando, ropa, dirección |
| Reconocimiento | ~125 | Es alguien que ya conozco |
| Identificación | ~250 | Quién es, sin conocerlo de antes |
| Lectura de patente | ~250–400 | Según velocidad y ángulo |

La pregunta al cliente casi nunca es "qué resolución quiere" sino **"a qué distancia
necesitas identificar a una persona"**. De ahí sale el lente.

Cálculo:

```
px/m = ancho_sensor_px / ancho_escena_m
ancho_escena_m ≈ 2 × distancia_m × tan(FoV_horizontal / 2)
```

Si te piden identificación a 20 m con una fija de 1080p (1920 px), necesitas una escena
de ~7,7 m de ancho → FoV de ~21° → lente tele, no gran angular. Ese es el error clásico:
cotizar una varifocal estándar para una identificación a distancia.

## Altura y ángulo de montaje

- **Identificación de rostro**: 2,5–3 m de altura, ángulo bajo (≤15° respecto a la
  horizontal). Más alto y solo ves coronillas.
- **Visión general / disuasión**: 3,5–5 m, ángulo mayor, sin problema.
- **Patentes**: lo más alineado posible con el eje del vehículo; ángulos sobre 30°
  laterales o verticales degradan la lectura.
- **Exterior con retroiluminación** (portones, accesos con sol de frente): WDR es
  requisito, no un extra.

## Almacenamiento

```
GB/día por cámara = (bitrate_Mbps × 3600 × horas_grabación) / 8 / 1000
TB_total = GB/día × n_cámaras × días_retención / 1000
```

Bitrates de referencia con Zipstream y H.265, escena de movimiento medio:

| Configuración | Bitrate típico |
|---|---|
| 1080p @ 15 fps | 1,5–3 Mbps |
| 1080p @ 25 fps | 2,5–4 Mbps |
| 4 MP @ 15 fps | 3–5 Mbps |
| 4K @ 15 fps | 6–10 Mbps |

Tres ajustes que hay que aplicar:

1. **Grabación por evento** en vez de continua baja el total un 40–70 % según escena.
   Si el cliente no lo especifica, calcula continua y menciona el ahorro como opción.
2. **Escena de alto movimiento** (tránsito, patios de maniobra, retail en hora punta):
   suma 30–50 %.
3. **Margen del arreglo**: aplica el mismo criterio del NAS — RAID + 0,909 de TB a TiB
   + 15 % libre.

Grabación en borde con AXIS Surveillance Card: sirve como respaldo ante caída de red o
para sitios sin servidor, no como almacenamiento principal de un proyecto. Si es lo
único, dilo.

## Alimentación PoE

- Fijas compactas y la mayoría de las bullet/dome estándar: PoE clase 3 (~12,95 W) →
  T8120 15W alcanza.
- Cámaras con calefactor, IR potente o carcasa exterior: revisa la ficha; muchas piden
  High PoE (30 W o más).
- PTZ: casi siempre High PoE o fuente dedicada. No asumas.
- Si el cliente tiene switch PoE pero no sabes el presupuesto de potencia, menciónalo:
  ocho cámaras con calefactor pueden exceder el budget de un switch modesto.

## Familias — para orientarse rápido

| Serie | Uso |
|---|---|
| M | Compacta, presupuesto ajustado, interior |
| P | Uso general, el caballo de batalla en proyectos |
| Q | Alto desempeño, condiciones exigentes, PTZ de largo alcance |
| F / FA | Modular, sensor separado de la unidad principal |
| C | Audio (altavoces, bocinas) |
| A | Control de acceso e intercomunicadores |
| T | Infraestructura: T81 midspans, T91 soportes, T92/T94 carcasas y housings |

Es una guía de orientación, no una especificación. El modelo concreto se confirma
siempre contra la ficha oficial y contra lo que exista en MyQuote.

## Cuándo devolvérselo a Alexis

- Licitación o pliego con especificación formal.
- Homologación contra una marca competidora en un proceso.
- Arquitecturas con VMS, failover, o integración con sistemas de terceros.
- Proyectos donde el cliente pide una solución, no equipos.

Avanza lo que puedas y entrégale el bloque interno con lo que falta.
