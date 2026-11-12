import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import CrmView from './CrmView';
import {
  ArchivarAnterioresDialogo,
  ConmutadorArchivo,
  EtapaCotizacion,
  EtiquetaVersion,
  FiltroEtapas,
  SelectorEtapa
} from './CotizacionesPiezas';
import { crmApi, seguimientoApi } from './crmApi';
import { cotizacionesAPI } from '../../api';
import { EMBUDO, FICHA, OPORTUNIDADES, renderConQuery } from './fixturesCrm';

vi.mock('./crmApi', () => ({
  crmApi: {
    obtenerEmpresa: vi.fn(),
    actualizarOportunidad: vi.fn(),
    listarEmpresas: vi.fn(),
    listarOportunidades: vi.fn(),
    duplicadosEmpresas: vi.fn(),
    embudo: vi.fn()
  },
  seguimientoApi: { lista: vi.fn(), valor: vi.fn(), pausar: vi.fn(), reanudar: vi.fn() }
}));

vi.mock('../../api', async (original) => ({
  ...(await original()),
  cotizacionesAPI: { previaArchivar: vi.fn(), archivar: vi.fn() }
}));

beforeEach(() => {
  vi.clearAllMocks();
  crmApi.embudo.mockResolvedValue(EMBUDO);
  crmApi.listarOportunidades.mockResolvedValue({ items: OPORTUNIDADES });
  crmApi.listarEmpresas.mockResolvedValue({ items: [], total: 0 });
  crmApi.duplicadosEmpresas.mockResolvedValue({ grupos: [] });
  crmApi.obtenerEmpresa.mockResolvedValue(FICHA);
  seguimientoApi.lista.mockResolvedValue({ activo: false, total: 0, items: [] });
});

