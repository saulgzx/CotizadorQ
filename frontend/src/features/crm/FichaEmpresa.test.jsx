import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import FichaEmpresa from './FichaEmpresa';
import CrmView from './CrmView';
import { crmApi, seguimientoApi } from './crmApi';
import { EMBUDO, FICHA, OPORTUNIDADES, renderConQuery } from './fixturesCrm';

vi.mock('./crmApi', () => ({
  crmApi: {
    obtenerEmpresa: vi.fn(),
    actualizarContacto: vi.fn(),
    actualizarEmpresa: vi.fn(),
    actualizarOportunidad: vi.fn(),
    crearContacto: vi.fn(),
    crearOportunidad: vi.fn(),
    listarEmpresas: vi.fn(),
    listarOportunidades: vi.fn(),
    duplicadosEmpresas: vi.fn(),
    embudo: vi.fn()
  },
  seguimientoApi: {
    lista: vi.fn(),
    valor: vi.fn(),
    pausar: vi.fn(),
    reanudar: vi.fn()
  }
}));

describe('FichaEmpresa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crmApi.obtenerEmpresa.mockResolvedValue(FICHA);
  });

  test('muestra datos, resumen, contactos, oportunidades y cotizaciones', async () => {
    renderConQuery(<FichaEmpresa empresaId={10} onVolver={() => {}} onAbrirCotizacion={() => {}} />);
    expect(await screen.findByRole('heading', { name: /Sonda S\.A\./ })).toBeInTheDocument();
    expect(screen.getByText(/83\.628\.100-4/)).toBeInTheDocument();

    const resumen = screen.getByLabelText('Resumen de la empresa');
    expect(within(resumen).getByText('$12,000.00')).toBeInTheDocument();
    expect(within(resumen).getByText('25%')).toBeInTheDocument();
    expect(within(resumen).getByText('1 · $3,000.00')).toBeInTheDocument();

    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Luis Rojas')).toBeInTheDocument();
    expect(screen.getByText('(archivado)')).toBeInTheDocument();
    expect(screen.getByLabelText('Etapa de Cotización #101')).toHaveValue('cotizada');
  });

  test('la cotización abre la pestaña Cotizaciones por id', async () => {
    const onAbrir = vi.fn();
    renderConQuery(<FichaEmpresa empresaId={10} onVolver={() => {}} onAbrirCotizacion={onAbrir} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir cotización 101 en Cotizaciones' }));
    expect(onAbrir).toHaveBeenCalledWith(77);
  });

  test('sin onAbrirCotizacion deja el número visible sin enlace', async () => {
    renderConQuery(<FichaEmpresa empresaId={10} onVolver={() => {}} />);
    expect(await screen.findByText('#101')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir cotización/ })).not.toBeInTheDocument();
  });

  test('archiva un contacto', async () => {
    crmApi.actualizarContacto.mockResolvedValue({});
    renderConQuery(<FichaEmpresa empresaId={10} onVolver={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Archivar contacto Ana Pérez' }));
    await waitFor(() => expect(crmApi.actualizarContacto).toHaveBeenCalledWith(5, { archivado: true }));
  });

  test('agrega un contacto', async () => {
    crmApi.crearContacto.mockResolvedValue({ id: 9 });
    renderConQuery(<FichaEmpresa empresaId={10} onVolver={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar contacto' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo contacto' });
    fireEvent.change(within(dialogo).getByLabelText('Nombre'), { target: { value: 'Marta' } });
    fireEvent.change(within(dialogo).getByLabelText('Email'), { target: { value: 'marta@sonda.com' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Agregar contacto' }));
    await waitFor(() =>
      expect(crmApi.crearContacto).toHaveBeenCalledWith(expect.objectContaining({ empresa_id: 10, nombre: 'Marta', email: 'marta@sonda.com' }))
    );
  });

  test('cambia la etapa de una oportunidad desde la ficha', async () => {
    crmApi.actualizarOportunidad.mockResolvedValue({});
    renderConQuery(<FichaEmpresa empresaId={10} onVolver={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Etapa de Cotización #101'), { target: { value: 'ganada' } });
    await waitFor(() => expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'ganada' }));
  });
});

describe('CrmView atajos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crmApi.embudo.mockResolvedValue(EMBUDO);
    crmApi.listarOportunidades.mockResolvedValue({ items: OPORTUNIDADES });
    crmApi.listarEmpresas.mockResolvedValue({ items: [], total: 0 });
    crmApi.duplicadosEmpresas.mockResolvedValue({ grupos: [] });
    seguimientoApi.lista.mockResolvedValue({ activo: false, total: 0, items: [] });
  });

  test('abre en el Resumen con el embudo y el seguimiento automático', async () => {
    renderConQuery(<CrmView />);
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'Embudo de ventas' })).toBeInTheDocument();
    expect(await screen.findByText('Apagado en el servidor')).toBeInTheDocument();
  });

  test('"/" enfoca la búsqueda y "N" abre el diálogo, pero no mientras se escribe', async () => {
    renderConQuery(<CrmView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Embudo' }));
    await screen.findByText('Proyecto BID Norte');
    const busqueda = screen.getByLabelText('Buscar oportunidades');

    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(busqueda);

    // Escribiendo en el campo, "n" no abre nada.
    fireEvent.keyDown(busqueda, { key: 'n' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    busqueda.blur();
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(await screen.findByRole('dialog', { name: 'Nueva oportunidad' })).toBeInTheDocument();
  });

  test('en la pestaña Empresas "N" crea una empresa', async () => {
    renderConQuery(<CrmView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Empresas' }));
    await screen.findByLabelText('Buscar empresas');
    fireEvent.keyDown(document.body, { key: 'N' });
    expect(await screen.findByRole('dialog', { name: 'Nueva empresa' })).toBeInTheDocument();
  });
});
