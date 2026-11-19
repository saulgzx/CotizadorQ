import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import OportunidadesTab from './OportunidadesTab';
import { crmApi } from './crmApi';
import { ARBOL, renderConQuery } from './fixturesCrm';

vi.mock('./crmApi', () => ({ crmApi: { arbol: vi.fn(), actualizarOportunidad: vi.fn() } }));
vi.mock('../ui/toast', () => ({ notify: vi.fn() }));
// El mapa lo prueba su propio archivo: aquí basta un doble con lo que el contenedor le pasa.
vi.mock('./MapaTab', async () => {
  const React = (await import('react')).default;
  return {
    default: ({ inputBusquedaRef, onAbrirOportunidad }) => (
      <div data-testid='mapa'>
        <input type='search' aria-label='Buscar en el mapa' ref={inputBusquedaRef} />
        <button type='button' onClick={() => onAbrirOportunidad(2)}>Tarjeta Cámaras bodega</button>
        <button type='button' onClick={() => onAbrirOportunidad(1)}>Tarjeta NAS</button>
      </div>
    )
  };
});

const copia = () => JSON.parse(JSON.stringify(ARBOL));
const montar = (props = {}) => {
  // El "servidor" aplica los cambios, así lo que se vuelve a pedir tras guardar es coherente.
  const datos = copia();
  crmApi.arbol.mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(datos))));
  crmApi.actualizarOportunidad.mockImplementation(async (id, cambios) => {
    const o = datos.oportunidades.find((x) => x.id === id);
    Object.assign(o, cambios);
    return o;
  });
  const callbacks = { onAbrirEmpresa: vi.fn(), onAbrirCotizacion: vi.fn() };
  const r = renderConQuery(<OportunidadesTab {...callbacks} {...props} />);
  return { ...r, ...callbacks };
};
const elegirVista = (nombre) =>
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Vista' })).getByRole('radio', { name: nombre }));