describe('CrmView › pestaña Cotizaciones', () => {
  test('ordena las pestañas con Cotizaciones después de Embudo', () => {
    renderConQuery(<CrmView />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Resumen', 'Embudo', 'Cotizaciones', 'Empresas', 'Seguimiento automático'
    ]);
  });

  test('sin control externo cambia de pestaña sola y muestra el contenido de Cotizaciones', () => {
    renderConQuery(<CrmView cotizaciones={<p>Lista de cotizaciones</p>} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Cotizaciones' }));
    expect(screen.getByRole('tab', { name: 'Cotizaciones' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Lista de cotizaciones')).toBeInTheDocument();
  });

  test('con `tab` controlada avisa por onTab y respeta la pestaña que le dan', () => {
    const onTab = vi.fn();
    renderConQuery(<CrmView tab='cotizaciones' onTab={onTab} cotizaciones={() => <p>Contenido</p>} />);
    expect(screen.getByRole('tab', { name: 'Cotizaciones' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contenido')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Empresas' }));
    expect(onTab).toHaveBeenCalledWith('empresas');
    // El padre no cambió la pestaña: sigue en Cotizaciones.
    expect(screen.getByRole('tab', { name: 'Cotizaciones' })).toHaveAttribute('aria-selected', 'true');
  });

  test('el contenido recibe abrirEmpresa, que lleva a la ficha en Empresas', async () => {
    function Padre() {
      const [tab, setTab] = useState('cotizaciones');
      return (
        <CrmView
          tab={tab}
          onTab={setTab}
          cotizaciones={({ abrirEmpresa }) => (
            <button type='button' onClick={() => abrirEmpresa(10)}>CRM: Sonda S.A.</button>
          )}
        />
      );
    }
    renderConQuery(<Padre />);
    fireEvent.click(screen.getByRole('button', { name: 'CRM: Sonda S.A.' }));
    expect(screen.getByRole('tab', { name: 'Empresas' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: /Sonda S\.A\./ })).toBeInTheDocument();
    expect(crmApi.obtenerEmpresa).toHaveBeenCalledWith(10);
  });
});

describe('Piezas de Cotizaciones', () => {
  test('EtapaCotizacion muestra punto y nombre; deriva la etapa del estado heredado', () => {
    const { rerender } = render(<EtapaCotizacion cot={{ etapa: 'negociacion' }} />);
    expect(screen.getByText('Negociación')).toBeInTheDocument();
    rerender(<EtapaCotizacion cot={{ estado: 'aprobada' }} />);
    expect(screen.getByText('Ganada')).toBeInTheDocument();
  });

  test('FiltroEtapas: 5 etapas con conteo y aria-pressed', () => {
    const onAlternar = vi.fn();
    render(<FiltroEtapas seleccion={['ganada']} conteos={{ ganada: 4, perdida: 1 }} onAlternar={onAlternar} />);
    const grupo = screen.getByRole('group', { name: 'Filtrar por etapa' });
    const botones = within(grupo).getAllByRole('button');
    expect(botones.map((b) => b.textContent)).toEqual(['Nueva0', 'Cotizada0', 'Negociación0', 'Ganada4', 'Perdida1']);
    expect(within(grupo).getByRole('button', { name: /Ganada/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(grupo).getByRole('button', { name: /Perdida/ }));
    expect(onAlternar).toHaveBeenCalledWith('perdida');
  });

  test('SelectorEtapa: elegir otra etapa avisa; la vigente no', () => {
    const onElegir = vi.fn();
    render(<SelectorEtapa etapa='cotizada' onElegir={onElegir} etiqueta='Etapa de la cotización 101' />);
    const grupo = screen.getByRole('group', { name: 'Etapa de la cotización 101' });
    fireEvent.click(within(grupo).getByRole('button', { name: 'Cotizada' }));
    expect(onElegir).not.toHaveBeenCalled();
    fireEvent.click(within(grupo).getByRole('button', { name: 'Perdida' }));
    expect(onElegir).toHaveBeenCalledWith('perdida');
  });

  test('ConmutadorArchivo marca la vista activa', () => {
    const onCambiar = vi.fn();
    render(<ConmutadorArchivo vista='activas' onCambiar={onCambiar} />);
    expect(screen.getByRole('button', { name: 'Activas' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Archivadas' }));
    expect(onCambiar).toHaveBeenCalledWith('archivadas');
  });

  test('EtiquetaVersion: siempre vN; con onVer es un botón', () => {
    const onVer = vi.fn();
    const { rerender } = render(<EtiquetaVersion version={null} numero='101' />);
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<EtiquetaVersion version={3} numero='101' onVer={onVer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver versiones de la cotización 101 (vigente v3)' }));
    expect(onVer).toHaveBeenCalled();
  });
});

describe('ArchivarAnterioresDialogo', () => {
  test('consulta la vista previa y archiva con la fecha elegida', async () => {
    cotizacionesAPI.previaArchivar.mockResolvedValue({ cotizaciones: 3, oportunidades: 2 });
    cotizacionesAPI.archivar.mockResolvedValue({ cotizaciones: 3, oportunidades: 2 });
    const onArchivado = vi.fn();
    const onCerrar = vi.fn();
    render(<ArchivarAnterioresDialogo onCerrar={onCerrar} onArchivado={onArchivado} />);
    const dialogo = screen.getByRole('dialog', { name: 'Archivar anteriores a una fecha' });
    expect(dialogo).toHaveAccessibleDescription(/Archivar no borra/);
    const archivar = screen.getByRole('button', { name: 'Archivar' });
    expect(archivar).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Archivar lo creado antes del/), { target: { value: '2026-01-01' } });
    expect(await screen.findByText('Se archivarán 3 cotizaciones y 2 oportunidades.')).toBeInTheDocument();
    expect(cotizacionesAPI.previaArchivar).toHaveBeenCalledWith('2026-01-01');
    expect(cotizacionesAPI.archivar).not.toHaveBeenCalled();

    fireEvent.click(archivar);
    await vi.waitFor(() => expect(onArchivado).toHaveBeenCalledWith({ cotizaciones: 3, oportunidades: 2 }));
    expect(cotizacionesAPI.archivar).toHaveBeenCalledWith({ antesDe: '2026-01-01' });
    expect(onCerrar).toHaveBeenCalled();
  });

  test('si no hay nada que archivar no deja confirmar', async () => {
    cotizacionesAPI.previaArchivar.mockResolvedValue({ cotizaciones: 0, oportunidades: 0 });
    render(<ArchivarAnterioresDialogo onCerrar={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Archivar lo creado antes del/), { target: { value: '2020-01-01' } });
    expect(await screen.findByText('No hay nada activo anterior a esa fecha.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archivar' })).toBeDisabled();
  });

  test('muestra el error de la vista previa', async () => {
    cotizacionesAPI.previaArchivar.mockRejectedValue(new Error('Fecha inválida'));
    render(<ArchivarAnterioresDialogo onCerrar={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Archivar lo creado antes del/), { target: { value: '2026-01-01' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Fecha inválida');
  });
});
