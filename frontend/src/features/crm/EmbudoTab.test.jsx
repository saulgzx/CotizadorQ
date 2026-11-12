import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import EmbudoTab from './EmbudoTab';
import { crmApi } from './crmApi';
import { EMBUDO, OPORTUNIDADES, op, renderConQuery } from './fixturesCrm';

vi.mock('./crmApi', () => ({
  crmApi: {
    embudo: vi.fn(),
    listarOportunidades: vi.fn(),
    actualizarOportunidad: vi.fn(),
    listarEmpresas: vi.fn(),
    obtenerEmpresa: vi.fn(),
    crearOportunidad: vi.fn()
  }
}));

const columna = (nombre) => screen.getByRole('region', { name: `Etapa ${nombre}` });

describe('EmbudoTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crmApi.embudo.mockResolvedValue(EMBUDO);
    crmApi.listarOportunidades.mockResolvedValue({ items: OPORTUNIDADES.map((o) => ({ ...o })) });
  });

  test('muestra totales y tarjetas por etapa con los datos del contrato', async () => {
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    expect(await screen.findByText('Proyecto BID Norte')).toBeInTheDocument();

    // Los tres totales van en una sola franja.
    const franja = screen.getByRole('group', { name: 'Totales del embudo' });
    expect(within(franja).getByText('Abiertas')).toBeInTheDocument();
    expect(within(franja).getByText('$9,700.50')).toBeInTheDocument();
    expect(within(franja).getByText('Ganadas del mes')).toBeInTheDocument();
    expect(within(franja).getByText('Perdidas del mes')).toBeInTheDocument();

    const cotizada = within(columna('Cotizada'));
    expect(cotizada.getByText('Sonda S.A.')).toBeInTheDocument();
    expect(cotizada.getAllByText('$1,500.50').length).toBe(2); // total de columna y de tarjeta
    expect(cotizada.getByText('AXIS')).toBeInTheDocument();
    expect(cotizada.getByText('3 días')).toBeInTheDocument();

    const negociacion = within(columna('Negociación'));
    expect(negociacion.getByText('BID')).toBeInTheDocument();
    expect(negociacion.getByText('QNAP')).toBeInTheDocument();
    expect(negociacion.getByText('1 día')).toBeInTheDocument();

    const perdida = within(columna('Perdida'));
    expect(perdida.getByText(/Motivo: Precio/)).toBeInTheDocument();
    expect(perdida.getByRole('article', { name: 'Oportunidad Cotización #080' })).toHaveAttribute('title', 'Motivo: Precio');
    expect(within(columna('Nueva')).getByText(/Sin oportunidades/)).toBeInTheDocument();
  });

  test('cada columna tiene su cabecera con nombre, cantidad y total, y una lista con scroll propio', async () => {
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');
    const cotizada = columna('Cotizada');
    const cabecera = cotizada.querySelector('header');
    expect(within(cabecera).getByRole('heading', { name: /Cotizada/ })).toHaveTextContent('Cotizada1');
    expect(within(cabecera).getByText('$1,500.50')).toBeInTheDocument();
    expect(cotizada.querySelector('.embudo-lista')).toContainElement(within(cotizada).getByRole('article'));
  });

  test('el nombre de la empresa abre su ficha', async () => {
    const onAbrirEmpresa = vi.fn();
    renderConQuery(<EmbudoTab onAbrirEmpresa={onAbrirEmpresa} />);
    await screen.findByText('Proyecto BID Norte');
    fireEvent.click(within(columna('Negociación')).getByRole('button', { name: 'Entel' }));
    expect(onAbrirEmpresa).toHaveBeenCalledWith(11);
  });

  test('el número de cotización llama a onAbrirCotizacion', async () => {
    const onAbrirCotizacion = vi.fn();
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} onAbrirCotizacion={onAbrirCotizacion} />);
    await screen.findByText('Proyecto BID Norte');

    const boton = within(columna('Cotizada')).getByRole('button', { name: 'Abrir cotización 101' });
    expect(boton).toHaveTextContent('#101');
    fireEvent.click(boton);
    expect(onAbrirCotizacion).toHaveBeenCalledWith(77);
    // Las oportunidades sin cotización vinculada no muestran número.
    expect(within(columna('Negociación')).queryByRole('button', { name: /Abrir cotización/ })).not.toBeInTheDocument();
  });

  test('sin onAbrirCotizacion el número se muestra como texto', async () => {
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');
    expect(within(columna('Cotizada')).getByText('#101')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir cotización/ })).not.toBeInTheDocument();
  });

  test('las cerradas no se recortan y van de la más reciente a la más antigua', async () => {
    const ganadas = Array.from({ length: 40 }, (_, i) => op({
      id: 100 + i,
      titulo: `Ganada ${i}`,
      etapa: 'ganada',
      updated_at: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T${String(10 + Math.floor(i / 28)).padStart(2, '0')}:00:00Z`
    }));
    crmApi.listarOportunidades.mockResolvedValue({ items: [...OPORTUNIDADES.map((o) => ({ ...o })), ...ganadas] });
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');

    const col = columna('Ganada');
    const tarjetas = within(col).getAllByRole('article');
    expect(tarjetas).toHaveLength(41);
    expect(within(col).getByRole('heading', { name: /Ganada/ })).toHaveTextContent('41');
    expect(within(col).queryByText(/más antiguas/)).not.toBeInTheDocument();
    // La de fixtures (2026-11-08) es la más reciente; la más antigua (2026-10-01 10:00) va al final.
    expect(tarjetas[0]).toHaveAccessibleName('Oportunidad Cotización #090');
    expect(tarjetas[tarjetas.length - 1]).toHaveAccessibleName('Oportunidad Ganada 0');
  });

  test('el control para mover existe en cada tarjeta aunque no se vea', async () => {
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');
    for (const titulo of ['Cotización #101', 'Proyecto BID Norte', 'Cotización #090', 'Cotización #080']) {
      const select = screen.getByLabelText(`Mover ${titulo} a otra etapa`);
      expect(select.tagName).toBe('SELECT');
      expect(within(select).getAllByRole('option')).toHaveLength(5);
    }
  });

  test('arrastrar y soltar mueve la tarjeta a otra columna', async () => {
    let resolver;
    crmApi.actualizarOportunidad.mockReturnValue(new Promise((r) => { resolver = r; }));
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');

    const datos = {};
    const dataTransfer = {
      setData: (k, v) => { datos[k] = v; },
      getData: (k) => datos[k],
      effectAllowed: ''
    };
    const tarjeta = within(columna('Cotizada')).getByRole('article', { name: 'Oportunidad Cotización #101' });
    expect(tarjeta).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(tarjeta, { dataTransfer });
    fireEvent.dragOver(columna('Ganada'), { dataTransfer });
    expect(columna('Ganada')).toHaveClass('embudo-columna-sobre');
    fireEvent.drop(columna('Ganada'), { dataTransfer });

    await waitFor(() => expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'ganada' }));
    await waitFor(() => expect(within(columna('Ganada')).getByText('Cotización #101')).toBeInTheDocument());
    expect(within(columna('Cotizada')).queryByText('Cotización #101')).not.toBeInTheDocument();
    expect(columna('Ganada')).not.toHaveClass('embudo-columna-sobre');
    resolver({ ...OPORTUNIDADES[0], etapa: 'ganada' });
  });

  test('soltar en perdida pide el motivo', async () => {
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');
    const datos = {};
    const dataTransfer = { setData: (k, v) => { datos[k] = v; }, getData: (k) => datos[k] };
    fireEvent.dragStart(within(columna('Negociación')).getByRole('article'), { dataTransfer });
    fireEvent.drop(columna('Perdida'), { dataTransfer });
    expect(await screen.findByRole('dialog', { name: /Marcar como perdida/ })).toBeInTheDocument();
    expect(crmApi.actualizarOportunidad).not.toHaveBeenCalled();
  });

  test('filtra por texto y por marca', async () => {
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');

    fireEvent.change(screen.getByLabelText('Buscar oportunidades'), { target: { value: 'entel' } });
    expect(screen.getByText('Proyecto BID Norte')).toBeInTheDocument();
    expect(screen.queryByText('Cotización #101')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Buscar oportunidades'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filtrar por marca'), { target: { value: 'AXIS' } });
    expect(screen.getByText('Cotización #101')).toBeInTheDocument();
    expect(screen.queryByText('Proyecto BID Norte')).not.toBeInTheDocument();
  });

  test('cambio de etapa optimista: la tarjeta se mueve antes de la respuesta', async () => {
    let resolver;
    crmApi.actualizarOportunidad.mockReturnValue(new Promise((r) => { resolver = r; }));
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');

    fireEvent.change(screen.getByLabelText('Mover Cotización #101 a otra etapa'), { target: { value: 'negociacion' } });

    await waitFor(() => expect(within(columna('Negociación')).getByText('Cotización #101')).toBeInTheDocument());
    expect(within(columna('Cotizada')).queryByText('Cotización #101')).not.toBeInTheDocument();
    expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'negociacion' });
    resolver({ ...OPORTUNIDADES[0], etapa: 'negociacion' });
  });

  test('si el servidor falla, la tarjeta vuelve a su etapa', async () => {
    crmApi.actualizarOportunidad.mockRejectedValue(new Error('Servidor caído'));
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');

    fireEvent.change(screen.getByLabelText('Mover Cotización #101 a otra etapa'), { target: { value: 'ganada' } });

    await waitFor(() => expect(crmApi.actualizarOportunidad).toHaveBeenCalled());
    await waitFor(() => expect(within(columna('Cotizada')).getByText('Cotización #101')).toBeInTheDocument());
    expect(within(columna('Ganada')).queryByText('Cotización #101')).not.toBeInTheDocument();
  });

  test('pasar a perdida exige el motivo', async () => {
    crmApi.actualizarOportunidad.mockResolvedValue({});
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');

    fireEvent.change(screen.getByLabelText('Mover Cotización #101 a otra etapa'), { target: { value: 'perdida' } });
    const dialogo = await screen.findByRole('dialog', { name: /Marcar como perdida/ });
    expect(crmApi.actualizarOportunidad).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Marcar como perdida' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/motivo es obligatorio/);
    expect(crmApi.actualizarOportunidad).not.toHaveBeenCalled();

    fireEvent.change(within(dialogo).getByLabelText('Motivo de la pérdida'), { target: { value: 'Eligió otra marca' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Marcar como perdida' }));

    await waitFor(() =>
      expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'perdida', motivo_perdida: 'Eligió otra marca' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('Esc cierra el diálogo de pérdida sin guardar', async () => {
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    await screen.findByText('Proyecto BID Norte');
    fireEvent.change(screen.getByLabelText('Mover Cotización #101 a otra etapa'), { target: { value: 'perdida' } });
    const dialogo = await screen.findByRole('dialog');
    fireEvent.keyDown(dialogo, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(crmApi.actualizarOportunidad).not.toHaveBeenCalled();
  });

  test('estado vacío cuando no hay oportunidades', async () => {
    crmApi.listarOportunidades.mockResolvedValue({ items: [] });
    renderConQuery(<EmbudoTab onAbrirEmpresa={() => {}} />);
    expect(await screen.findByText('Aún no hay oportunidades')).toBeInTheDocument();
    expect(screen.getByText(/se crean solas al generar una cotización/i)).toBeInTheDocument();
  });
});
