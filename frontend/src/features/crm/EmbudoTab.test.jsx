import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import EmbudoTab from './EmbudoTab';
import { crmApi } from './crmApi';
import { EMBUDO, OPORTUNIDADES, renderConQuery } from './fixturesCrm';

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

    expect(screen.getByText('$9,700.50')).toBeInTheDocument();
    expect(screen.getByText('Ganadas del mes')).toBeInTheDocument();
    expect(screen.getByText('Perdidas del mes')).toBeInTheDocument();

    const cotizada = within(columna('Cotizada'));
    expect(cotizada.getByText('Sonda S.A.')).toBeInTheDocument();
    expect(cotizada.getAllByText('$1,500.50').length).toBe(2); // total de columna y de tarjeta
    expect(cotizada.getByText('AXIS')).toBeInTheDocument();
    expect(cotizada.getByText('3 días en la etapa')).toBeInTheDocument();

    const negociacion = within(columna('Negociación'));
    expect(negociacion.getByText('Proyecto / BID')).toBeInTheDocument();
    expect(within(columna('Perdida')).getByText(/Motivo: Precio/)).toBeInTheDocument();
    expect(within(columna('Nueva')).getByText(/Sin oportunidades/)).toBeInTheDocument();
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
