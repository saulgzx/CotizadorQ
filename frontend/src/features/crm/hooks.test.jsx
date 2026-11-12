import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { useCambiarEtapa } from './hooks';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';

vi.mock('./crmApi', () => ({ crmApi: { actualizarOportunidad: vi.fn() } }));
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
