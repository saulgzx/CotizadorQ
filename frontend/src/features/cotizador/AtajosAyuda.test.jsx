import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import AtajosAyuda, { ATAJOS } from './AtajosAyuda';

describe('AtajosAyuda', () => {
  test('cerrado no renderiza nada', () => {
    const { container } = render(<AtajosAyuda abierto={false} onCerrar={() => {}} esAdmin />);
    expect(container).toBeEmptyDOMElement();
  });

  test('abierto muestra el dialogo con titulo y los grupos de atajos', () => {
    render(<AtajosAyuda abierto onCerrar={() => {}} esAdmin />);
    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Atajos de teclado' })).toBeInTheDocument();
    expect(screen.getByText('En toda la app')).toBeInTheDocument();
    expect(screen.getByText('Cotizador')).toBeInTheDocument();
    expect(screen.getByText('Historial')).toBeInTheDocument();
    expect(screen.getByText('Buscar vistas y productos')).toBeInTheDocument();
  });

  test('cierra con Escape y evita la accion por defecto', () => {
    const onCerrar = vi.fn();
    render(<AtajosAyuda abierto onCerrar={onCerrar} esAdmin />);
    const noCancelado = fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(noCancelado).toBe(false); // preventDefault fue llamado
  });

  test('"?" tambien cierra (alterna la ayuda)', () => {
    const onCerrar = vi.fn();
    render(<AtajosAyuda abierto onCerrar={onCerrar} esAdmin />);
    fireEvent.keyDown(window, { key: '?' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  test('otras teclas no cierran', () => {
    const onCerrar = vi.fn();
    render(<AtajosAyuda abierto onCerrar={onCerrar} esAdmin />);
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCerrar).not.toHaveBeenCalled();
  });

  test('cierra con el boton de cerrar y al hacer clic en el fondo, pero no al hacer clic dentro del dialogo', () => {
    const onCerrar = vi.fn();
    const { container } = render(<AtajosAyuda abierto onCerrar={onCerrar} esAdmin />);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onCerrar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar ayuda' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstChild);
    expect(onCerrar).toHaveBeenCalledTimes(2);
  });

  test('al cerrarse deja de escuchar el teclado', () => {
    const onCerrar = vi.fn();
    const { rerender } = render(<AtajosAyuda abierto onCerrar={onCerrar} esAdmin />);
    rerender(<AtajosAyuda abierto={false} onCerrar={onCerrar} esAdmin />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCerrar).not.toHaveBeenCalled();
  });

  test('al desmontar quita el listener', () => {
    const onCerrar = vi.fn();
    const { unmount } = render(<AtajosAyuda abierto onCerrar={onCerrar} esAdmin />);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCerrar).not.toHaveBeenCalled();
  });

  test('esAdmin=false oculta el grupo "Editor de cotización"', () => {
    render(<AtajosAyuda abierto onCerrar={() => {}} esAdmin={false} />);
    expect(screen.queryByText('Editor de cotización')).not.toBeInTheDocument();
    expect(screen.queryByText('Guardar cambios')).not.toBeInTheDocument();
    expect(screen.queryByText('Cerrar el editor')).not.toBeInTheDocument();
    expect(screen.getByText('Cotizador')).toBeInTheDocument();
  });

  test('esAdmin=true muestra el grupo "Editor de cotización"', () => {
    render(<AtajosAyuda abierto onCerrar={() => {}} esAdmin />);
    expect(screen.getByText('Editor de cotización')).toBeInTheDocument();
    expect(screen.getByText('Guardar cambios')).toBeInTheDocument();
    expect(screen.getByText('Cerrar el editor')).toBeInTheDocument();
  });

  test('esAdmin ausente se trata como no admin', () => {
    render(<AtajosAyuda abierto onCerrar={() => {}} />);
    expect(screen.queryByText('Editor de cotización')).not.toBeInTheDocument();
  });

  test('cada atajo visible muestra su texto y sus teclas', () => {
    render(<AtajosAyuda abierto onCerrar={() => {}} esAdmin />);
    for (const a of ATAJOS) {
      expect(screen.getByText(a.texto)).toBeInTheDocument();
    }
    // Combinacion Ctrl + K: ambas teclas como <kbd>
    const ctrlKs = screen.getAllByText('Ctrl');
    expect(ctrlKs.length).toBeGreaterThan(0);
    expect(ctrlKs[0].tagName).toBe('KBD');
    expect(screen.getByText('K').tagName).toBe('KBD');
  });
});
