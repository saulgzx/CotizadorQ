import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../ui/toast', () => ({ notify: vi.fn() }));

import CambiosOorDialogo from './CambiosOorDialogo';
import { crearCambios } from './cambiosOor.testdata';
import { notify } from '../ui/toast';

const MENOS = '−';

const montar = (props = {}) => {
  const alertas = { onCerrar: vi.fn(), onMarcarVisto: vi.fn(), onAbrirOrden: vi.fn() };
  const r = render(<CambiosOorDialogo datos={crearCambios()} {...alertas} {...props} />);
  return { ...r, ...alertas };
};

const tarjeta = (bo) => screen.getByRole('region', { name: `BO ${bo}` });

describe('CambiosOorDialogo', () => {
  beforeEach(() => {
    notify.mockReset();
  });

  it('muestra el encabezado y el ejemplo del dueño', () => {
    montar();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cambió el OOR' })).toBeInTheDocument();
    expect(screen.getByText(/Comparado con lo que revisaste el 20-nov-2026/)).toBeInTheDocument();
    const t = tarjeta('4978126');
    expect(within(t).getByRole('heading', { name: 'De enero a junio de 2026' })).toBeInTheDocument();
    const dias = within(t).getAllByText('+146 días');
    expect(dias[0].className).toContain('mq-oor-dias-atraso');
    expect(within(t).getByText(/BO 4978126/)).toBeInTheDocument();
    expect(within(t).getByText(/SICE/)).toBeInTheDocument();
    expect(within(t).getByText(/Túnel Norte/)).toBeInTheDocument();
    expect(within(t).getByText('Llegada estimada: 30-ene-2026 → 25-jun-2026')).toBeInTheDocument();
    expect(within(t).getByText('PO Axis 575740')).toBeInTheDocument();
  });

  it('resalta la facturación afectada y deja normal la que sigue calzando', () => {
    montar();
    const afectada = within(tarjeta('4978126')).getByText(/Facturación configurada: febrero de 2026, semana 2/);
    expect(afectada).toHaveTextContent('queda antes de la nueva llegada: revisa la configuración');
    expect(afectada.className).toContain('mq-oor-facturacion-afectada');

    const normal = within(tarjeta('5000001')).getByText(/Facturación configurada: septiembre de 2026/);
    expect(normal).toHaveTextContent('sigue calzando');
    expect(normal.className).not.toContain('afectada');

    const apagada = within(tarjeta('5000002')).getByText('Sin mes de facturación configurado');
    expect(apagada.className).toContain('apagada');
    expect(within(tarjeta('5000001')).getByText('PO compartida con otra BO')).toBeInTheDocument();
    expect(within(tarjeta('5000001')).getAllByText(`${MENOS}9 días`)[0].className).toContain('mq-oor-dias-adelanto');
  });

  it('muestra los indicadores, con la facturación afectada destacada', () => {
    montar();
    const indicador = (nombre) => screen.getByText(nombre).closest('div');
    expect(indicador('BO con cambios')).toHaveTextContent('3');
    expect(indicador('BO con facturación afectada')).toHaveTextContent('1');
    expect(indicador('BO con facturación afectada').className).toContain('alerta');
    expect(indicador('BO atrasadas').className).not.toContain('alerta');
    expect(screen.getByText('Líneas sin BO')).toBeInTheDocument();
  });

  it('la tabla de líneas muestra cada tipo', () => {
    montar();
    const t1 = within(tarjeta('4978126')).getByRole('table');
    expect(within(t1).getByText('Atraso')).toBeInTheDocument();
    expect(within(t1).getByText('Cambió la cantidad')).toBeInTheDocument();
    expect(within(t1).getByText('10 → 4')).toBeInTheDocument();
    expect(within(t1).getByText('15-ene-2026 → 10-jun-2026')).toBeInTheDocument();
    expect(within(t1).getAllByText('25-jun-2026')).toHaveLength(2);
    expect(within(t1).getByText('02317-004')).toBeInTheDocument();
    expect(within(t1).getByText('AXIS Q6225-LE')).toBeInTheDocument();
    const t2 = within(tarjeta('5000001')).getByRole('table');
    expect(within(t2).getByText('Adelanto')).toBeInTheDocument();
    expect(within(t2).getByText('Línea nueva')).toBeInTheDocument();
    const t3 = within(tarjeta('5000002')).getByRole('table');
    expect(within(t3).getByText('Facturada o cerrada')).toBeInTheDocument();
    expect(within(t3).getByText('Ya no viene en el OOR')).toBeInTheDocument();
  });

  it('muestra los cambios sin BO y los avisos', () => {
    montar();
    const sec = screen.getByRole('region', { name: 'Cambios de PO sin BO asociada' });
    const po = within(sec).getByRole('region', { name: 'PO 999999' });
    expect(within(po).getByText('Midspan')).toBeInTheDocument();
    expect(within(po).getByText('Asocia este PO Axis a su BO en Órdenes para verlo cruzado.')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('3 líneas del OOR traen una fecha que no se pudo leer.');
  });

  it('no muestra la sección sin BO ni avisos si no hay', () => {
    montar({ datos: { ...crearCambios(), sinBo: [], avisos: [] } });
    expect(screen.queryByText('Cambios de PO sin BO asociada')).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('los filtros muestran conteo y acotan las tarjetas', () => {
    montar();
    const grupo = screen.getByRole('group', { name: 'Filtrar cambios' });
    const todo = within(grupo).getByRole('button', { name: 'Todo 3' });
    expect(todo).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('region', { name: /^BO / })).toHaveLength(3);

    fireEvent.click(within(grupo).getByRole('button', { name: 'Facturación afectada 1' }));
    expect(screen.getAllByRole('region', { name: /^BO / })).toHaveLength(1);
    expect(tarjeta('4978126')).toBeInTheDocument();
    expect(within(grupo).getByRole('button', { name: 'Facturación afectada 1' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(grupo).getByRole('button', { name: 'Otros 2' }));
    expect(screen.getAllByRole('region', { name: /^BO / }).map((e) => e.getAttribute('aria-label'))).toEqual(['BO 5000001', 'BO 5000002']);

    fireEvent.click(within(grupo).getByRole('button', { name: 'Atrasos 1' }));
    expect(screen.getAllByRole('region', { name: /^BO / })).toHaveLength(1);
  });

  it('Copiar resumen copia el texto al portapapeles y avisa', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar resumen' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('Cambios del OOR (25-11-2026)');
    expect(writeText.mock.calls[0][0]).toContain('De enero a junio de 2026 (+146 días)');
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/copiado/i), expect.anything()));
  });

  it('avisa si no se puede copiar', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar resumen' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No se pudo copiar el resumen', { tipo: 'error' }));
  });

  it('Marcar como revisado y Más tarde', () => {
    const { onMarcarVisto, onCerrar } = montar();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como revisado' }));
    expect(onMarcarVisto).toHaveBeenCalledTimes(1);
    expect(onCerrar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it('Escape cierra como Más tarde', () => {
    const { onCerrar, onMarcarVisto } = montar();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(onMarcarVisto).not.toHaveBeenCalled();
  });

  it('Marcar como revisado queda deshabilitado mientras se marca', () => {
    montar({ marcando: true });
    expect(screen.getByRole('button', { name: 'Marcar como revisado' })).toBeDisabled();
  });

  it('en solo lectura solo ofrece Copiar resumen y Cerrar', () => {
    const { onCerrar } = montar({ soloLectura: true, datos: { ...crearCambios(), visto_en: '2026-11-26T15:30:00.000Z' } });
    expect(screen.getByText(/Revisado el 26-nov-2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como revisado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Más tarde' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar resumen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onCerrar).toHaveBeenCalled();
  });

  it('Ver en Órdenes llama onAbrirOrden con la BO y no aparece sin la prop', () => {
    const { onAbrirOrden, unmount } = montar();
    fireEvent.click(within(tarjeta('5000001')).getByRole('button', { name: 'Ver en Órdenes' }));
    expect(onAbrirOrden).toHaveBeenCalledWith('5000001');
    unmount();
    montar({ onAbrirOrden: undefined });
    expect(screen.queryByRole('button', { name: 'Ver en Órdenes' })).not.toBeInTheDocument();
  });

  it('no revienta con datos incompletos', () => {
    render(<CambiosOorDialogo datos={{ hay: true, grupos: [{ bo: '1' }] }} onCerrar={() => {}} />);
    expect(screen.getByRole('region', { name: 'BO 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sin fecha de entrega' })).toBeInTheDocument();
  });
});
