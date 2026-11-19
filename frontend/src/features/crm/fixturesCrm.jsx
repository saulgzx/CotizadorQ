import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Datos con la forma del contrato /api/crm y utilidades para las pruebas.

export const op = (extra) => ({
  id: 1,
  titulo: 'Cotización #101',
  etapa: 'cotizada',
  empresa_id: 10,
  empresa_nombre: 'Sonda S.A.',
  contacto_id: 5,
  contacto_nombre: 'Ana Pérez',
  marca: 'AXIS',
  es_proyecto: false,
  monto: 1500.5,
  fecha_cierre_estimada: null,
  motivo_perdida: null,
  cotizaciones: 1,
  dias_en_etapa: 3,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-08T10:00:00Z',
  ...extra
});

export const OPORTUNIDADES = [
  op({ id: 1, cotizacion_id: 77, cotizacion_numero: 101 }),
  op({ id: 2, titulo: 'Proyecto BID Norte', etapa: 'negociacion', empresa_id: 11, empresa_nombre: 'Entel', marca: 'QNAP', es_proyecto: true, monto: 8200, dias_en_etapa: 1 }),
  op({ id: 3, titulo: 'Cotización #090', etapa: 'ganada', monto: 300, marca: 'MIXTA' }),
  op({ id: 4, titulo: 'Cotización #080', etapa: 'perdida', monto: 120, motivo_perdida: 'Precio' })
];

export const EMBUDO = {
  etapas: [
    { etapa: 'nueva', cantidad: 0, monto: 0 },
    { etapa: 'cotizada', cantidad: 1, monto: 1500.5 },
    { etapa: 'negociacion', cantidad: 1, monto: 8200 },
    { etapa: 'ganada', cantidad: 1, monto: 300 },
    { etapa: 'perdida', cantidad: 1, monto: 120 }
  ],
  abiertas: { cantidad: 2, monto: 9700.5 },
  ganadas_mes: { cantidad: 1, monto: 300 },
  perdidas_mes: { cantidad: 1, monto: 120 }
};

export const FICHA = {
  empresa: { id: 10, nombre: 'Sonda S.A.', rut: '83.628.100-4', sitio: 'sonda.com', notas: null, archivada: false },
  contactos: [
    { id: 5, empresa_id: 10, nombre: 'Ana Pérez', email: 'ana@sonda.com', telefono: '+56 9 1111 2222', cargo: 'Compras', archivado: false },
    { id: 6, empresa_id: 10, nombre: 'Luis Rojas', email: null, telefono: null, cargo: null, archivado: true }
  ],
  oportunidades: [op({ id: 1 })],
  cotizaciones: [{ id: 77, numero: 101, total: 1500.5, estado: 'enviada', created_at: '2026-11-01T10:00:00Z', contacto_id: 5, oportunidad_id: 1 }],
  resumen: { cotizaciones: 4, monto_cotizado: 12000, ganadas: 1, perdidas: 3, monto_ganado: 3000, tasa_cierre: 0.25 }
};

// Respuesta de GET /api/crm/arbol (oportunidades por updated_at desc; cotizaciones por created_at desc).
// Seguimiento: la 2 está vencida (con nota) y la 4 es futura; el resto no tiene.
// Los ids de cotización (501…) difieren de su número (1041…) para distinguir uno del otro.
export const opArbol = (extra) => ({
  id: 1,
  titulo: 'NAS sucursal Norte',
  etapa: 'negociacion',
  empresa_id: 10,
  empresa_nombre: 'Acme SA',
  contacto_id: 5,
  contacto_nombre: 'Ana Pérez',
  marca: 'QNAP',
  es_proyecto: false,
  monto: 12400,
  fecha_cierre_estimada: null,
  motivo_perdida: null,
  cotizaciones: 2,
  cotizacion_id: 501,
  cotizacion_numero: 1041,
  dias_en_etapa: 6,
  cerrada_en: null,
  archivada_en: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-08T10:00:00Z',
  bo: null,
  proximo_seguimiento: null,
  seguimiento_nota: null,
  ...extra
});

export const cotArbol = (extra) => ({
  id: 501,
  numero: 1041,
  version: 2,
  total: 12400,
  created_at: '2026-11-02T12:00:00Z',
  oportunidad_id: 1,
  usuario: 'alexis',
  proyecto: 'Proyecto Norte',
  pid: 'PID-77',
  ...extra
});

export const ARBOL = {
  oportunidades: [
    opArbol({ id: 1 }),
    opArbol({ id: 2, titulo: 'Cámaras bodega', etapa: 'cotizada', marca: 'AXIS', monto: 35800, cotizaciones: 1, cotizacion_id: 503, cotizacion_numero: 1050, dias_en_etapa: 14, contacto_nombre: null, proximo_seguimiento: '2020-01-10', seguimiento_nota: 'Llamar a Ana por el descuento' }),
    opArbol({ id: 3, titulo: 'Orden BO-1001', etapa: 'ganada', marca: 'AXIS', monto: 9300, cotizaciones: 0, cotizacion_id: null, cotizacion_numero: null, dias_en_etapa: 40, bo: 'BO-1001', contacto_nombre: null }),
    opArbol({ id: 4, titulo: 'Switches Beta', etapa: 'cotizada', empresa_id: 11, empresa_nombre: 'Beta Ltda', marca: null, monto: 7150, cotizaciones: 1, cotizacion_id: 504, cotizacion_numero: 1060, dias_en_etapa: 1, contacto_nombre: 'Luis Rojas', proximo_seguimiento: '2099-12-15' }),
    opArbol({ id: 5, titulo: 'Proyecto BID Entel', etapa: 'negociacion', empresa_id: 12, empresa_nombre: 'Entel', marca: 'MIXTA', es_proyecto: true, monto: 20000, cotizaciones: 0, cotizacion_id: null, cotizacion_numero: null, dias_en_etapa: 0, contacto_nombre: null }),
    opArbol({ id: 6, titulo: 'Rack perdido', etapa: 'perdida', empresa_id: 11, empresa_nombre: 'Beta Ltda', marca: 'QNAP', monto: 900, cotizaciones: 0, cotizacion_id: null, cotizacion_numero: null, motivo_perdida: 'Precio', dias_en_etapa: 30, contacto_nombre: null })
  ],
  cotizaciones: [
    cotArbol({ id: 501, numero: 1041, oportunidad_id: 1 }),
    cotArbol({ id: 502, numero: 1038, version: 1, total: 11900, oportunidad_id: 1, created_at: '2026-10-28T12:00:00Z', pid: null }),
    cotArbol({ id: 503, numero: 1050, version: 1, total: 35800, oportunidad_id: 2, proyecto: null, pid: null, created_at: '2026-11-03T12:00:00Z' }),
    cotArbol({ id: 504, numero: 1060, version: 1, total: 7150, oportunidad_id: 4, proyecto: null, pid: null, usuario: 'maría', created_at: '2026-11-04T12:00:00Z' })
  ],
  total_oportunidades: 6,
  truncado: false
};

export function renderConQuery(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
