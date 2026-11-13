// Líneas de quote de fabricante (ISS, Neural Labs, Milestone) dentro del Cotizador real:
// margen base de 8 %, precio = costo Chile / (1 - margen) y lo que viaja al guardar.
// El modal de carga se simula (es de otro archivo): solo importa que entrega productos armados
// con el `productoDeQuote` real y que la página los trate bien.
import React from 'react';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('../ordenes/arnesOrdenes.testutil.jsx')).crearApiMock());

// Doble mínimo del modal: cuando está abierto muestra un botón por cada escenario; cada uno llama
// onAgregar con productos reales y luego onCerrar, igual que el modal verdadero.
vi.mock('./CargarQuoteModal', async () => {
  const { productoDeQuote } = await import('./quoteFabricante');
  const escenarios = {
    'Agregar ISS 100 x3': [[{ mpn: 'ISS-LIC-1', descripcion: 'Licencia ISS', costoUnitario: 100, cantidad: 3 }, { fabricante: 'ISS', indice: 1 }]],
    'Agregar Neural 100': [[{ mpn: 'NL-1', descripcion: 'Licencia Neural', costoUnitario: 100, cantidad: 1 }, { fabricante: 'NEURAL', indice: 2 }]],
    'Agregar Milestone servidor 100': [[{ mpn: 'MS-SRV', descripcion: 'Servidor Milestone', costoUnitario: 100, cantidad: 1 }, { fabricante: 'MILESTONE', tipo: 'servidor', indice: 3 }]],
    'Agregar Milestone licencia 100': [[{ mpn: 'MS-LIC', descripcion: 'Licencia Milestone', costoUnitario: 100, cantidad: 1 }, { fabricante: 'MILESTONE', tipo: 'licencia', indice: 4 }]],
    'Agregar Velasea 100 x2': [[{ mpn: 'VS-4U', descripcion: 'Servidor Velasea 4U', costoUnitario: 100, cantidad: 2 }, { fabricante: 'VELASEA', indice: 7 }]],
    'Agregar dos ISS mismo MPN': [
      [{ mpn: 'REPETIDO', descripcion: 'Primera', costoUnitario: 100, cantidad: 1 }, { fabricante: 'ISS', indice: 5 }],
      [{ mpn: 'REPETIDO', descripcion: 'Segunda', costoUnitario: 100, cantidad: 2 }, { fabricante: 'ISS', indice: 6 }]
    ]
  };
  return {
    default: ({ abierto, onCerrar, onAgregar }) =>
      abierto ? (
        <div role="dialog" aria-label="Cargar quote simulado">
          {Object.entries(escenarios).map(([nombre, lineas]) => (
            <button
              key={nombre}
              type="button"
              onClick={() => {
                onAgregar(lineas.map(([linea, opciones]) => productoDeQuote(linea, opciones)));
                onCerrar();
              }}
            >
              {nombre}
            </button>
          ))}
        </div>
      ) : null
  };
});

import { api, precalentar, prepararApi, renderApp, irAVista, ADMIN } from '../ordenes/arnesOrdenes.testutil.jsx';

// Con la máquina cargada estos recorridos no caben en los 5 s por defecto.
vi.setConfig({ testTimeout: 30000 });

const CLIENTE = { id: 2, usuario: 'cliente', nombre: 'Cliente', role: 'client', empresa: 'Otra' };

const esperarCotizador = async () => {
  await waitFor(() => expect(screen.queryAllByRole('heading', { level: 2, name: 'Cotización' }).length).toBeGreaterThan(0));
};

const cargar = async (nombre) => {
  fireEvent.click(await screen.findByRole('button', { name: /Cargar quote/ }));
  fireEvent.click(await screen.findByRole('button', { name: nombre }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cargar quote simulado' })).not.toBeInTheDocument());
};

// La tabla de escritorio (el carrito renderiza también las tarjetas móviles).
const filasDelCarrito = () => within(screen.getAllByRole('table')[0]).getAllByRole('row').slice(1);

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  prepararApi();
});

