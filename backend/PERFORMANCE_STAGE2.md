# Stage 2 - Impacto de performance (medicion manual)

## Cache endpoints caros
- Endpoints: `/api/stock`, `/api/stock/catalog`, `/api/oso/orders`
- Verificacion: revisar header `X-Cache` (`MISS` en primera llamada, `HIT` en llamadas dentro del TTL).
- Impacto esperado: segunda llamada evita roundtrip a Google Sheets y reduce latencia de forma visible.

## Cotizaciones (N+1 eliminado)
- Antes: 1 query por item para cargar producto + inserts individuales.
- Despues: carga de productos por lote (`ANY`) + insercion batch de items en una sola sentencia.
- Impacto esperado: menos queries por cotizacion con muchos items, menor tiempo total y menor carga DB.

## Paginacion
- Endpoints: `/api/productos` (admin), `/api/cotizaciones`
- Impacto esperado: menor payload y menor tiempo de respuesta cuando hay volumen alto.
