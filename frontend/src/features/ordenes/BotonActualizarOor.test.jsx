import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./oorApi', () => ({
  oorApi: { pendiente: vi.fn(), actualizar: vi.fn(), marcarVisto: vi.fn(), historial: vi.fn(), revision: vi.fn() }
}));
vi.mock('../ui/toast', () => ({ notify: vi.fn() }));

import BotonActualizarOor from './BotonActualizarOor';
import AvisoCambiosOor from './AvisoCambiosOor';
import { oorApi } from './oorApi';
import { notify } from '../ui/toast';
import { crearCambios } from './cambiosOor.testdata';

const montar = ({ conAviso = false } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      {conAviso && <AvisoCambiosOor activo />}
      <BotonActualizarOor />
    </QueryClientProvider>
  );
  return client;
};
const boton = () => screen.getByRole('button', { name: /Actualizar OOR|Leyendo OOR…/ });

describe('BotonActualizarOor', () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.values(oorApi).forEach((f) => f.mockReset());
    notify.mockReset();
    oorApi.pendiente.mockResolvedValue({ hay: false, motivo: 'sin_cambios' });
  });

  it('sin cambios', async () => {
    oorApi.actualizar.mockResolvedValue({ hay: false, motivo: 'sin_cambios', lineas: 812 });
    montar();
    fireEvent.click(boton());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('El OOR no tiene cambios desde tu última revisión (812 líneas leídas)', { tipo: 'ok' }));
  });

  it('primera vez', async () => {
    oorApi.actualizar.mockResolvedValue({ hay: false, motivo: 'primera_vez', lineas: 100 });
    montar();
    fireEvent.click(boton());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Primera lectura del OOR guardada (100 líneas). Desde ahora, al actualizarlo verás qué cambió.', { tipo: 'ok' }));
  });

  it('sin datos, con y sin aviso', async () => {
    oorApi.actualizar.mockResolvedValueOnce({ hay: false, motivo: 'sin_datos', lineas: 0, avisos: ['Falta la columna PO.'] });
    montar();
    fireEvent.click(boton());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('La pestaña OOR está vacía o no se pudo leer. Falta la columna PO.', { tipo: 'error' }));
    oorApi.actualizar.mockResolvedValueOnce({ hay: false, motivo: 'sin_datos', lineas: 0 });
    fireEvent.click(boton());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('La pestaña OOR está vacía o no se pudo leer.', { tipo: 'error' }));
  });

  it('error del servidor o de red se muestra', async () => {
    oorApi.actualizar.mockRejectedValue(new Error('La planilla del OOR no está configurada'));
    montar();
    fireEvent.click(boton());
    await waitFor(() => expect(notify).toHaveBeenCalledWith('La planilla del OOR no está configurada', { tipo: 'error' }));
    expect(boton()).not.toBeDisabled();
  });

  it('mientras lee dice «Leyendo OOR…», se deshabilita y no se puede apretar dos veces', async () => {
    let resolver;
    oorApi.actualizar.mockReturnValue(new Promise((r) => { resolver = r; }));
    montar();
    fireEvent.click(boton());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Leyendo OOR…' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Leyendo OOR…' }));
    expect(oorApi.actualizar).toHaveBeenCalledTimes(1);
    await act(async () => resolver({ hay: false, motivo: 'sin_cambios', lineas: 1 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar OOR' })).not.toBeDisabled());
  });

  it('con hay:true abre un solo pop-up, aunque estuviera pospuesto', async () => {
    sessionStorage.setItem('oorPospuesto', '11');
    oorApi.pendiente.mockResolvedValue(crearCambios());
    oorApi.actualizar.mockResolvedValue({ ...crearCambios(), lineas: 900 });
    montar({ conAviso: true });
    await screen.findByRole('button', { name: /sin revisar/ });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(boton());
    expect(await screen.findByRole('dialog', { name: 'Cambió el OOR' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('con hay:true y sin pop-up previo, la caché alimenta al aviso', async () => {
    oorApi.actualizar.mockResolvedValue({ ...crearCambios(), lineas: 900 });
    montar({ conAviso: true });
    await waitFor(() => expect(oorApi.pendiente).toHaveBeenCalled());
    fireEvent.click(boton());
    expect(await screen.findByRole('dialog', { name: 'Cambió el OOR' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
