-- Stage 2 performance indexes
-- Run during low-traffic window.

CREATE INDEX IF NOT EXISTS productos_activo_id_desc_idx
  ON productos (activo, id DESC);

CREATE INDEX IF NOT EXISTS productos_origen_id_desc_idx
  ON productos (origen, id DESC);

CREATE INDEX IF NOT EXISTS cotizaciones_created_at_desc_idx
  ON cotizaciones (created_at DESC);

CREATE INDEX IF NOT EXISTS cotizaciones_usuario_created_at_desc_idx
  ON cotizaciones (usuario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cotizaciones_estado_created_at_desc_idx
  ON cotizaciones (estado, created_at DESC);

CREATE INDEX IF NOT EXISTS cotizacion_items_cotizacion_id_idx
  ON cotizacion_items (cotizacion_id);

CREATE INDEX IF NOT EXISTS bo_meta_deleted_last_seen_idx
  ON bo_meta (deleted, last_seen_at DESC);
