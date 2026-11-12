import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { useCambiarEtapa, useSincronizarOrdenes } from './hooks';
import { crmApi } from './crmApi';
import { notify } from '../ui/toast';
import { queryKeys } from '../../app/queryKeys';

vi.mock('./crmApi', () => ({ crmApi: { actualizarOportunidad: vi.fn(), sincronizarOrdenes: vi.fn() } }));
vi.mock('../ui/toast', () => ({ notify: vi.fn() }));

test('mover una oportunidad en el embudo invalida el CRM y la lista de cotizaciones', async () => {
  crmApi.actualizarOportunidad.mockResolvedValue({ id: 1, etapa: 'ganada' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useCambiarEtapa(), { wrapper });

  await act(async () => {
    await result.current.mutateAsync({ id: 1, etapa: 'ganada' });
  });

  await waitFor(() => {
    expect(invalidar).toHaveBeenCalledWith({ queryKey: queryKeys.crm.todo });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: queryKeys.cotizaciones });
  });
  expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'ganada' });
});

describe('useSincronizarOrdenes', () => {
  const montar = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { ...renderHook(() => useSincronizarOrdenes(), { wrapper }), invalidar };
  };

  test('resume lo que hizo e invalida el CRM y las cotizaciones', async () => {
    crmApi.sincronizarOrdenes.mockResolvedValue({
      ordenes: 12, creadas: 3, enlazadas: 1, ganadas: 0, sinCambio: 8, sinCliente: 0, errores: 0
    });
    const { result, invalidar } = montar();

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(notify).toHaveBeenCalledWith('12 órdenes revisadas: 3 nuevas, 1 enlazada', { tipo: 'ok' });
    await waitFor(() => {
      expect(invalidar).toHaveBeenCalledWith({ queryKey: queryKeys.crm.todo });
      expect(invalidar).toHaveBeenCalledWith({ queryKey: queryKeys.cotizaciones });
    });
  });

  test('sin cambios lo dice sin enumerar ceros', async () => {
    crmApi.sincronizarOrdenes.mockResolvedValue({
      ordenes: 9, creadas: 0, enlazadas: 0, ganadas: 0, sinCambio: 9, sinCliente: 0, errores: 0
    });
    const { result } = montar();

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(notify).toHaveBeenCalledWith('9 órdenes revisadas, el embudo ya estaba al día', { tipo: 'ok' });
  });

  test('un error en alguna orden tiñe el aviso', async () => {
    crmApi.sincronizarOrdenes.mockResolvedValue({
      ordenes: 4, creadas: 1, enlazadas: 0, ganadas: 0, sinCambio: 2, sinCliente: 0, errores: 1
    });
    const { result } = montar();

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(notify).toHaveBeenCalledWith('4 órdenes revisadas: 1 nueva, 1 con error', { tipo: 'error' });
  });
});
