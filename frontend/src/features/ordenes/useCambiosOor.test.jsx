import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('./oorApi', () => ({ oorApi: { pendiente: vi.fn(), marcarVisto: vi.fn() } }));
vi.mock('../ui/toast', () => ({ notify: vi.fn() }));

import { useCambiosOor } from './useCambiosOor';
import { oorApi } from './oorApi';

const envoltorio = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useCambiosOor: una sola consulta al entrar', () => {
  beforeEach(() => {
    oorApi.pendiente.mockReset().mockResolvedValue({ hay: false, motivo: 'sin_cambios' });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no vuelve a consultar por tiempo', async () => {
    vi.useFakeTimers();
    renderHook(() => useCambiosOor({ activo: true }), { wrapper: envoltorio() });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(oorApi.pendiente).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60 * 1000); });
    expect(oorApi.pendiente).toHaveBeenCalledTimes(1);
  });

  it('no vuelve a consultar al volver el foco', async () => {
    const { result } = renderHook(() => useCambiosOor({ activo: true }), { wrapper: envoltorio() });
    await waitFor(() => expect(result.current.datos).not.toBeNull());
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(oorApi.pendiente).toHaveBeenCalledTimes(1);
  });
});
