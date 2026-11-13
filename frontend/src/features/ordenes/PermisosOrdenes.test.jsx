// Permisos de Órdenes y Vista compras: son SOLO para admin. El perfil Intcomex
// "compras" ya no existe, así que un cliente (con o sin ese perfil en su sesión)
// no ve esas opciones ni dispara la carga de órdenes.
import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('./arnesOrdenes.testutil.jsx')).crearApiMock());

import { precalentar, api, prepararApi, renderApp } from './arnesOrdenes.testutil.jsx';

const CLIENTE = { id: 2, usuario: 'cliente', nombre: 'Cliente', role: 'client', empresa: 'Otra' };
const CLIENTE_INTCOMEX_COMPRAS = {
  id: 3, usuario: 'compras', nombre: 'Compras', role: 'client', empresa: 'intcomex', intcomex_profile: 'compras'
};

// Entradas de menú (hay menú de escritorio y barra con botones) con ese nombre.
const entradas = (nombre) => [
  ...screen.queryAllByRole('menuitem', { name: nombre }),
  ...screen.queryAllByRole('button', { name: nombre })
];

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  prepararApi();
});

describe.each([
  ['cliente sin perfil', CLIENTE],
  ['cliente Intcomex con perfil compras en la sesión', CLIENTE_INTCOMEX_COMPRAS]
])('permisos de órdenes: %s', (_nombre, usuario) => {
  it('entrando directo a /admin/ordenes no pide órdenes y cae en la vista de cliente', async () => {
    renderApp({ user: usuario, ruta: '/admin/ordenes' });
    // Llega a la vista de cliente: tiene menú con Cotizador y sin opciones de admin.
    await waitFor(() => expect(entradas('Cotizador').length).toBeGreaterThan(0));
    expect(entradas('Órdenes activas')).toHaveLength(0);
    expect(entradas('Vista compras')).toHaveLength(0);
    expect(api.osoAPI.getOrders).not.toHaveBeenCalled();
  });

  it('entrando directo a /admin/compras tampoco ve la vista ni pide órdenes', async () => {
    renderApp({ user: usuario, ruta: '/admin/compras' });
    await waitFor(() => expect(entradas('Cotizador').length).toBeGreaterThan(0));
    expect(entradas('Vista compras')).toHaveLength(0);
    expect(screen.queryByText('Estado de compra, despacho y vía de cada BO del OSO.')).not.toBeInTheDocument();
    expect(api.osoAPI.getOrders).not.toHaveBeenCalled();
  });
});