describe('OportunidadesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  test('abre en el Mapa, con el conmutador Mapa | Tabla', () => {
    montar();
    const vista = screen.getByRole('radiogroup', { name: 'Vista' });
    expect(within(vista).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Mapa', 'Tabla']);
    expect(within(vista).getByRole('radio', { name: 'Mapa' })).toHaveAttribute('aria-checked', 'true');
    expect(within(vista).getByRole('radio', { name: 'Tabla' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('mapa')).toBeInTheDocument();
    expect(screen.queryByRole('treegrid')).not.toBeInTheDocument();
  });

  test('cambia a Tabla y solo monta la vista activa', async () => {
    montar();
    elegirVista('Tabla');
    expect(await screen.findByRole('treegrid', { name: 'Árbol del CRM' })).toBeInTheDocument();
    expect(screen.queryByTestId('mapa')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Tabla' })).toHaveAttribute('aria-checked', 'true');
    elegirVista('Mapa');
    expect(screen.getByTestId('mapa')).toBeInTheDocument();
    expect(screen.queryByRole('treegrid')).not.toBeInTheDocument();
  });

  test('recuerda la vista elegida al volver a montar', async () => {
    const primera = montar();
    elegirVista('Tabla');
    await screen.findByRole('treegrid');
    expect(JSON.parse(window.localStorage.getItem('crmOportunidades'))).toEqual({ vista: 'tabla' });
    primera.unmount();
    montar();
    expect(await screen.findByRole('treegrid', { name: 'Árbol del CRM' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Tabla' })).toHaveAttribute('aria-checked', 'true');
  });

  test.each([
    ['basura no JSON', 'no es json'],
    ['vista desconocida', JSON.stringify({ vista: 'galaxia' })],
    ['valor que no es objeto', '42']
  ])('una preferencia guardada inválida (%s) cae en el Mapa', (_nombre, crudo) => {
    window.localStorage.setItem('crmOportunidades', crudo);
    montar();
    expect(screen.getByTestId('mapa')).toBeInTheDocument();
  });

  test('si localStorage falla, funciona igual con el Mapa por defecto', async () => {
    const leer = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    const escribir = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    try {
      montar();
      expect(screen.getByTestId('mapa')).toBeInTheDocument();
      elegirVista('Tabla');
      expect(await screen.findByRole('treegrid')).toBeInTheDocument();
    } finally {
      leer.mockRestore();
      escribir.mockRestore();
    }
  });

  test('las flechas del conmutador cambian de vista', async () => {
    montar();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Mapa' }), { key: 'ArrowRight' });
    expect(await screen.findByRole('treegrid')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Tabla' })));
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Tabla' }), { key: 'ArrowLeft' });
    expect(screen.getByTestId('mapa')).toBeInTheDocument();
  });

  test('el buscador de la vista activa recibe el inputBusquedaRef', async () => {
    const ref = React.createRef();
    montar({ inputBusquedaRef: ref });
    expect(ref.current).toBe(screen.getByLabelText('Buscar en el mapa'));
    elegirVista('Tabla');
    await screen.findByRole('treegrid');
    expect(ref.current).toBe(screen.getByLabelText('Buscar en el árbol'));
  });

  test('abre el panel desde una tarjeta del mapa y lo cierra', async () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Tarjeta Cámaras bodega' }));
    const panel = await screen.findByRole('dialog', { name: 'Cámaras bodega' });
    expect(within(panel).getByText('Nota: Llamar a Ana por el descuento')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Cerrar diálogo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Escape también cierra.
    fireEvent.click(screen.getByRole('button', { name: 'Tarjeta Cámaras bodega' }));
    fireEvent.keyDown(await screen.findByRole('dialog', { name: 'Cámaras bodega' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('abre el panel desde la columna Seguimiento y desde el título en la tabla', async () => {
    montar();
    elegirVista('Tabla');
    await screen.findByRole('treegrid');
    fireEvent.click(await screen.findByText('Acme SA'));
    const porSeguimiento = await screen.findByRole('button', { name: /^Seguimiento de Cámaras bodega: / });
    fireEvent.click(porSeguimiento);
    expect(await screen.findByRole('dialog', { name: 'Cámaras bodega' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar diálogo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'NAS sucursal Norte' }));
    expect(await screen.findByRole('dialog', { name: 'NAS sucursal Norte' })).toBeInTheDocument();
  });

  test('el panel sigue abierto tras guardar el seguimiento y la tabla se actualiza', async () => {
    montar();
    elegirVista('Tabla');
    await screen.findByRole('treegrid');
    fireEvent.click(await screen.findByText('Acme SA'));
    fireEvent.click(await screen.findByRole('button', { name: 'Seguimiento de NAS sucursal Norte: Sin seguimiento' }));
    const panel = await screen.findByRole('dialog', { name: 'NAS sucursal Norte' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Mañana' }));
    fireEvent.change(within(panel).getByLabelText('Nota del seguimiento'), { target: { value: 'Enviar propuesta' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar seguimiento' }));
    await waitFor(() =>
      expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, {
        proximo_seguimiento: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        seguimiento_nota: 'Enviar propuesta'
      })
    );
    expect(await within(panel).findByText('Nota: Enviar propuesta')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'NAS sucursal Norte' })).toBeInTheDocument();
    // La fila de la tabla, detrás del panel, ya no dice "Sin seguimiento".
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Seguimiento de NAS sucursal Norte: Sin seguimiento', hidden: true })).not.toBeInTheDocument()
    );
  });

  test('abrir la empresa desde el panel llama al callback y cierra el panel', async () => {
    const { onAbrirEmpresa } = montar();
    fireEvent.click(screen.getByRole('button', { name: 'Tarjeta NAS' }));
    const panel = await screen.findByRole('dialog', { name: 'NAS sucursal Norte' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Acme SA' }));
    expect(onAbrirEmpresa).toHaveBeenCalledWith(10);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
