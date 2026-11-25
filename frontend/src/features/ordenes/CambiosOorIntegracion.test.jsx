// Cambios del OOR con la aplicación completa: el pop-up sale solo al entrar como admin,
// «Ver en Órdenes» lleva a la vista y un usuario que no es admin no dispara la consulta.
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('./arnesOrdenes.testutil.jsx')).crearApiMock());

import { api, precalentar, prepararApi, renderApp, enrutador, irAVista, ADMIN } from './arnesOrdenes.testutil.jsx';
import { crearCambios } from './cambiosOor.testdata';

vi.setConfig({ testTimeout: 30000 });

const CLIENTE = { id: 2, usuario: 'cliente', nombre: 'Cliente', role: 'client', empresa: 'Otra' };

const llamadasOor = () => api.oorRed.responder.mock.calls.filter(([e]) => String(e).includes('/pendiente'));

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  prepararApi();
});

describe('Cambios del OOR en la aplicación', () => {
  it('sin cambios no sale ningún pop-up', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await waitFor(() => expect(llamadasOor().length).toBeGreaterThan(0));
    expect(screen.queryByRole('dialog', { name: 'Cambió el OOR' })).toBeNull();
    expect(llamadasOor()[0][0]).toBe('/api/oor/cambios/pendiente');
  });

  it('el admin ve el pop-up al entrar y «Ver en Órdenes» lo lleva a esa BO', async () => {
    api.oorRed.responder.mockResolvedValue(crearCambios());
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    const pop = await screen.findByRole('dialog', { name: 'Cambió el OOR' });
    const tarjeta = within(pop).getByRole('region', { name: 'BO 4978126' });
    expect(within(tarjeta).getByRole('heading', { name: 'De enero a junio de 2026' })).toBeInTheDocument();

    fireEvent.click(within(tarjeta).getByRole('button', { name: 'Ver en Órdenes' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cambió el OOR' })).toBeNull());
    await waitFor(() => expect(enrutador.ubicacion.pathname).toBe('/admin/ordenes'));
    const buscador = await screen.findByRole('textbox', { name: 'Buscar' });
    expect(buscador).toHaveValue('4978126');
    // Quedó pospuesto: el aviso chico sigue disponible.
    expect(screen.getByRole('button', { name: 'Cambios del OOR sin revisar (3 BO)' })).toBeInTheDocument();
  });

  it('desde Órdenes el botón «Cambios del OOR» abre el historial', async () => {
    api.oorRed.responder.mockImplementation(async (endpoint) => {
      if (endpoint.endsWith('/historial')) return { items: [] };
      return { hay: false, motivo: 'sin_cambios' };
    });
    renderApp({ user: ADMIN, ruta: '/admin/ordenes' });
    fireEvent.click(await screen.findByRole('button', { name: 'Cambios del OOR' }));
    expect(await screen.findByRole('dialog', { name: 'Cambios del OOR revisados' })).toBeInTheDocument();
    expect(await screen.findByText('Aún no hay cambios revisados.')).toBeInTheDocument();
  });

  it('un usuario que no es admin no dispara la consulta', async () => {
    api.oorRed.responder.mockResolvedValue(crearCambios());
    renderApp({ user: CLIENTE, ruta: '/cotizador' });
    await waitFor(() => expect(screen.queryAllByRole('heading', { level: 2, name: 'Cotización' }).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 200));
    expect(api.oorRed.responder).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Cambió el OOR' })).toBeNull();
  });

  it('«Actualizar OOR» está en Órdenes y en Listas de precio, y abre el pop-up con lo leído', async () => {
    api.oorRed.responder.mockImplementation(async (endpoint) => {
      if (endpoint === '/api/oor/actualizar') return { ...crearCambios(), lineas: 900 };
      return { hay: false, motivo: 'sin_cambios' };
    });
    renderApp({ user: ADMIN, ruta: '/admin/ordenes' });
    fireEvent.click(await screen.findByRole('button', { name: 'Actualizar OOR' }));
    expect(await screen.findByRole('dialog', { name: 'Cambió el OOR' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }));

    await irAVista('Listas de precio');
    expect(await screen.findByRole('button', { name: 'Sync rápido QNAP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualizar OOR' })).toBeInTheDocument();
  });

  it('un usuario que no es admin no ve «Actualizar OOR»', async () => {
    renderApp({ user: CLIENTE, ruta: '/cotizador' });
    await waitFor(() => expect(screen.queryAllByRole('heading', { level: 2, name: 'Cotización' }).length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Actualizar OOR' })).toBeNull();
  });
});
