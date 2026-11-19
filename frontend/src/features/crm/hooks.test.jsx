import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { useCambiarEtapa, useGuardarSeguimiento, useSincronizarOrdenes } from './hooks';
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

describe('useCambiarEtapa › caché del árbol', () => {
  const ARBOL = { oportunidades: [{ id: 1, etapa: 'cotizada', dias_en_etapa: 5 }, { id: 2, etapa: 'nueva', dias_en_etapa: 2 }], cotizaciones: [] };
  const montar = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.crm.arbol, ARBOL);
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { client, ...renderHook(() => useCambiarEtapa(), { wrapper }) };
  };

  test('parchea la oportunidad en el árbol al instante', async () => {
    let resolver;
    crmApi.actualizarOportunidad.mockReturnValue(new Promise((r) => { resolver = r; }));
    const { client, result } = montar();
    act(() => { result.current.mutate({ id: 1, etapa: 'ganada' }); });
    await waitFor(() => expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[0]).toMatchObject({ etapa: 'ganada', dias_en_etapa: 0 }));
    expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[1].etapa).toBe('nueva');
    await act(async () => { resolver({}); });
  });

  test('si el servidor falla, restaura el árbol y avisa', async () => {
    crmApi.actualizarOportunidad.mockRejectedValue(new Error('Sin permiso'));
    const { client, result } = montar();
    await act(async () => {
      await result.current.mutateAsync({ id: 1, etapa: 'perdida', motivo_perdida: 'Precio' }).catch(() => {});
    });
    expect(client.getQueryData(queryKeys.crm.arbol)).toEqual(ARBOL);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('No se pudo mover a Perdida'), { tipo: 'error' });
  });
});

describe('useCambiarEtapa › seguimiento', () => {
  const montar = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.crm.arbol, {
      oportunidades: [
        { id: 1, etapa: 'cotizada', proximo_seguimiento: '2026-11-20', seguimiento_nota: 'Llamar' },
        { id: 2, etapa: 'nueva', proximo_seguimiento: '2026-11-21', seguimiento_nota: null }
      ],
      cotizaciones: []
    });
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { client, ...renderHook(() => useCambiarEtapa(), { wrapper }) };
  };

  test.each(['ganada', 'perdida'])('al pasar a %s limpia el seguimiento al instante, solo en esa oportunidad', async (etapa) => {
    let resolver;
    crmApi.actualizarOportunidad.mockReturnValue(new Promise((r) => { resolver = r; }));
    const { client, result } = montar();
    act(() => { result.current.mutate({ id: 1, etapa, motivo_perdida: 'Precio' }); });
    await waitFor(() =>
      expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[0]).toMatchObject({ etapa, proximo_seguimiento: null, seguimiento_nota: null })
    );
    expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[1]).toMatchObject({ proximo_seguimiento: '2026-11-21' });
    await act(async () => { resolver({}); });
  });

  test('entre etapas abiertas conserva el seguimiento', async () => {
    let resolver;
    crmApi.actualizarOportunidad.mockReturnValue(new Promise((r) => { resolver = r; }));
    const { client, result } = montar();
    act(() => { result.current.mutate({ id: 1, etapa: 'negociacion' }); });
    await waitFor(() => expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[0].etapa).toBe('negociacion'));
    expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[0]).toMatchObject({ proximo_seguimiento: '2026-11-20', seguimiento_nota: 'Llamar' });
    await act(async () => { resolver({}); });
  });

  test('si el servidor falla, el seguimiento vuelve', async () => {
    crmApi.actualizarOportunidad.mockRejectedValue(new Error('Sin permiso'));
    const { client, result } = montar();
    await act(async () => {
      await result.current.mutateAsync({ id: 1, etapa: 'ganada' }).catch(() => {});
    });
    expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[0]).toMatchObject({
      etapa: 'cotizada', proximo_seguimiento: '2026-11-20', seguimiento_nota: 'Llamar'
    });
  });
});

describe('useGuardarSeguimiento', () => {
  const ARBOL = {
    oportunidades: [
      { id: 1, etapa: 'cotizada', proximo_seguimiento: null, seguimiento_nota: null },
      { id: 2, etapa: 'nueva', proximo_seguimiento: '2026-11-21', seguimiento_nota: 'Otra' }
    ],
    cotizaciones: []
  };
  const montar = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.crm.arbol, ARBOL);
    client.setQueryData(queryKeys.crm.oportunidades, { items: [{ id: 1, proximo_seguimiento: null, seguimiento_nota: null }] });
    client.setQueryData(queryKeys.crm.empresa(10), { oportunidades: [{ id: 1, proximo_seguimiento: null, seguimiento_nota: null }] });
    const invalidar = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { client, invalidar, ...renderHook(() => useGuardarSeguimiento(), { wrapper }) };
  };

  test('llama al servidor, parchea las tres cachés al instante, avisa e invalida el CRM', async () => {
    let resolver;
    crmApi.actualizarOportunidad.mockReturnValue(new Promise((r) => { resolver = r; }));
    const { client, invalidar, result } = montar();
    act(() => {
      result.current.mutate({ id: 1, proximo_seguimiento: '2026-11-25', seguimiento_nota: 'Llamar a Ana' });
    });
    const esperado = { proximo_seguimiento: '2026-11-25', seguimiento_nota: 'Llamar a Ana' };
    await waitFor(() => expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[0]).toMatchObject(esperado));
    expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[1]).toMatchObject({ proximo_seguimiento: '2026-11-21' });
    expect(client.getQueryData(queryKeys.crm.oportunidades).items[0]).toMatchObject(esperado);
    expect(client.getQueryData(queryKeys.crm.empresa(10)).oportunidades[0]).toMatchObject(esperado);
    await act(async () => { resolver({}); });
    expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, esperado);
    expect(notify).toHaveBeenCalledWith('Seguimiento guardado', { tipo: 'ok' });
    await waitFor(() => expect(invalidar).toHaveBeenCalledWith({ queryKey: queryKeys.crm.todo }));
  });

  test('sin fecha avisa que se quitó y trata undefined como null', async () => {
    crmApi.actualizarOportunidad.mockResolvedValue({});
    const { client, result } = montar();
    await act(async () => {
      await result.current.mutateAsync({ id: 2, proximo_seguimiento: null });
    });
    expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(2, { proximo_seguimiento: null, seguimiento_nota: undefined });
    expect(notify).toHaveBeenCalledWith('Seguimiento quitado', { tipo: 'ok' });
    // La respuesta optimista ya dejó la oportunidad sin seguimiento (null, no undefined).
    expect(client.getQueryData(queryKeys.crm.arbol).oportunidades[1]).toMatchObject({ proximo_seguimiento: null, seguimiento_nota: null });
  });

  test('si el servidor falla, restaura las cachés y avisa con el error', async () => {
    crmApi.actualizarOportunidad.mockRejectedValue(new Error('Sin permiso'));
    const { client, result } = montar();
    await act(async () => {
      await result.current.mutateAsync({ id: 1, proximo_seguimiento: '2026-11-25', seguimiento_nota: 'x' }).catch(() => {});
    });
    expect(client.getQueryData(queryKeys.crm.arbol)).toEqual(ARBOL);
    expect(client.getQueryData(queryKeys.crm.oportunidades).items[0].proximo_seguimiento).toBeNull();
    expect(client.getQueryData(queryKeys.crm.empresa(10)).oportunidades[0].proximo_seguimiento).toBeNull();
    expect(notify).toHaveBeenCalledWith('No se pudo guardar el seguimiento: Sin permiso', { tipo: 'error' });
  });
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
