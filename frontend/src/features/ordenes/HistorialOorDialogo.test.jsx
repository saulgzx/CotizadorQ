import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./oorApi', () => ({
  oorApi: { pendiente: vi.fn(), marcarVisto: vi.fn(), historial: vi.fn(), revision: vi.fn() }
}));
vi.mock('../ui/toast', () => ({ notify: vi.fn() }));

import HistorialOorDialogo from './HistorialOorDialogo';
import { oorApi } from './oorApi';
import { crearCambios } from './cambiosOor.testdata';

const montar = (props = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const alertas = { onCerrar: vi.fn(), onAbrirOrden: vi.fn() };
  render(
    <QueryClientProvider client={client}>
      <HistorialOorDialogo {...alertas} {...props} />
    </QueryClientProvider>
  );
  return alertas;
};

const REVISIONES = {
  items: [
    {
      id: 2, visto_en: '2026-11-26T15:30:00.000Z', desde: { id: 10, tomado_en: '2026-11-20T12:00:00.000Z' },
      hasta: { id: 11, tomado_en: '2026-11-25T12:00:00.000Z' },
      resumen: { bos: 3, bosAtrasadas: 1, bosConFacturacionAfectada: 1 }
    },
    {
      id: 1, visto_en: '2026-11-10T15:30:00.000Z', desde: null,
      hasta: { id: 10, tomado_en: '2026-11-09T12:00:00.000Z' },
      resumen: { bos: 5, bosAtrasadas: 2, bosConFacturacionAfectada: 0 }
    }
  ]
};

describe('HistorialOorDialogo', () => {
  beforeEach(() => {
    Object.values(oorApi).forEach((f) => f.mockReset());
  });

  it('lista las revisiones con su resumen', async () => {
    oorApi.historial.mockResolvedValue(REVISIONES);
    montar();
    expect(screen.getByRole('dialog', { name: 'Cambios del OOR revisados' })).toBeInTheDocument();
    const lista = await screen.findByRole('list', { name: 'Revisiones' });
    const items = within(lista).getAllByRole('button');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Revisado el 26-nov-2026');
    expect(items[0]).toHaveTextContent('3 BO con cambios · 1 atrasadas · 1 con facturación afectada');
    expect(items[1]).toHaveTextContent('5 BO con cambios · 2 atrasadas · 0 con facturación afectada');
  });

  it('vacío', async () => {
    oorApi.historial.mockResolvedValue({ items: [] });
    montar();
    expect(await screen.findByText('Aún no hay cambios revisados.')).toBeInTheDocument();
  });

  it('error al cargar', async () => {
    oorApi.historial.mockRejectedValue(new Error('Sin conexión'));
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
  });

  it('al elegir una carga la revisión y la muestra en solo lectura', async () => {
    oorApi.historial.mockResolvedValue(REVISIONES);
    oorApi.revision.mockResolvedValue({ ...crearCambios(), visto_en: '2026-11-26T15:30:00.000Z' });
    montar();
    fireEvent.click((await screen.findAllByRole('button', { name: /Revisado el 26-nov-2026/ }))[0]);
    await waitFor(() => expect(oorApi.revision).toHaveBeenCalledWith(2));
    expect(await screen.findByRole('dialog', { name: 'Cambió el OOR' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como revisado' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copiar resumen' })).toBeInTheDocument();
    // Cerrar el detalle vuelve a la lista.
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cambió el OOR' })).toBeNull());
    expect(screen.getByRole('list', { name: 'Revisiones' })).toBeInTheDocument();
  });

  it('Ver en Órdenes cierra el historial y avisa la BO', async () => {
    oorApi.historial.mockResolvedValue(REVISIONES);
    oorApi.revision.mockResolvedValue({ ...crearCambios(), visto_en: '2026-11-26T15:30:00.000Z' });
    const { onCerrar, onAbrirOrden } = montar();
    fireEvent.click((await screen.findAllByRole('button', { name: /Revisado el 26-nov-2026/ }))[0]);
    const t = await screen.findByRole('region', { name: 'BO 4978126' });
    fireEvent.click(within(t).getByRole('button', { name: 'Ver en Órdenes' }));
    expect(onCerrar).toHaveBeenCalled();
    expect(onAbrirOrden).toHaveBeenCalledWith('4978126');
  });
});
