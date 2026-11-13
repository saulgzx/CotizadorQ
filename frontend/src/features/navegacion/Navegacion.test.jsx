// Tests de NAVEGACIÓN de la aplicación completa (rutas + menú + permisos).
// Fijan lo que el usuario ve, no cómo está armado: se escribieron contra el código
// anterior al cambio a "una sola página persistente" y deben seguir pasando igual.
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('../ordenes/arnesOrdenes.testutil.jsx')).crearApiMock());

import {
  precalentar, prepararApi, renderApp, irAVista, enrutador, ADMIN
} from '../ordenes/arnesOrdenes.testutil.jsx';

const CLIENTE = { id: 2, usuario: 'cliente', nombre: 'Cliente', role: 'client', empresa: 'Otra' };

// Cada vista y algo estable que solo ella muestra.
const encabezado = (nombre) => async () => (await screen.findAllByRole('heading', { level: 2, name: nombre }))[0];
const hayEncabezado = (nombre) => () => screen.queryAllByRole('heading', { level: 2, name: nombre }).length > 0;
const hayOrdenes = () => !!screen.queryByRole('button', { name: 'BO BO-1001' });
const hayCompras = () => !!screen.queryByText('Estado de compra, despacho y vía de cada BO del OSO.');

// [menú, ¿se ve lo propio de la vista?, ruta a la que lleva (null: la vista no tiene ruta propia)]
const VISTAS_ADMIN = [
  ['Dashboard', hayEncabezado('Dashboard'), '/dashboard'],
  ['Cotizador', hayEncabezado('Cotización'), '/cotizador'],
  ['Stock disponible', hayEncabezado('Stock disponible'), null],
  ['Órdenes activas', hayOrdenes, '/admin/ordenes'],
  ['Vista compras', hayCompras, null],
  ['CRM', hayEncabezado('CRM'), '/crm'],
  ['Listas de precio', hayEncabezado('Listas de precio'), null],
  ['Usuarios', hayEncabezado('Usuarios'), '/admin/usuarios'],
  ['Asistente IA', hayEncabezado('Asistente IA'), '/ia']
];

// Va a la vista por el menú y espera a que se vea lo suyo Y a que la URL se asiente. Esperar solo
// el contenido no basta: hoy el clic muestra la vista primero y recién después cambia la ruta.
const llegarA = async (nombre, hayVista, ruta) => {
  const condicion = () => {
    if (ruta) expect(enrutador.ubicacion.pathname).toBe(ruta);
    expect(hayVista()).toBe(true);
  };
  await irAVista(nombre);
  await waitFor(condicion);
  // Margen para que termine lo que quedó en vuelo (efectos de la página que acaba de
  // llegar): un clic justo en ese instante se perdía y el test dependía del reloj.
  await act(() => new Promise(resolver => setTimeout(resolver, 150)));
  await waitFor(condicion);
};

// Entradas de menú (hay menú de escritorio y barra con botones) con ese nombre.
const entradas = (nombre) => [
  ...screen.queryAllByRole('menuitem', { name: nombre }),
  ...screen.queryAllByRole('button', { name: nombre })
];

const rutaActual = () => enrutador.ubicacion.pathname;

// Varios casos recorren muchas vistas seguidas: con la máquina cargada no caben en los 5 s
// por defecto, y un caso que se corta deja su recorrido haciendo clics sobre el siguiente.
vi.setConfig({ testTimeout: 30000 });

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  prepararApi();
});

describe('Navegación del admin por el menú', () => {
  it('desde el menú se llega a cada vista y se ve algo propio de ella', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await encabezado('Dashboard')();
    for (const [nombre, hayVista, ruta] of VISTAS_ADMIN) {
      await llegarA(nombre, hayVista, ruta);
    }
  });

  it('el menú del admin ofrece todas las vistas', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await encabezado('Dashboard')();
    [...VISTAS_ADMIN.map(([n]) => n)].forEach(n => expect(entradas(n).length).toBeGreaterThan(0));
    // El admin completo no tiene "Mis cotizaciones" ni "Mi cuenta".
    expect(entradas('Mis cotizaciones')).toHaveLength(0);
    expect(entradas('Mi cuenta')).toHaveLength(0);
  });

  it('el menú cambia la URL de las vistas que tienen ruta', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await encabezado('Dashboard')();
    await llegarA('Cotizador', hayEncabezado('Cotización'), '/cotizador');
    await llegarA('Usuarios', hayEncabezado('Usuarios'), '/admin/usuarios');
    await llegarA('Órdenes activas', hayOrdenes, '/admin/ordenes');
  });

  it('Alt+número cambia de vista', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await encabezado('Dashboard')();
    fireEvent.keyDown(window, { key: '2', altKey: true });
    await encabezado('Cotización')();
    await waitFor(() => expect(rutaActual()).toBe('/cotizador'));
    fireEvent.keyDown(window, { key: '1', altKey: true });
    await encabezado('Dashboard')();
    await waitFor(() => expect(rutaActual()).toBe('/dashboard'));
  });

  it('el buscador rápido (Ctrl+K) lleva a otra vista', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await encabezado('Dashboard')();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const cuadro = await screen.findByRole('dialog');
    const opcion = await waitFor(() => {
      const hallada = Array.from(cuadro.querySelectorAll('button, [role="option"]'))
        .find(el => el.textContent.trim().startsWith('Usuarios'));
      if (!hallada) throw new Error('El buscador no ofrece Usuarios');
      return hallada;
    });
    fireEvent.click(opcion);
    await encabezado('Usuarios')();
    await waitFor(() => expect(rutaActual()).toBe('/admin/usuarios'));
  });

  it('atrás y adelante del navegador cambian de vista', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await encabezado('Dashboard')();
    act(() => enrutador.navegar('/cotizador'));
    await encabezado('Cotización')();
    act(() => enrutador.navegar('/admin/usuarios'));
    await encabezado('Usuarios')();
    act(() => enrutador.navegar(-1));
    await encabezado('Cotización')();
    await waitFor(() => expect(rutaActual()).toBe('/cotizador'));
    act(() => enrutador.navegar(-1));
    await encabezado('Dashboard')();
    await waitFor(() => expect(rutaActual()).toBe('/dashboard'));
    act(() => enrutador.navegar(1));
    await encabezado('Cotización')();
    await waitFor(() => expect(rutaActual()).toBe('/cotizador'));
  });
});

