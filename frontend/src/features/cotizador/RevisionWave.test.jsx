// Modo «Revisión de wave» dentro del Cotizador real: muestra Costo XUS y Costo XUS + IC para
// corroborar precios contra la lista del distribuidor, y NO cambia ningún precio ni lo que se guarda.
// También cubre el panel «Parámetros de cálculo» (solo lectura) de Listas de precio.
import React from 'react';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('../ordenes/arnesOrdenes.testutil.jsx')).crearApiMock());

import { api, precalentar, prepararApi, renderApp, irAVista, ADMIN } from '../ordenes/arnesOrdenes.testutil.jsx';

// Con la máquina cargada estos recorridos no caben en los 5 s por defecto.
vi.setConfig({ testTimeout: 30000 });

const CLIENTE = { id: 2, usuario: 'cliente', nombre: 'Cliente', role: 'client', empresa: 'Otra' };

const PRODUCTOS = [
  { id: 11, origen: 'QNAP', marca: 'QNAP', sku: 'NW-TS464', mpn: 'TS-464', descripcion: 'NAS de 4 bahias', precio_disty: 1000, gp: 0.15, tiempo_entrega: '6 semanas' },
  { id: 12, origen: 'AXIS', marca: 'AXIS', sku: '02345-001', mpn: 'P3265-LVE', descripcion: 'Camara domo fija', precio_disty: 1000, gp: 0.15, tiempo_entrega: '4 semanas', rebate_partner_autorizado: 0 }
];

const esperarCotizador = async () => {
  await waitFor(() => expect(screen.queryAllByRole('heading', { level: 2, name: 'Cotización' }).length).toBeGreaterThan(0));
};

// La franja de aviso (role=status); el Toaster también usa ese rol, por eso se busca por su texto.
const franja = () => screen.queryByText(/Revisión de wave activa/)?.closest('[role="status"]') ?? null;

const interruptor = () => screen.queryByRole('switch', { name: 'Revisión de wave' });

// Resultados del buscador (los <option> del selector de partner también tienen ese rol).
const resultado = (mpn) => waitFor(() => within(screen.getByRole('listbox')).getByRole('option', { name: new RegExp(mpn) }));
const sinResultados = () => expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

// Busca el producto y lo agrega haciendo clic en su resultado.
const agregar = async (texto, mpn) => {
  const buscador = await screen.findByPlaceholderText(/Buscar por SKU/);
  fireEvent.change(buscador, { target: { value: texto } });
  fireEvent.click(await resultado(mpn));
  await waitFor(sinResultados);
};

const filasDelCarrito = () => within(screen.getAllByRole('table')[0]).getAllByRole('row').slice(1);

// Total que muestra la barra fija del carrito.
const totalMostrado = () => {
  const etiqueta = screen.getAllByText('Total').find((el) => /^\$/.test(el.nextSibling?.textContent || ''));
  return etiqueta.nextSibling.textContent;
};

const preciosUnitarios = () => filasDelCarrito().map((f) => within(f).getByLabelText('Precio unitario').value);

const guardar = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Generar cotización' }));
  const igual = screen.queryByRole('button', { name: 'Generar igual' });
  if (igual) fireEvent.click(igual);
  fireEvent.click(await screen.findByRole('button', { name: 'Guardar cotización' }));
  await waitFor(() => expect(api.cotizacionesAPI.create).toHaveBeenCalledTimes(1));
  return api.cotizacionesAPI.create.mock.calls[0][0];
};

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  prepararApi();
  api.productosAPI.getAll.mockResolvedValue(PRODUCTOS);
});

