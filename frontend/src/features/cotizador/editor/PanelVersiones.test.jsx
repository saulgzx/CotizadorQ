import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import PanelVersiones from './PanelVersiones';
import { cotizacionesAPI } from '../../../api';

vi.mock('../../../api', async (original) => ({
  ...(await original()),
  cotizacionesAPI: { getVersiones: vi.fn(), getVersion: vi.fn() }
}));

const LISTA = [
  { version: 2, total: 285, nota: 'Cliente pidió 3 unidades', creado_por: 'jleon', creado_en: '2026-11-10T15:00:00Z', vigente: true },
  { version: 1, total: 200, nota: null, creado_por: 'ana', creado_en: '2026-11-01T10:00:00Z', vigente: false }
];

const DETALLE = {
  1: {
    version: 1,
    total: 200,
    cotizacion: { cliente_empresa: 'Sonda' },
    items: [{ id: 1, producto_id: 9, sku: 'CAM-1', cantidad: 2, precio_unitario: 100, costo_unitario: 80, precio_total: 200 }]
  },
  2: {
    version: 2,
    total: 285,
    cotizacion: { cliente_empresa: 'Sonda S.A.' },
    items: [{ id: 2, producto_id: 9, sku: 'CAM-1', cantidad: 3, precio_unitario: 95, costo_unitario: 80, precio_total: 285 }]
  }
};

describe('PanelVersiones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cotizacionesAPI.getVersiones.mockResolvedValue(LISTA);
    cotizacionesAPI.getVersion.mockImplementation((_id, v) => Promise.resolve(DETALLE[v]));
  });

  test('lista v1…vN con la vigente marcada, fecha, autor, total y nota', async () => {
    render(<PanelVersiones cotizacionId={7} versionActual={2} numero='101' onCerrar={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Versiones de la cotización 101' })).toBeInTheDocument();
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('v2')).toBeInTheDocument();
    expect(within(items[0]).getByText('Vigente')).toBeInTheDocument();
    expect(within(items[0]).getByText('“Cliente pidió 3 unidades”')).toBeInTheDocument();
    expect(within(items[0]).getByText(/por jleon/)).toBeInTheDocument();
    expect(within(items[1]).getByText('v1')).toBeInTheDocument();
    expect(within(items[1]).queryByText('Vigente')).not.toBeInTheDocument();
    expect(within(items[1]).getByText('Sin nota')).toBeInTheDocument();
    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument();
  });

  test('el detalle muestra qué cambió respecto de la versión anterior y, en solo lectura, no ofrece cargar', async () => {
    render(<PanelVersiones cotizacionId={7} versionActual={2} onCerrar={() => {}} />);
    const items = await screen.findAllByRole('listitem');
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Ver detalle' }));
    const cambios = await screen.findByRole('region', { name: 'Qué cambió respecto de v1' });
    expect(within(cambios).getByText('CAM-1: 2 → 3')).toBeInTheDocument();
    expect(within(cambios).getByText('CAM-1: $100.00 → $95.00')).toBeInTheDocument();
    expect(within(cambios).getByText('Empresa: Sonda → Sonda S.A.')).toBeInTheDocument();
    expect(within(cambios).getByText('Total +$85.00')).toBeInTheDocument();
    expect(cotizacionesAPI.getVersion).toHaveBeenCalledWith(7, 2);
    expect(cotizacionesAPI.getVersion).toHaveBeenCalledWith(7, 1);
    expect(screen.queryByRole('button', { name: /Cargar v/ })).not.toBeInTheDocument();
  });

  test('la v1 se presenta como versión inicial', async () => {
    render(<PanelVersiones cotizacionId={7} versionActual={2} onCerrar={() => {}} />);
    const items = await screen.findAllByRole('listitem');
    fireEvent.click(within(items[1]).getByRole('button', { name: 'Ver detalle' }));
    expect(await screen.findByText('Versión inicial de la cotización.')).toBeInTheDocument();
  });

  test('en el editor permite cargar una versión anterior, no la vigente', async () => {
    const onCargar = vi.fn();
    render(<PanelVersiones cotizacionId={7} versionActual={2} onCerrar={() => {}} onCargar={onCargar} />);
    const items = await screen.findAllByRole('listitem');
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Ver detalle' }));
    await screen.findByRole('region', { name: 'Qué cambió respecto de v1' });
    expect(screen.queryByRole('button', { name: 'Cargar v2 en el editor' })).not.toBeInTheDocument();

    fireEvent.click(within(items[1]).getByRole('button', { name: 'Ver detalle' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar v1 en el editor' }));
    expect(onCargar).toHaveBeenCalledWith(DETALLE[1]);
  });

  test('Escape cierra', async () => {
    const onCerrar = vi.fn();
    render(<PanelVersiones cotizacionId={7} versionActual={2} onCerrar={onCerrar} />);
    await screen.findAllByRole('listitem');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});