describe('Entrada directa por URL', () => {
  it.each([
    ['/dashboard', 'Dashboard', encabezado('Dashboard')],
    ['/cotizador', 'Cotizador', encabezado('Cotización')],
    ['/ia', 'Asistente IA', encabezado('Asistente IA')],
    ['/crm', 'CRM', encabezado('CRM')],
    ['/admin/usuarios', 'Usuarios', encabezado('Usuarios')],
    ['/admin/ordenes', 'Órdenes activas', () => screen.findByRole('button', { name: 'BO BO-1001' })]
  ])('%s muestra la vista %s', async (ruta, _nombre, esperar) => {
    renderApp({ user: ADMIN, ruta });
    expect(await esperar()).toBeInTheDocument();
    expect(rutaActual()).toBe(ruta);
  });

  it('/historial del admin termina en CRM > Cotizaciones', async () => {
    renderApp({ user: ADMIN, ruta: '/historial' });
    await encabezado('CRM')();
    await waitFor(() => expect(rutaActual()).toBe('/crm'));
    await waitFor(() => expect(enrutador.ubicacion.search).toBe('?tab=cotizaciones'));
  });

  it('una URL desconocida y la raíz terminan en el Dashboard', async () => {
    const { unmount } = renderApp({ user: ADMIN, ruta: '/no-existe' });
    await encabezado('Dashboard')();
    await waitFor(() => expect(rutaActual()).toBe('/dashboard'));
    unmount();
    renderApp({ user: ADMIN, ruta: '/' });
    await encabezado('Dashboard')();
    await waitFor(() => expect(rutaActual()).toBe('/dashboard'));
  });
});

describe('Usuario que no es admin', () => {
  it.each(['/crm', '/admin/usuarios', '/admin/ordenes'])('%s por URL termina en el Cotizador', async (ruta) => {
    renderApp({ user: CLIENTE, ruta });
    await encabezado('Cotización')();
    await waitFor(() => expect(rutaActual()).toBe('/cotizador'));
  });

  it('no ve en el menú las vistas de admin, pero sí las suyas', async () => {
    renderApp({ user: CLIENTE, ruta: '/cotizador' });
    await encabezado('Cotización')();
    ['CRM', 'Órdenes activas', 'Vista compras', 'Listas de precio', 'Usuarios', 'Asistente IA']
      .forEach(n => expect(entradas(n)).toHaveLength(0));
    ['Cotizador', 'Mis cotizaciones', 'Stock disponible', 'Dashboard', 'Mi cuenta']
      .forEach(n => expect(entradas(n).length).toBeGreaterThan(0));
  });

  it('llega a sus vistas por el menú', async () => {
    renderApp({ user: CLIENTE, ruta: '/cotizador' });
    await encabezado('Cotización')();
    await llegarA('Mis cotizaciones', hayEncabezado('Mis cotizaciones'), '/historial');
    await llegarA('Stock disponible', hayEncabezado('Stock disponible'), null);
    await llegarA('Mi cuenta', hayEncabezado('Mi cuenta'), null);
    await llegarA('Dashboard', hayEncabezado('Dashboard'), '/dashboard');
  });

  it('/ia por URL termina en el Cotizador (el asistente es solo interno)', async () => {
    renderApp({ user: CLIENTE, ruta: '/ia' });
    await encabezado('Cotización')();
    expect(screen.queryByRole('heading', { level: 2, name: 'Asistente IA' })).not.toBeInTheDocument();
  });
});

describe('Sin sesión y cierre de sesión', () => {
  it.each(['/dashboard', '/cotizador', '/historial', '/ia', '/crm', '/admin/usuarios', '/admin/ordenes', '/no-existe'])(
    '%s lleva al login', async (ruta) => {
      renderApp({ user: null, ruta });
      expect(await screen.findByRole('heading', { name: 'Ingresar' })).toBeInTheDocument();
      expect(rutaActual()).toBe('/login');
    });

  it('cerrar sesión lleva al login', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await encabezado('Dashboard')();
    fireEvent.click((await screen.findAllByRole('menuitem', { name: 'Cerrar sesión' }))[0]);
    expect(await screen.findByRole('heading', { name: 'Ingresar' })).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Dashboard' })).not.toBeInTheDocument();
  });
});