describe('Quote en el carrito', () => {
  it('el botón "Cargar quote" lo ve el admin y no un usuario cliente', async () => {
    const admin = renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    const boton = await screen.findByRole('button', { name: /Cargar quote/ });
    expect(boton).toHaveAttribute('title', 'Cargar el quote de ISS, Neural Labs, Milestone o Velasea');
    admin.unmount();

    renderApp({ user: CLIENTE, ruta: '/cotizador' });
    await esperarCotizador();
    await screen.findByRole('button', { name: 'Pegar lista' });
    expect(screen.queryByRole('button', { name: /Cargar quote/ })).not.toBeInTheDocument();
  });

  it('una línea ISS de costo 100 y cantidad 3 cuesta 125,00 por unidad (8 %), no 135,29 (15 %)', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    await cargar('Agregar ISS 100 x3');

    const filas = filasDelCarrito();
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(within(fila).getByLabelText('Cantidad')).toHaveValue('3');
    // 100 x 1,15 = 115 de costo Chile; 115 / 0,92 = 125,00
    expect(within(fila).getByLabelText('Precio unitario')).toHaveValue('125.00');
    expect(within(fila).getByText('$375.00')).toBeInTheDocument();
    expect(within(fila).queryByText('$405.88')).not.toBeInTheDocument();
    // El margen base (8 %) se ve como placeholder y la línea dice de dónde sale su costo.
    expect(within(fila).getByLabelText('GP %')).toHaveAttribute('placeholder', '8.0');
    expect(within(fila).getByText('Quote ISS')).toBeInTheDocument();
    expect(within(fila).getByText(/Costo fabricante \$100\.00 \+ 15 %/)).toBeInTheDocument();
    expect(within(fila).queryByText(/Real stock/)).not.toBeInTheDocument();
  });

  it('Neural, Milestone servidor y Milestone licencia usan cada uno su recargo', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    await cargar('Agregar Neural 100');
    await cargar('Agregar Milestone servidor 100');
    await cargar('Agregar Milestone licencia 100');

    const [neural, servidor, licencia] = filasDelCarrito();
    expect(within(neural).getByLabelText('Precio unitario')).toHaveValue('125.00'); // 115 / 0,92
    expect(within(servidor).getByLabelText('Precio unitario')).toHaveValue('121.74'); // 112 / 0,92
    expect(within(licencia).getByLabelText('Precio unitario')).toHaveValue('108.70'); // 100 / 0,92
    expect(within(servidor).getByText('Quote Milestone · servidor')).toBeInTheDocument();
    expect(within(licencia).getByText('Quote Milestone · licencia')).toBeInTheDocument();
  });

  it('cambiar el margen de la línea a 10 % la deja en 127,78', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    await cargar('Agregar ISS 100 x3');

    const fila = filasDelCarrito()[0];
    const gp = within(fila).getByLabelText('GP %');
    fireEvent.change(gp, { target: { value: '10' } });
    fireEvent.blur(gp);
    await waitFor(() => expect(within(filasDelCarrito()[0]).getByLabelText('Precio unitario')).toHaveValue('127.78'));
  });

  it('dos líneas con el mismo MPN quedan como dos líneas', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    await cargar('Agregar dos ISS mismo MPN');

    const filas = filasDelCarrito();
    expect(filas).toHaveLength(2);
    expect(within(filas[0]).getByLabelText('Cantidad')).toHaveValue('1');
    expect(within(filas[1]).getByLabelText('Cantidad')).toHaveValue('2');
    // Cargar otra vez lo mismo no fusiona con las que ya estaban.
    await cargar('Agregar dos ISS mismo MPN');
    expect(filasDelCarrito()).toHaveLength(4);
  });

  it('al guardar, la línea viaja con su origen, el costo del fabricante y el margen de 8 %', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    await cargar('Agregar ISS 100 x3');

    fireEvent.click(await screen.findByRole('button', { name: 'Generar cotización' }));
    // El SKU "To Create" abre la revisión previa.
    fireEvent.click(await screen.findByRole('button', { name: 'Generar igual' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cotización' }));

    await waitFor(() => expect(api.cotizacionesAPI.create).toHaveBeenCalledTimes(1));
    const { items } = api.cotizacionesAPI.create.mock.calls[0][0];
    expect(items).toHaveLength(1);
    const linea = items[0];
    expect(linea).toMatchObject({
      origen: 'ISS',
      marca: 'ISS',
      sku: 'To Create',
      mpn: 'ISS-LIC-1',
      precio_disty: 100,
      gp: 0.08,
      cantidad: 3,
      rebate_partner: null,
      rebate_proyecto: null,
      partner_category: null
    });
    expect(linea.precio_unitario).toBeCloseTo(125, 6);
    expect(linea.costo_unitario).toBeCloseTo(115, 6);
    expect(linea.precio_total).toBeCloseTo(375, 6);
    expect(Number.isFinite(Number(linea.producto_id))).toBe(false);
  });

  it('Velasea: costo como QNAP sin IC y margen global de QNAP (15 %), también al guardar', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    await cargar('Agregar Velasea 100 x2');
    await cargar('Agregar ISS 100 x3');

    const [velasea, iss] = filasDelCarrito();
    expect(within(velasea).getByLabelText('Cantidad')).toHaveValue('2');
    // 100 x 1,011 x 1,12 = 113,23 de costo Chile; 113,23 / 0,85 = 133,21 (no 123,08, que sería al 8 %)
    expect(within(velasea).getByLabelText('Precio unitario')).toHaveValue('133.21');
    expect(within(velasea).getByLabelText('GP %')).toHaveAttribute('placeholder', '15.0');
    expect(within(velasea).getByText('global')).toBeInTheDocument();
    expect(within(velasea).getByText('Quote Velasea')).toBeInTheDocument();
    expect(within(velasea).getByText(/Costo fabricante \$100\.00 \+ flete 1,1 % \+ 12 %/)).toBeInTheDocument();
    // La línea ISS del mismo carrito sigue con su 8 %.
    expect(within(iss).getByLabelText('Precio unitario')).toHaveValue('125.00');
    expect(within(iss).getByText('base quote')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Generar cotización' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generar igual' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cotización' }));
    await waitFor(() => expect(api.cotizacionesAPI.create).toHaveBeenCalledTimes(1));
    const { items } = api.cotizacionesAPI.create.mock.calls[0][0];
    expect(items[0]).toMatchObject({ origen: 'VELASEA', marca: 'Velasea', sku: 'To Create', precio_disty: 100, gp: 0.15, cantidad: 2, rebate_partner: null, partner_category: null });
    expect(items[0].costo_unitario).toBeCloseTo(113.23, 6);
    expect(items[0].precio_unitario).toBeCloseTo(113.23 / 0.85, 6);
    expect(items[1]).toMatchObject({ origen: 'ISS', gp: 0.08 });
  });

  it('el modal se cierra al cambiar de vista', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();
    fireEvent.click(await screen.findByRole('button', { name: /Cargar quote/ }));
    expect(await screen.findByRole('dialog', { name: 'Cargar quote simulado' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '1', altKey: true });
    await waitFor(() => expect(screen.queryAllByRole('heading', { level: 2, name: 'Dashboard' }).length).toBeGreaterThan(0));
    expect(screen.queryByRole('dialog', { name: 'Cargar quote simulado' })).not.toBeInTheDocument();
    await irAVista('Cotizador');
    await esperarCotizador();
    expect(screen.queryByRole('dialog', { name: 'Cargar quote simulado' })).not.toBeInTheDocument();
  });
});
