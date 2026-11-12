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

export function renderConQuery(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
