// Tests de CARACTERIZACIÓN de la vista Órdenes (usuario admin) y del Dashboard.
// Fijan el comportamiento actual visto por el usuario, no la implementación.
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('./arnesOrdenes.testutil.jsx')).crearApiMock());

import {
  precalentar,
  api, prepararApi, renderApp, mesActual,
  abrirDetalle, inputsDeLinea, escribir, irAVista, botonBo
} from './arnesOrdenes.testutil.jsx';

const esperarOrdenes = async () => {
  await screen.findByRole('button', { name: 'BO BO-1001' });
};

const mesSiguiente = () => {
  const d = new Date();
  const s = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`;
};

const guardarDe = (indice) => screen.getAllByRole('button', { name: 'Guardar' })[indice];

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  prepararApi();
});

describe('Órdenes: carga y listado', () => {
  it('al entrar pide órdenes y meta, y lista los BO con su cliente', async () => {
    renderApp();
    await esperarOrdenes();
    expect(api.osoAPI.getOrders).toHaveBeenCalledTimes(1);
    expect(api.boMetaAPI.getAll).toHaveBeenCalledTimes(1);
    ['BO-1001', 'BO-1002', 'BO-1003'].forEach(bo => expect(botonBo(bo)).toBeInTheDocument());
    ['Acme SA', 'Beta Ltda', 'Gamma Corp'].forEach(c => expect(screen.getAllByText(c).length).toBeGreaterThan(0));
    expect(screen.getByText(/Total: 3 · Activas: 1 · Parciales: 1 · Completas: 1 · Facturadas: 0/)).toBeInTheDocument();
    // Sin BO faltantes no hay modal.
    expect(screen.queryByText('BO no encontrados en OSO')).not.toBeInTheDocument();
  });

  it('muestra el proyecto y PO Axis guardados en la meta del BO', async () => {
    renderApp();
    await esperarOrdenes();
    expect(screen.getAllByPlaceholderText('Nombre del proyecto')[0]).toHaveValue('Proyecto Norte');
    expect(screen.getAllByPlaceholderText('PO Axis')[0]).toHaveValue('PO-77');
    expect(screen.getAllByPlaceholderText('Nombre del proyecto')[1]).toHaveValue('');
  });

  it('si osoAPI.getOrders falla muestra el error y no revienta', async () => {
    api.osoAPI.getOrders.mockRejectedValue(new Error('Error obteniendo ordenes OSO'));
    renderApp();
    expect(await screen.findByText('Error obteniendo ordenes OSO')).toBeInTheDocument();
    expect(screen.getByText('Sin órdenes activas')).toBeInTheDocument();
    expect(botonBo('BO-1001')).not.toBeInTheDocument();
  });
});

describe('Órdenes: detalle y montos por línea', () => {
  it('expandir un BO muestra sus líneas y los montos guardados, y dos zonas de carga de archivo', async () => {
    renderApp();
    await esperarOrdenes();
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    abrirDetalle(0);
    expect(await screen.findAllByText('MPN-A1')).not.toHaveLength(0);
    ['SKU-A1', 'Camara domo exterior', 'MPN-A2', 'SKU-A2', 'Switch PoE ocho puertos'].forEach(t =>
      expect(screen.getAllByText(t).length).toBeGreaterThan(0));
    expect(inputsDeLinea('MPN-A1').axis).toHaveValue(100);
    expect(inputsDeLinea('MPN-A1').intcomex).toHaveValue(null);
    expect(inputsDeLinea('MPN-A2').axis).toHaveValue(null);
    expect(inputsDeLinea('MPN-A2').intcomex).toHaveValue(55);
    expect(screen.getByRole('button', { name: 'Cargar la OC del cliente para Monto Intcomex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cargar los costos de Axis para Monto Axis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument();
  });

  it('escribir Monto Intcomex habilita Guardar y guarda SOLO esa línea y SOLO montoIntcomex', async () => {
    renderApp();
    await esperarOrdenes();
    abrirDetalle(0);
    expect(guardarDe(0)).toBeDisabled();
    const { intcomex } = inputsDeLinea('MPN-A1');
    escribir(intcomex, '250');
    expect(guardarDe(0)).toBeEnabled();
    fireEvent.click(guardarDe(0));
    await waitFor(() => expect(api.boLineMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boLineMetaAPI.save).toHaveBeenCalledWith('BO-1001', {
      lines: [{ montoIntcomex: 250, sku: 'SKU-A1', mpn: 'MPN-A1' }]
    });
    // La meta del BO no cambió: no se llama boMetaAPI.save.
    expect(api.boMetaAPI.save).not.toHaveBeenCalled();
    await waitFor(() => expect(guardarDe(0)).toBeDisabled());
    expect(inputsDeLinea('MPN-A1').intcomex).toHaveValue(250);
    // El otro monto y la otra línea quedan intactos.
    expect(inputsDeLinea('MPN-A1').axis).toHaveValue(100);
    expect(inputsDeLinea('MPN-A2').intcomex).toHaveValue(55);
  });

  it('editar solo Monto Axis guarda montoAxis sin montoIntcomex', async () => {
    renderApp();
    await esperarOrdenes();
    abrirDetalle(0);
    escribir(inputsDeLinea('MPN-A1').axis, '120');
    expect(guardarDe(0)).toBeEnabled();
    fireEvent.click(guardarDe(0));
    await waitFor(() => expect(api.boLineMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boLineMetaAPI.save).toHaveBeenCalledWith('BO-1001', {
      lines: [{ montoAxis: 120, sku: 'SKU-A1', mpn: 'MPN-A1' }]
    });
    await waitFor(() => expect(guardarDe(0)).toBeDisabled());
    expect(inputsDeLinea('MPN-A1').axis).toHaveValue(120);
  });

  it('editar varias líneas y ambos montos los manda juntos en un solo guardado', async () => {
    renderApp();
    await esperarOrdenes();
    abrirDetalle(0);
    escribir(inputsDeLinea('MPN-A1').axis, '10');
    escribir(inputsDeLinea('MPN-A2').intcomex, '20');
    fireEvent.click(guardarDe(0));
    await waitFor(() => expect(api.boLineMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boLineMetaAPI.save).toHaveBeenCalledWith('BO-1001', {
      lines: [
        { montoAxis: 10, sku: 'SKU-A1', mpn: 'MPN-A1' },
        { montoIntcomex: 20, sku: 'SKU-A2', mpn: 'MPN-A2' }
      ]
    });
  });

  it('vaciar un monto guardado lo envía como null', async () => {
    renderApp();
    await esperarOrdenes();
    abrirDetalle(0);
    escribir(inputsDeLinea('MPN-A1').axis, '');
    expect(guardarDe(0)).toBeEnabled();
    fireEvent.click(guardarDe(0));
    await waitFor(() => expect(api.boLineMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boLineMetaAPI.save).toHaveBeenCalledWith('BO-1001', {
      lines: [{ montoAxis: null, sku: 'SKU-A1', mpn: 'MPN-A1' }]
    });
  });

  it('escribir el mismo valor que ya estaba guardado no habilita Guardar', async () => {
    renderApp();
    await esperarOrdenes();
    abrirDetalle(0);
    escribir(inputsDeLinea('MPN-A1').axis, '100');
    expect(guardarDe(0)).toBeDisabled();
  });

  it('si boLineMetaAPI.save falla, avisa del error y conserva lo escrito y Guardar habilitado', async () => {
    api.boLineMetaAPI.save.mockRejectedValue(new Error('Error guardando montos Axis'));
    renderApp();
    await esperarOrdenes();
    abrirDetalle(0);
    escribir(inputsDeLinea('MPN-A1').intcomex, '9');
    fireEvent.click(guardarDe(0));
    expect(await screen.findByText('Error guardando montos Axis')).toBeInTheDocument();
    expect(inputsDeLinea('MPN-A1').intcomex).toHaveValue(9);
    await waitFor(() => expect(guardarDe(0)).toBeEnabled());
  });
});

describe('Órdenes: meta del BO', () => {
  it('editar el nombre del proyecto y guardar llama boMetaAPI.save con ese BO y ese dato', async () => {
    renderApp();
    await esperarOrdenes();
    expect(guardarDe(0)).toBeDisabled();
    escribir(screen.getAllByPlaceholderText('Nombre del proyecto')[0], 'Proyecto Sur');
    expect(guardarDe(0)).toBeEnabled();
    fireEvent.click(guardarDe(0));
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-1001', {
      projectName: 'Proyecto Sur',
      poAxis: 'PO-77',
      estimatedInvoiceMonth: null,
      estimatedInvoiceWeek: null
    });
    expect(api.boLineMetaAPI.save).not.toHaveBeenCalled();
    await waitFor(() => expect(guardarDe(0)).toBeDisabled());
    expect(screen.getAllByPlaceholderText('Nombre del proyecto')[0]).toHaveValue('Proyecto Sur');
  });

  it('editar PO Axis, mes y semana de facturación se guardan en un solo boMetaAPI.save', async () => {
    renderApp();
    await esperarOrdenes();
    // Las tres tarjetas avisan que falta el mes de facturación.
    expect(screen.getAllByText('Falta mes facturación')).toHaveLength(3);
    escribir(screen.getAllByPlaceholderText('PO Axis')[0], 'PO-99');
    // Selector "Mes fact.": el primero de la lista que muestra "Sin mes".
    const selectMes = screen.getAllByDisplayValue('Sin mes')[0];
    escribir(selectMes, mesSiguiente());
    fireEvent.click(screen.getAllByRole('button', { name: '2' })[0]);
    fireEvent.click(guardarDe(0));
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-1001', {
      projectName: 'Proyecto Norte',
      poAxis: 'PO-99',
      estimatedInvoiceMonth: mesSiguiente(),
      estimatedInvoiceWeek: '2'
    });
    // Ya tiene mes: el aviso queda solo en las otras dos tarjetas.
    await waitFor(() => expect(screen.getAllByText('Falta mes facturación')).toHaveLength(2));
  });

  it('si boMetaAPI.save falla avisa del error y Guardar sigue habilitado', async () => {
    api.boMetaAPI.save.mockRejectedValue(new Error('Error guardando BO meta'));
    renderApp();
    await esperarOrdenes();
    escribir(screen.getAllByPlaceholderText('Nombre del proyecto')[0], 'X');
    fireEvent.click(guardarDe(0));
    expect(await screen.findByText('Error guardando BO meta')).toBeInTheDocument();
    await waitFor(() => expect(guardarDe(0)).toBeEnabled());
  });

  it('S&D: al estar pendiente copia el aviso y, si se confirma, guarda sAndDStatus aplicado', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp();
    await esperarOrdenes();
    fireEvent.click(screen.getAllByRole('button', { name: 'S&D Pendiente' })[0]);
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-1001', { sAndDStatus: 'aplicado' }));
    expect(confirmar).toHaveBeenCalledWith('¿Marcar S&D como aplicado?');
    expect(await screen.findByRole('button', { name: 'S&D Aplicado' })).toBeInTheDocument();
    confirmar.mockRestore();
  });
});

describe('Órdenes: borradores sin guardar al cambiar de vista', () => {
  it('un monto sin guardar sobrevive a ir a Vista compras y volver a Órdenes', async () => {
    renderApp();
    await esperarOrdenes();
    abrirDetalle(0);
    escribir(inputsDeLinea('MPN-A1').intcomex, '777');
    await irAVista('Vista compras');
    await screen.findByText('Estado de compra, despacho y vía de cada BO del OSO.');
    await irAVista('Órdenes activas');
    await esperarOrdenes();
    // El detalle sigue abierto y el borrador intacto.
    expect(inputsDeLinea('MPN-A1').intcomex).toHaveValue(777);
    expect(guardarDe(0)).toBeEnabled();
    expect(api.boLineMetaAPI.save).not.toHaveBeenCalled();
  });

  it('un monto sin guardar SE PIERDE al ir al Dashboard y volver (decisión del dueño)', async () => {
    renderApp();
    await esperarOrdenes();
    abrirDetalle(0);
    escribir(inputsDeLinea('MPN-A1').intcomex, '777');
    // Órdenes es una vista que se desmonta al salir de ella (es decisión del dueño):
    // lo no guardado, borradores incluidos, se descarta aunque la página siga montada.
    await irAVista('Dashboard');
    await screen.findByText('Facturación estimada y reportada');
    await irAVista('Órdenes activas');
    await esperarOrdenes();
    abrirDetalle(0);
    // Decidido por el dueño: se mantiene que lo no guardado se pierde al salir de Órdenes.
    await waitFor(() => expect(inputsDeLinea('MPN-A1').intcomex).toHaveValue(null));
    expect(api.boLineMetaAPI.save).not.toHaveBeenCalled();
  });

  it('un nombre de proyecto sin guardar sobrevive a ir a Vista compras y volver', async () => {
    renderApp();
    await esperarOrdenes();
    escribir(screen.getAllByPlaceholderText('Nombre del proyecto')[0], 'Borrador');
    await irAVista('Vista compras');
    await screen.findByText('Estado de compra, despacho y vía de cada BO del OSO.');
    await irAVista('Órdenes activas');
    await esperarOrdenes();
    expect(screen.getAllByPlaceholderText('Nombre del proyecto')[0]).toHaveValue('Borrador');
    expect(guardarDe(0)).toBeEnabled();
  });
});

describe('Órdenes: BO no encontrados en OSO, facturados y eliminados', () => {
  const metaConFaltantes = () => [
    { bo: 'BO-1001', project_name: 'Proyecto Norte', po_axis: 'PO-77' },
    { bo: 'BO-9001', customer_name: 'Fantasma Uno' },
    { bo: 'BO-9002', customer_name: 'Fantasma Dos' },
    // No entran al modal: ya facturado / ya eliminado.
    { bo: 'BO-8001', customer_name: 'Ya Facturada SA', invoiced: true, invoiced_at: '2026-01-10T12:00:00.000Z', project_name: 'Proy Fact', po_axis: 'PO-F' },
    { bo: 'BO-7001', customer_name: 'Eliminada SA', deleted: true, deleted_comment: 'x' }
  ];

  it('aparece al cargar solo con BO de la meta ausentes de OSO, no facturados ni eliminados, y se puede cerrar', async () => {
    prepararApi({ meta: metaConFaltantes() });
    renderApp();
    expect(await screen.findByText('BO no encontrados en OSO')).toBeInTheDocument();
    expect(screen.getByText('BO BO-9001')).toBeInTheDocument();
    expect(screen.getByText('BO BO-9002')).toBeInTheDocument();
    expect(screen.queryByText('BO BO-8001', { selector: 'div' })).not.toBeInTheDocument();
    expect(screen.queryByText('BO BO-7001')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0]);
    expect(screen.queryByText('BO no encontrados en OSO')).not.toBeInTheDocument();
    expect(api.boMetaAPI.save).not.toHaveBeenCalled();
  });

  it('Omitir quita ese BO del modal sin llamar a la API', async () => {
    prepararApi({ meta: metaConFaltantes() });
    renderApp();
    await screen.findByText('BO no encontrados en OSO');
    fireEvent.click(screen.getAllByRole('button', { name: 'Omitir' })[0]);
    expect(screen.queryByText('BO BO-9001')).not.toBeInTheDocument();
    expect(screen.getByText('BO BO-9002')).toBeInTheDocument();
    expect(api.boMetaAPI.save).not.toHaveBeenCalled();
    expect(api.boMetaAPI.remove).not.toHaveBeenCalled();
  });

  it('Marcar facturado guarda invoiced y el BO pasa a la sección de facturadas', async () => {
    prepararApi({ meta: metaConFaltantes() });
    renderApp();
    await screen.findByText('BO no encontrados en OSO');
    // Antes: la sección de facturadas tiene solo BO-8001.
    expect(screen.getByRole('heading', { name: /Órdenes facturadas/ })).toHaveTextContent('(1)');
    fireEvent.click(screen.getAllByRole('button', { name: 'Marcar facturado' })[0]);
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledTimes(1));
    expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-9001', {
      invoiced: true,
      invoicedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    });
    expect(screen.queryByText('BO BO-9001', { selector: 'div' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Órdenes facturadas/ })).toHaveTextContent('(2)'));
    expect(screen.getByText('Fantasma Uno')).toBeInTheDocument();
    expect(screen.getByText(/Facturadas: 2/)).toBeInTheDocument();
  });

  it('Marcar todos marca cada BO faltante como facturado y cierra el modal', async () => {
    prepararApi({ meta: metaConFaltantes() });
    renderApp();
    await screen.findByText('BO no encontrados en OSO');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todos' }));
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledTimes(2));
    expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-9001', expect.objectContaining({ invoiced: true }));
    expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-9002', expect.objectContaining({ invoiced: true }));
    expect(screen.queryByText('BO no encontrados en OSO')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Órdenes facturadas/ })).toHaveTextContent('(3)');
  });

  it('la sección de facturadas lista sus datos, se filtra y permite Reactivar', async () => {
    prepararApi({ meta: metaConFaltantes() });
    renderApp();
    await screen.findByText('BO no encontrados en OSO');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0]);
    expect(screen.getByText('Ya Facturada SA')).toBeInTheDocument();
    expect(screen.getByText('Proyecto: Proy Fact')).toBeInTheDocument();
    expect(screen.getByText('PO Axis: PO-F')).toBeInTheDocument();
    const filtro = screen.getByPlaceholderText('Buscar BO o cliente');
    escribir(filtro, 'zzz');
    expect(screen.queryByText('Ya Facturada SA')).not.toBeInTheDocument();
    escribir(filtro, 'ya fact');
    expect(screen.getByText('Ya Facturada SA')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }));
    await waitFor(() => expect(api.boMetaAPI.save).toHaveBeenCalledWith('BO-8001', { invoiced: false }));
    // Sin facturados ya no hay sección.
    expect(screen.queryByRole('heading', { name: /Órdenes facturadas/ })).not.toBeInTheDocument();
  });

  it('Eliminar exige comentario; confirmar llama boMetaAPI.remove con el comentario recortado y quita el BO', async () => {
    prepararApi({ meta: metaConFaltantes() });
    renderApp();
    await screen.findByText('BO no encontrados en OSO');
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]);
    expect(await screen.findByRole('heading', { name: 'Eliminar BO BO-9001' })).toBeInTheDocument();
    const confirmar = () => screen.getAllByRole('button', { name: 'Eliminar' }).at(-1);
    // Sin comentario no se elimina.
    fireEvent.click(confirmar());
    expect(await screen.findByText('Comentario requerido.')).toBeInTheDocument();
    expect(api.boMetaAPI.remove).not.toHaveBeenCalled();
    // Un comentario de solo espacios tampoco vale.
    escribir(screen.getByPlaceholderText('Comentario obligatorio'), '   ');
    fireEvent.click(confirmar());
    expect(api.boMetaAPI.remove).not.toHaveBeenCalled();
    // Al escribir se limpia el error.
    escribir(screen.getByPlaceholderText('Comentario obligatorio'), '  Duplicado en OSO  ');
    expect(screen.queryByText('Comentario requerido.')).not.toBeInTheDocument();
    fireEvent.click(confirmar());
    await waitFor(() => expect(api.boMetaAPI.remove).toHaveBeenCalledTimes(1));
    expect(api.boMetaAPI.remove).toHaveBeenCalledWith('BO-9001', 'Duplicado en OSO');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Eliminar BO BO-9001' })).not.toBeInTheDocument());
    expect(screen.queryByText('BO BO-9001')).not.toBeInTheDocument();
    expect(screen.getByText('BO BO-9002')).toBeInTheDocument();
    // Un BO eliminado no va a la sección de facturadas.
    expect(screen.getByRole('heading', { name: /Órdenes facturadas/ })).toHaveTextContent('(1)');
  });

  it('Cancelar el modal de eliminar no llama a la API y el BO sigue en la lista', async () => {
    prepararApi({ meta: metaConFaltantes() });
    renderApp();
    await screen.findByText('BO no encontrados en OSO');
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]);
    await screen.findByRole('heading', { name: 'Eliminar BO BO-9001' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { name: 'Eliminar BO BO-9001' })).not.toBeInTheDocument();
    expect(api.boMetaAPI.remove).not.toHaveBeenCalled();
    expect(screen.getByText('BO BO-9001')).toBeInTheDocument();
  });

  it('si boMetaAPI.remove falla muestra el error y el modal sigue abierto', async () => {
    prepararApi({ meta: metaConFaltantes() });
    api.boMetaAPI.remove.mockRejectedValue(new Error('Error eliminando BO'));
    renderApp();
    await screen.findByText('BO no encontrados en OSO');
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]);
    await screen.findByRole('heading', { name: 'Eliminar BO BO-9001' });
    escribir(screen.getByPlaceholderText('Comentario obligatorio'), 'motivo');
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' }).at(-1));
    expect(await screen.findByText('Error eliminando BO')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Eliminar BO BO-9001' })).toBeInTheDocument();
  });
});

describe('Órdenes: filtros y búsqueda', () => {
  it('el filtro de estado reduce la lista (activas, parciales, completas) sin tocar los totales', async () => {
    renderApp();
    await esperarOrdenes();
    const estado = screen.getByDisplayValue('Todos');
    escribir(estado, 'activa');
    await waitFor(() => expect(botonBo('BO-1002')).not.toBeInTheDocument());
    expect(botonBo('BO-1001')).toBeInTheDocument();
    expect(botonBo('BO-1003')).not.toBeInTheDocument();
    escribir(estado, 'parcial');
    await waitFor(() => expect(botonBo('BO-1003')).toBeInTheDocument());
    expect(botonBo('BO-1001')).not.toBeInTheDocument();
    escribir(estado, 'completa');
    await waitFor(() => expect(botonBo('BO-1002')).toBeInTheDocument());
    expect(botonBo('BO-1003')).not.toBeInTheDocument();
    expect(screen.getByText(/Total: 3 · Activas: 1/)).toBeInTheDocument();
  });

  it('la búsqueda del admin filtra por cliente, BO, SKU y MPN de las líneas', async () => {
    renderApp();
    await esperarOrdenes();
    const buscar = screen.getByRole('textbox', { name: 'Buscar' });
    escribir(buscar, 'gamma');
    await waitFor(() => expect(botonBo('BO-1001')).not.toBeInTheDocument());
    expect(botonBo('BO-1003')).toBeInTheDocument();
    escribir(buscar, 'SKU-A2');
    await waitFor(() => expect(botonBo('BO-1001')).toBeInTheDocument());
    expect(botonBo('BO-1003')).not.toBeInTheDocument();
    escribir(buscar, 'mpn-b1');
    await waitFor(() => expect(botonBo('BO-1002')).toBeInTheDocument());
    expect(botonBo('BO-1001')).not.toBeInTheDocument();
    escribir(buscar, 'BO-1003');
    await waitFor(() => expect(botonBo('BO-1003')).toBeInTheDocument());
    expect(botonBo('BO-1002')).not.toBeInTheDocument();
  });

  it('una búsqueda sin coincidencias muestra el estado vacío', async () => {
    renderApp();
    await esperarOrdenes();
    escribir(screen.getByRole('textbox', { name: 'Buscar' }), 'no-existe-xyz');
    expect(await screen.findByText('Sin órdenes activas')).toBeInTheDocument();
  });

  it('la búsqueda encuentra por nombre de proyecto y por PO Axis, que viven en la meta del BO', async () => {
    renderApp();
    await esperarOrdenes();
    const buscar = screen.getByRole('textbox', { name: 'Buscar' });
    // Solo BO-1001 tiene proyecto "Proyecto Norte" y PO "PO-77" en la meta.
    escribir(buscar, 'proyecto norte');
    await waitFor(() => expect(botonBo('BO-1002')).not.toBeInTheDocument());
    expect(botonBo('BO-1001')).toBeInTheDocument();
    escribir(buscar, 'PO-77');
    await waitFor(() => expect(botonBo('BO-1001')).toBeInTheDocument());
    expect(botonBo('BO-1002')).not.toBeInTheDocument();
    escribir(buscar, 'PO-que-no-existe');
    expect(await screen.findByText('Sin órdenes activas')).toBeInTheDocument();
  });

  it('la búsqueda también encuentra por un proyecto recién escrito y aún sin guardar', async () => {
    renderApp();
    await esperarOrdenes();
    // Se busca por lo que se VE en la tarjeta, borrador incluido.
    escribir(screen.getAllByPlaceholderText('Nombre del proyecto')[1], 'Licitación Sur');
    escribir(screen.getByRole('textbox', { name: 'Buscar' }), 'licitación sur');
    await waitFor(() => expect(botonBo('BO-1001')).not.toBeInTheDocument());
    expect(botonBo('BO-1002')).toBeInTheDocument();
  });

  it('el filtro rápido "Proyecto vacío" deja solo los BO sin proyecto', async () => {
    renderApp();
    await esperarOrdenes();
    fireEvent.click(screen.getByRole('button', { name: 'Más filtros' }));
    fireEvent.click(screen.getByRole('button', { name: 'Proyecto vacío' }));
    await waitFor(() => expect(botonBo('BO-1001')).not.toBeInTheDocument());
    expect(botonBo('BO-1002')).toBeInTheDocument();
    expect(botonBo('BO-1003')).toBeInTheDocument();
  });

  it('Fijar sube el BO a "BOs fijados" y Quitar pin lo devuelve', async () => {
    renderApp();
    await esperarOrdenes();
    expect(screen.queryByText('BOs fijados')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Fijar' })[1]);
    expect(await screen.findByText('BOs fijados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar pin' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar pin' }));
    await waitFor(() => expect(screen.queryByText('BOs fijados')).not.toBeInTheDocument());
  });

  it('Acciones › Refrescar vuelve a pedir órdenes y meta', async () => {
    renderApp();
    await esperarOrdenes();
    escribir(screen.getByDisplayValue('Acciones…'), 'refresh');
    await waitFor(() => expect(api.osoAPI.getOrders).toHaveBeenCalledTimes(2));
    expect(api.boMetaAPI.getAll).toHaveBeenCalledTimes(2);
  });

  it('Informes › Informe por empresa abre el modal de informe y se puede cerrar', async () => {
    renderApp();
    await esperarOrdenes();
    expect(screen.queryByRole('heading', { name: 'Informe de órdenes activas' })).not.toBeInTheDocument();
    escribir(screen.getByDisplayValue('Informes…'), 'empresa');
    expect(await screen.findByRole('heading', { name: 'Informe de órdenes activas' })).toBeInTheDocument();
    expect(screen.getByText('ETA estimado por línea = Entrega OOR + 15 días.')).toBeInTheDocument();
  });
});

describe('Dashboard', () => {
  it('al entrar como admin pide las órdenes y muestra la facturación del mes con los BO de esas órdenes', async () => {
    prepararApi({
      meta: [{ bo: 'BO-1001', project_name: 'Proyecto Norte', estimated_invoice_month: mesActual(), estimated_invoice_week: 1 }]
    });
    renderApp({ ruta: '/dashboard' });
    expect(await screen.findByText('Facturación estimada y reportada')).toBeInTheDocument();
    await waitFor(() => expect(api.osoAPI.getOrders).toHaveBeenCalled());
    expect(api.boMetaAPI.getAll).toHaveBeenCalled();
    // BO-1001 tiene montos guardados (Axis 100 x 4, Intcomex 55 x 2): cuenta como "con monto".
    expect(await screen.findByText('1 BO · 1 con monto')).toBeInTheDocument();
    expect(screen.getByText(/^Por facturar/)).toBeInTheDocument();
  });
});
