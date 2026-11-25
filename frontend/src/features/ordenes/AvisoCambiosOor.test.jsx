import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('./oorApi', () => ({
  oorApi: { pendiente: vi.fn(), marcarVisto: vi.fn(), historial: vi.fn(), revision: vi.fn() }
}));
vi.mock('../ui/toast', () => ({ notify: vi.fn() }));

import AvisoCambiosOor from './AvisoCambiosOor';
import { oorApi } from './oorApi';
import { notify } from '../ui/toast';
import { crearCambios } from './cambiosOor.testdata';

const montar = (props = {}, extra = null) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = (p, e) => (
    <QueryClientProvider client={client}>
      <AvisoCambiosOor activo onAbrirOrden={vi.fn()} {...p} />
      {e}
    </QueryClientProvider>
  );
  const r = render(ui(props, extra));
  return { ...r, client, rerenderCon: (p, e) => r.rerender(ui(p, e)) };
};

const pop = () => screen.queryByRole('dialog', { name: 'Cambió el OOR' });

describe('AvisoCambiosOor', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.values(oorApi).forEach((f) => f.mockReset());
    notify.mockReset();
    oorApi.pendiente.mockResolvedValue({ hay: false, motivo: 'sin_cambios' });
    oorApi.marcarVisto.mockResolvedValue({ ok: true, revision_id: 7 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no pregunta nada si no está activo', async () => {
    montar({ activo: false });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(oorApi.pendiente).not.toHaveBeenCalled();
    expect(pop()).toBeNull();
  });

  it('con hay:false no muestra nada', async () => {
    montar();
    await waitFor(() => expect(oorApi.pendiente).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(pop()).toBeNull();
    expect(screen.queryByRole('button', { name: /sin revisar/ })).toBeNull();
  });

  it('con hay:true abre el pop-up solo', async () => {
    oorApi.pendiente.mockResolvedValue(crearCambios());
    montar();
    expect(await screen.findByRole('dialog', { name: 'Cambió el OOR' })).toBeInTheDocument();
  });

  it('marcar como revisado llama a la API, avisa y cierra', async () => {
    oorApi.pendiente.mockResolvedValue(crearCambios());
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como revisado' }));
    await waitFor(() => expect(oorApi.marcarVisto).toHaveBeenCalledWith(11));
    await waitFor(() => expect(pop()).toBeNull());
    expect(notify).toHaveBeenCalledWith('Cambios del OOR marcados como revisados', expect.anything());
    expect(screen.queryByRole('button', { name: /sin revisar/ })).toBeNull();
  });

  it('si marcar falla avisa el error y deja el pop-up abierto', async () => {
    oorApi.pendiente.mockResolvedValue(crearCambios());
    oorApi.marcarVisto.mockRejectedValue(new Error('Servidor caído'));
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como revisado' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Servidor caído', { tipo: 'error' }));
    expect(pop()).not.toBeNull();
  });

  it('Más tarde lo pospone y deja el aviso chico, que lo reabre', async () => {
    oorApi.pendiente.mockResolvedValue(crearCambios());
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Más tarde' }));
    expect(pop()).toBeNull();
    expect(sessionStorage.getItem('oorPospuesto')).toBe('11');
    expect(oorApi.marcarVisto).not.toHaveBeenCalled();
    const aviso = screen.getByRole('button', { name: 'Cambios del OOR sin revisar (3 BO)' });
    fireEvent.click(aviso);
    expect(pop()).not.toBeNull();
    expect(screen.queryByRole('button', { name: /sin revisar/ })).toBeNull();
  });

  it('Escape también lo pospone', async () => {
    oorApi.pendiente.mockResolvedValue(crearCambios());
    montar();
    await screen.findByRole('dialog', { name: 'Cambió el OOR' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(pop()).toBeNull();
    expect(screen.getByRole('button', { name: /sin revisar/ })).toBeInTheDocument();
  });

  it('una versión pospuesta no vuelve a saltar sola al montar de nuevo', async () => {
    sessionStorage.setItem('oorPospuesto', '11');
    oorApi.pendiente.mockResolvedValue(crearCambios());
    montar();
    expect(await screen.findByRole('button', { name: /sin revisar/ })).toBeInTheDocument();
    expect(pop()).toBeNull();
  });

  it('una versión nueva vuelve a abrirlo aunque la anterior estuviera pospuesta', async () => {
    sessionStorage.setItem('oorPospuesto', '10');
    oorApi.pendiente.mockResolvedValue(crearCambios()); // hasta.id = 11
    montar();
    expect(await screen.findByRole('dialog', { name: 'Cambió el OOR' })).toBeInTheDocument();
  });

  it('Ver en Órdenes pospone y avisa a quien lo montó', async () => {
    oorApi.pendiente.mockResolvedValue(crearCambios());
    const onAbrirOrden = vi.fn();
    montar({ onAbrirOrden });
    const t = await screen.findByRole('region', { name: 'BO 5000001' });
    fireEvent.click(t.querySelector('button'));
    expect(onAbrirOrden).toHaveBeenCalledWith('5000001');
    expect(pop()).toBeNull();
  });

  it('estabilizando vuelve a consultar después de revisar_en_seg', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    oorApi.pendiente
      .mockResolvedValueOnce({ hay: false, motivo: 'estabilizando', revisar_en_seg: 20 })
      .mockResolvedValue(crearCambios());
    montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(oorApi.pendiente).toHaveBeenCalledTimes(1);
    expect(pop()).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(19_000); });
    expect(oorApi.pendiente).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(oorApi.pendiente).toHaveBeenCalledTimes(2);
    expect(pop()).not.toBeNull();
  });

  it('estabilizando espera al menos 15 s aunque pidan menos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    oorApi.pendiente.mockResolvedValue({ hay: false, motivo: 'estabilizando', revisar_en_seg: 2 });
    montar();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(oorApi.pendiente).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(oorApi.pendiente).toHaveBeenCalledTimes(2);
  });

  it('un error de red no muestra nada', async () => {
    oorApi.pendiente.mockRejectedValue(new Error('Failed to fetch'));
    montar();
    await waitFor(() => expect(oorApi.pendiente).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(pop()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /sin revisar/ })).toBeNull();
  });

  it('no se abre encima de otro diálogo: espera a que se cierre', async () => {
    oorApi.pendiente.mockResolvedValue(crearCambios());
    const otro = <div role='dialog' aria-label='Otro diálogo'>otro</div>;
    const { rerenderCon } = montar({}, otro);
    await waitFor(() => expect(oorApi.pendiente).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(pop()).toBeNull();
    rerenderCon({}, null);
    await waitFor(() => expect(pop()).not.toBeNull(), { timeout: 4000 });
  });
});
