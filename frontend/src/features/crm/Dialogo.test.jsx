import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Dialogo from './Dialogo';

describe('Dialogo: teclado', () => {
  test('Escape cierra aunque el foco haya caído fuera del diálogo', () => {
    // Pasa cuando el elemento enfocado desaparece: p. ej. el botón "Guardar" de una sección
    // que se oculta tras guardar. El foco cae en <body> y el diálogo debe seguir cerrándose.
    function Caso({ onCerrar }) {
      const [conBoton, setConBoton] = useState(true);
      return (
        <Dialogo titulo='Detalle' onCerrar={onCerrar}>
          {conBoton && <button type='button' onClick={() => setConBoton(false)}>Guardar</button>}
          <p>Contenido</p>
        </Dialogo>
      );
    }
    const onCerrar = vi.fn();
    render(<Caso onCerrar={onCerrar} />);
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    guardar.focus();
    fireEvent.click(guardar);
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  test('con dos diálogos abiertos, Escape cierra solo el de más arriba', () => {
    const cerrarBase = vi.fn();
    const cerrarEncima = vi.fn();
    function Caso() {
      const [encima, setEncima] = useState(true);
      return (
        <>
          <Dialogo titulo='Base' onCerrar={cerrarBase}><button type='button'>Uno</button></Dialogo>
          {encima && (
            <Dialogo titulo='Encima' onCerrar={() => { cerrarEncima(); setEncima(false); }}>
              <button type='button'>Dos</button>
            </Dialogo>
          )}
        </>
      );
    }
    render(<Caso />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(cerrarEncima).toHaveBeenCalledTimes(1);
    expect(cerrarBase).not.toHaveBeenCalled();
    // Cerrado el de encima, el teclado vuelve al de la base.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(cerrarBase).toHaveBeenCalledTimes(1);
    expect(cerrarEncima).toHaveBeenCalledTimes(1);
  });

  test('Escape no llega a los atajos globales de la página', () => {
    const global = vi.fn();
    window.addEventListener('keydown', global);
    render(<Dialogo titulo='Detalle' onCerrar={() => {}}><button type='button'>Ok</button></Dialogo>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Ok' }), { key: 'Escape' });
    expect(global).not.toHaveBeenCalled();
    window.removeEventListener('keydown', global);
  });

  test('Tab con el foco fuera lo devuelve al primer control del diálogo, y da la vuelta al final', () => {
    render(
      <Dialogo titulo='Detalle' onCerrar={() => {}}>
        <button type='button'>Primero</button>
        <button type='button'>Último</button>
      </Dialogo>
    );
    const controles = screen.getAllByRole('button');
    document.activeElement.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(document.activeElement).toBe(controles[0]);
    controles.at(-1).focus();
    fireEvent.keyDown(controles.at(-1), { key: 'Tab' });
    expect(document.activeElement).toBe(controles[0]);
    fireEvent.keyDown(controles[0], { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(controles.at(-1));
  });

  test('al desmontarse deja de escuchar el teclado', () => {
    const onCerrar = vi.fn();
    const { unmount } = render(<Dialogo titulo='Detalle' onCerrar={onCerrar}><button type='button'>Ok</button></Dialogo>);
    unmount();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCerrar).not.toHaveBeenCalled();
  });
});
