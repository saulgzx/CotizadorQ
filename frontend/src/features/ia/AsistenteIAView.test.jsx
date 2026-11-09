import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AsistenteIAView from './AsistenteIAView';
import { iaAPI } from '../../api';

vi.mock('../../api', () => ({
  iaAPI: {
    estado: vi.fn(),
    iniciar: vi.fn(),
    obtener: vi.fn(),
    cancelar: vi.fn()
  }
}));

const RESPUESTA =
  'Andrea.\n\n| Marca | Cant. | SKU |\n|---|---|---|\n| Axis | 2 | 100010879 |\n\nLISTA COTIZADORQ\n```\n100010879\t2\n```';

describe('AsistenteIAView', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    iaAPI.estado.mockResolvedValue({ habilitado: true, faltantes: [] });
  });
  afterEach(() => vi.useRealTimers());

  test('consulta en el backend, muestra la respuesta y la carga al cotizador', async () => {
    iaAPI.iniciar.mockResolvedValue({ id: 'c1', estado: 'en_curso' });
    iaAPI.obtener.mockResolvedValue({
      id: 'c1',
      estado: 'lista',
      contenido: [{ type: 'text', text: RESPUESTA }]
    });
    const onCargarLista = vi.fn();
    render(<AsistenteIAView usuario="alexis" onCargarLista={onCargarLista} />);

    fireEvent.change(screen.getByPlaceholderText(/Pega el correo/), {
      target: { value: 'Cotizar 2 P1475-LE' }
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Consultar a la IA/ })
      );
    });
    expect(iaAPI.iniciar).toHaveBeenCalledWith({
      marca: 'AXIS',
      mensajes: [
        { role: 'user', content: 'Requerimiento:\nCotizar 2 P1475-LE' }
      ]
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(
      screen.getByText('100010879', { selector: 'td' })
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /Cargar al cotizador/ })
    );
    expect(onCargarLista).toHaveBeenCalledWith('100010879\t2');
  });

  test('avisa cuando el servidor no esta configurado', async () => {
    iaAPI.estado.mockResolvedValue({
      habilitado: false,
      faltantes: ['ANTHROPIC_API_KEY']
    });
    await act(async () => {
      render(<AsistenteIAView usuario="alexis" onCargarLista={() => {}} />);
    });
    expect(screen.getByText(/Falta: ANTHROPIC_API_KEY/)).toBeInTheDocument();
  });
});
