import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AsistenteIAView from './AsistenteIAView';

describe('AsistenteIAView', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  test('abre la IA con el prompt y carga la respuesta al cotizador', () => {
    const onCargarLista = vi.fn();
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue() }
    });
    render(<AsistenteIAView usuario="alexis" onCargarLista={onCargarLista} />);

    fireEvent.change(screen.getByPlaceholderText(/Pega el correo/), {
      target: { value: 'Cotizar 2 P1475-LE' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Abrir en Claude/ }));
    const url = new URL(abrir.mock.calls[0][0]);
    expect(url.origin).toBe('https://claude.ai');
    expect(url.searchParams.get('q')).toContain('preventa-axis');

    fireEvent.change(screen.getByPlaceholderText(/Pega aquí la respuesta/), {
      target: { value: 'LISTA COTIZADORQ\n```\n100010879\t2\n```' }
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Cargar al cotizador/ })
    );
    expect(onCargarLista).toHaveBeenCalledWith('100010879\t2');
    abrir.mockRestore();
  });
});
