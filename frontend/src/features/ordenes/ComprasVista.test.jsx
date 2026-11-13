// Tests de CARACTERIZACIÓN de la vista Compras (usuario admin).
// Se llega desde el menú: Operaciones › Vista compras (no tiene ruta propia).
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('./arnesOrdenes.testutil.jsx')).crearApiMock());

import {
  precalentar,
  api, prepararApi, renderApp,
  abrirDetalle, inputsDeLinea, escribir, irAVista, botonBo
} from './arnesOrdenes.testutil.jsx';

const abrirCompras = async () => {
  await screen.findByRole('button', { name: 'BO BO-1001' });
  await irAVista('Vista compras');
  await screen.findByText('Estado de compra, despacho y vía de cada BO del OSO.');
};

const guardarCambios = (i) => screen.getAllByRole('button', { name: 'Guardar cambios' })[i];

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  prepararApi();
});

describe('Vista compras (admin)', () => {
  it('lista las órdenes y pide órdenes y meta al entrar', async () => {
    renderApp();
    await abrirCompras();
    ['BO-1001', 'BO-1002', 'BO-1003'].forEach(bo => expect(botonBo(bo)).toBeInTheDocument());
    expect(screen.getByText(/Total: 3 · Activas: 1 · Parciales: 1 · Completas: 1$/)).toBeInTheDocument();
    // Cada entrada a la vista vuelve a pedir los datos (una al cargar Órdenes y otra al pasar a Compras).
    expect(api.osoAPI.getOrders).toHaveBeenCalledTimes(2);
    expect(api.boMetaAPI.getAll).toHaveBeenCalledTimes(2);
  });

  it('no tiene Guardar de montos ni S&D; cada BO nuevo está "Pendiente compra"', async () => {
    renderApp();
    await abrirCompras();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /S&D/ })).not.toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Pendiente compra')).toHaveLength(3);
    expect(screen.getAllByText('Pendiente compra').length).toBeGreaterThanOrEqual(3);
    screen.getAllByRole('button', { name: 'Guardar cambios' }).forEach(b => expect(b).toBeDisabled());
  });

  it('al expandir un BO los inputs de monto están deshabilitados', async () => {
    renderApp();
    await abrirCompras();
    abrirDetalle(0);
    await screen.findAllByText('MPN-A1');
    const a1 = inputsDeLinea('MPN-A1');
    const a2 = inputsDeLinea('MPN-A2');
    [a1.axis, a1.intcomex, a2.axis, a2.intcomex].forEach(i => expect(i).toBeDisabled());
    expect(a1.axis).toHaveValue(100);
    expect(a2.intcomex).toHaveValue(55);
  });

  it('editar SO habilita "Guardar cambios" y guarda el payload de compra con boMetaAPI.save', async () => {
    renderApp();
    await abrirCompras();
    escribir(screen.getAllByPlaceholderText('SO')[0], 'SO-55');
    expect(guardarCambios(0)).toBeEnabled();
    expect(guardarCambios(1)).toBeDisabled();
    fireEvent.click(guardarCambios(0));
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledTimes(1));
    // Estado, despacho y vía vacíos van como null; el PO Axis existente se reenvía.
    expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-1001', {
      purchaseStatus: null,
      purchaseDispatch: null,
      purchaseShipping: null,
      purchaseSo: 'SO-55',
      poAxis: 'PO-77'
    });
    expect(api.boLineMetaAPI.save).not.toHaveBeenCalled();
    await waitFor(() => expect(guardarCambios(0)).toBeDisabled());
    expect(screen.getAllByPlaceholderText('SO')[0]).toHaveValue('SO-55');
  });

  it('marcar Comprado muestra Despacho y Vía y se guardan con el estado', async () => {
    renderApp();
    await abrirCompras();
    expect(screen.queryByText('Despacho')).not.toBeInTheDocument();
    escribir(screen.getAllByDisplayValue('Pendiente compra')[0], 'comprado');
    expect(await screen.findByText('Despacho')).toBeInTheDocument();
    expect(screen.getByText('Vía')).toBeInTheDocument();
    // Despacho y Vía son los dos selects "Seleccionar": se distinguen por sus opciones.
    const [despacho, via] = screen.getAllByDisplayValue('Seleccionar');
    expect(within(despacho).getByRole('option', { name: 'XUS' })).toBeInTheDocument();
    expect(within(via).getByRole('option', { name: 'Aérea' })).toBeInTheDocument();
    escribir(despacho, 'xus');
    escribir(via, 'aerea');
    fireEvent.click(guardarCambios(0));
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-1001', {
      purchaseStatus: 'comprado',
      purchaseDispatch: 'xus',
      purchaseShipping: 'aerea',
      purchaseSo: null,
      poAxis: 'PO-77'
    });
  });

  it('editar el PO guarda poAxis en el payload de compra', async () => {
    renderApp();
    await abrirCompras();
    escribir(screen.getAllByPlaceholderText('PO Axis')[1], 'PO-BETA');
    fireEvent.click(guardarCambios(1));
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-1002', {
      purchaseStatus: null,
      purchaseDispatch: null,
      purchaseShipping: null,
      purchaseSo: null,
      poAxis: 'PO-BETA'
    });
  });

  it('un Despacho Embarcador (ya comprado) avisa de las fechas OOR de las líneas', async () => {
    prepararApi({
      meta: [{ bo: 'BO-1001', purchase_status: 'comprado', purchase_dispatch: 'embarcador', purchase_shipping: 'maritima' }],
      orders: [{
        bo: 'BO-1001', customerName: 'Acme SA', allocPct: 10,
        lines: [{ lineIndex: 0, sku: 'S1', mpn: 'M1', desc: 'Cosa', orderQty: 1, shippedQty: 0, allocQty: 0, tiempoEntrega: '2026-12-24' }]
      }]
    });
    renderApp();
    await abrirCompras();
    expect(screen.getByText('Despacho Embarcador')).toBeInTheDocument();
    expect(screen.getByText('OOR 2026-12-24')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente compra', { selector: 'div' })).not.toBeInTheDocument();
  });

  it('la búsqueda y el filtro de estado reducen la lista', async () => {
    renderApp();
    await abrirCompras();
    escribir(screen.getByRole('textbox', { name: 'Buscar' }), 'beta');
    await waitFor(() => expect(botonBo('BO-1001')).not.toBeInTheDocument());
    expect(botonBo('BO-1002')).toBeInTheDocument();
    escribir(screen.getByRole('textbox', { name: 'Buscar' }), '');
    await waitFor(() => expect(botonBo('BO-1001')).toBeInTheDocument());
    escribir(screen.getByDisplayValue('Todos'), 'parcial');
    await waitFor(() => expect(botonBo('BO-1001')).not.toBeInTheDocument());
    expect(botonBo('BO-1003')).toBeInTheDocument();
  });

  it('si la carga falla muestra el error', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'BO BO-1001' });
    api.osoAPI.getOrders.mockRejectedValue(new Error('Error obteniendo ordenes OSO'));
    await irAVista('Vista compras');
    expect(await screen.findByText('Error obteniendo ordenes OSO')).toBeInTheDocument();
  });
});