describe('Revisión de wave', () => {
  it('el interruptor lo ve el admin y no un usuario cliente; arranca apagado', async () => {
    const admin = renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    const sw = await screen.findByRole('switch', { name: 'Revisión de wave' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(franja()).not.toBeInTheDocument();
    admin.unmount();

    renderApp({ user: CLIENTE, ruta: '/cotizador' });
    await esperarCotizador();
    await screen.findByRole('button', { name: 'Pegar lista' });
    expect(interruptor()).not.toBeInTheDocument();
  });

  it('apagado, ni el catálogo ni el carrito muestran Costo XUS', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    fireEvent.change(await screen.findByPlaceholderText(/Buscar por SKU/), { target: { value: 'TS-464' } });
    const opcion = await resultado('TS-464');
    expect(screen.queryByText(/XUS/)).not.toBeInTheDocument();
    fireEvent.click(opcion);
    await waitFor(() => expect(filasDelCarrito()).toHaveLength(1));
    expect(screen.queryByText(/XUS/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copiar revisión' })).not.toBeInTheDocument();
  });

  it('al activarlo aparece la franja y el catálogo y el carrito muestran los dos costos', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    fireEvent.click(await screen.findByRole('switch', { name: 'Revisión de wave' }));
    expect(screen.getByRole('switch', { name: 'Revisión de wave' })).toHaveAttribute('aria-checked', 'true');
    expect(franja()).toHaveTextContent(
      'Revisión de wave activa: se muestran Costo XUS (disty × flete) y Costo XUS + IC (÷ IC). No cambia los precios.'
    );

    // En el buscador del catálogo.
    fireEvent.change(screen.getByPlaceholderText(/Buscar por SKU/), { target: { value: 'TS-464' } });
    const opcion = await resultado('TS-464');
    expect(opcion).toHaveTextContent('Disty $1,000.00 · XUS $1,011.00 · XUS + IC $1,064.21');
    fireEvent.click(opcion);
    await waitFor(sinResultados);

    await agregar('P3265', 'P3265');
    const [qnap, axis] = filasDelCarrito();
    expect(within(qnap).getByText('$1,011.00')).toBeInTheDocument();
    expect(within(qnap).getByText('$1,064.21')).toBeInTheDocument();
    expect(within(axis).getByText('$1,015.00')).toBeInTheDocument();
    expect(within(axis).getByText('$1,046.39')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Costo XUS' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Costo XUS + IC' })).toBeInTheDocument();
  });

  it('activar y desactivar el modo no cambia el precio unitario ni el total', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    await agregar('TS-464', 'TS-464');
    await agregar('P3265', 'P3265');

    const unitariosAntes = preciosUnitarios();
    const totalAntes = totalMostrado();
    expect(unitariosAntes).toHaveLength(2);

    const sw = screen.getByRole('switch', { name: 'Revisión de wave' });
    fireEvent.click(sw);
    expect(franja()).toBeInTheDocument();
    expect(preciosUnitarios()).toEqual(unitariosAntes);
    expect(totalMostrado()).toBe(totalAntes);

    fireEvent.click(sw);
    expect(franja()).not.toBeInTheDocument();
    expect(preciosUnitarios()).toEqual(unitariosAntes);
    expect(totalMostrado()).toBe(totalAntes);
  });

  it('el modo se recuerda al volver a montar', async () => {
    const primera = renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    fireEvent.click(await screen.findByRole('switch', { name: 'Revisión de wave' }));
    expect(localStorage.getItem('cotizadorRevisionWave')).toBe('1');
    primera.unmount();

    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    expect(await screen.findByRole('switch', { name: 'Revisión de wave' })).toHaveAttribute('aria-checked', 'true');
    expect(franja()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Revisión de wave' }));
    expect(localStorage.getItem('cotizadorRevisionWave')).toBe('0');
  });

  it('«Copiar revisión» escribe la tabla en el portapapeles', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    fireEvent.click(await screen.findByRole('switch', { name: 'Revisión de wave' }));
    // Sin líneas no hay nada que copiar.
    expect(screen.queryByRole('button', { name: 'Copiar revisión' })).not.toBeInTheDocument();
    await agregar('TS-464', 'TS-464');
    await agregar('P3265', 'P3265');

    fireEvent.click(screen.getByRole('button', { name: 'Copiar revisión' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const esperado = [
      ['Marca', 'SKU', 'MPN', 'Descripción', 'Cantidad', 'Precio disty', 'Costo XUS', 'Costo XUS + IC'],
      ['QNAP', 'NW-TS464', 'TS-464', 'NAS de 4 bahias', '1', '1000.00', '1011.00', '1064.21'],
      ['AXIS', '02345-001', 'P3265-LVE', 'Camara domo fija', '1', '1000.00', '1015.00', '1046.39']
    ].map((f) => f.join('\t')).join('\n');
    expect(writeText).toHaveBeenCalledWith(esperado);
    expect(await screen.findByText('Revisión copiada: pégala en Excel')).toBeInTheDocument();
  });

  it('si el portapapeles falla, avisa con un error', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denegado'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    fireEvent.click(await screen.findByRole('switch', { name: 'Revisión de wave' }));
    await agregar('TS-464', 'TS-464');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar revisión' }));
    expect(await screen.findByText('No se pudo copiar la revisión al portapapeles.')).toBeInTheDocument();
  });

  it('al guardar con el modo activo se envía exactamente lo mismo que con el modo apagado', async () => {
    const recorrido = async (conWave) => {
      localStorage.clear();
      prepararApi();
      api.productosAPI.getAll.mockResolvedValue(PRODUCTOS);
      const vista = renderApp({ user: ADMIN, ruta: '/cotizador' });
      await esperarCotizador();
      if (conWave) fireEvent.click(await screen.findByRole('switch', { name: 'Revisión de wave' }));
      await agregar('TS-464', 'TS-464');
      await agregar('P3265', 'P3265');
      const payload = await guardar();
      vista.unmount();
      return payload;
    };

    const apagado = await recorrido(false);
    const activo = await recorrido(true);
    expect(activo).toEqual(apagado);

    // El total enviado es la suma de los totales de línea (unitario a centavos x cantidad).
    expect(apagado.items).toHaveLength(2);
    const suma = apagado.items.reduce((t, l) => t + Math.round(l.precio_total * 100), 0) / 100;
    expect(apagado.total).toBe(suma);
    apagado.items.forEach((l) => {
      expect(l.precio_total).toBe(Math.round(Math.round(l.precio_unitario * 100) * l.cantidad) / 100);
    });
  });
});

describe('Parámetros de cálculo (solo lectura)', () => {
  it('muestra los valores de QNAP y, al cambiar la lista a AXIS, los de AXIS, sin campos editables', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    await irAVista('Listas de precio');
    const titulo = await screen.findByRole('heading', { name: /Parámetros de cálculo/ });
    const panel = titulo.parentElement;

    const valor = (nombre) => within(panel).getByText(nombre).nextElementSibling.textContent;
    expect(valor('Inbound Freight')).toBe('1,011');
    expect(valor('IC')).toBe('0,95');
    expect(valor('INT')).toBe('12 %');
    expect(within(panel).queryAllByRole('spinbutton')).toHaveLength(0);
    expect(within(panel).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(panel).getByText('Costo XUS = disty × flete · Costo XUS + IC = ÷ IC · Costo Chile = × (1 + INT)')).toBeInTheDocument();
    expect(within(panel).getByText(/Se cambian en el código, para todos a la vez\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'AXIS' }));
    await waitFor(() => expect(valor('Inbound Freight')).toBe('1,015'));
    expect(valor('IC')).toBe('0,97');
    expect(valor('INT')).toBe('12 %');
    expect(within(panel).queryAllByRole('spinbutton')).toHaveLength(0);
  });
});
