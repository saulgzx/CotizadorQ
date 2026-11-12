import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PantallazoMontos from './PantallazoMontos';

const png = (nombre = 'oc.png') => new File(['datos'], nombre, { type: 'image/png' });
const zona = () => screen.getByRole('button', { name: /Cargar pantallazo/ });
const input = () => screen.getByLabelText(/elegir archivo/);
const subir = (file) => fireEvent.change(input(), { target: { files: [file] } });

// Promesa que se resuelve o rechaza a mano, para observar el estado "leyendo".
const diferida = () => {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => { resolver = res; rechazar = rej; });
  return { promesa, resolver, rechazar };
};

describe('PantallazoMontos', () => {
  beforeEach(() => {
    // jsdom no trae object URLs.
    URL.createObjectURL = vi.fn(() => 'blob:miniatura');
    URL.revokeObjectURL = vi.fn();
  });

  test('renderiza el estado vacío con la instrucción según el campo', () => {
    const { rerender } = render(<PantallazoMontos campo='intcomex' onLeer={vi.fn()} onListo={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cargar pantallazo para Monto Intcomex' })).toBeInTheDocument();
    expect(screen.getByText(/OC del cliente/)).toBeInTheDocument();
    expect(screen.getByText(/Ctrl\+V/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();

    rerender(<PantallazoMontos campo='axis' onLeer={vi.fn()} onListo={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cargar pantallazo para Monto Axis' })).toBeInTheDocument();
    expect(screen.getByText(/planilla de costos de Axis/)).toBeInTheDocument();
  });

  test('subir un archivo por el input llama a onLeer con el File y luego a onListo con su resultado', async () => {
    const resultado = { lineas: [{ sku: 'A1', monto: 100 }] };
    const onLeer = vi.fn().mockResolvedValue(resultado);
    const onListo = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={onListo} />);

    const file = png();
    subir(file);

    await waitFor(() => expect(onListo).toHaveBeenCalledWith(resultado));
    expect(onLeer).toHaveBeenCalledTimes(1);
    expect(onLeer).toHaveBeenCalledWith(file);
    expect(screen.getByText('oc.png')).toBeInTheDocument();
    expect(screen.getByAltText('Miniatura del pantallazo')).toHaveAttribute('src', 'blob:miniatura');
    expect(screen.getByRole('status')).toHaveTextContent(/Pantallazo leído/);
  });

  test('pegar una imagen desde el portapapeles la lee', async () => {
    const onLeer = vi.fn().mockResolvedValue('ok');
    const onListo = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={onListo} />);

    const file = png('image.png');
    fireEvent.paste(zona(), { clipboardData: { files: [file] } });

    await waitFor(() => expect(onListo).toHaveBeenCalledWith('ok'));
    expect(onLeer).toHaveBeenCalledWith(file);
  });

  test('pegar texto no hace nada', () => {
    const onLeer = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={vi.fn()} />);
    fireEvent.paste(zona(), { clipboardData: { files: [], items: [{ kind: 'string' }] } });
    expect(onLeer).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('soltar una imagen arrastrada la lee', async () => {
    const onLeer = vi.fn().mockResolvedValue('ok');
    const onListo = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={onListo} />);

    const file = png();
    fireEvent.drop(zona(), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onListo).toHaveBeenCalledWith('ok'));
    expect(onLeer).toHaveBeenCalledWith(file);
  });

  test('un archivo que no es imagen muestra el error y no llama a onLeer', () => {
    const onLeer = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={vi.fn()} />);

    subir(new File(['%PDF'], 'oc.pdf', { type: 'application/pdf' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Solo se aceptan imágenes PNG, JPG o WEBP');
    expect(onLeer).not.toHaveBeenCalled();
  });

  test('un archivo de más de 10 MB muestra el error con su tamaño', () => {
    const onLeer = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={vi.fn()} />);

    const grande = png('grande.png');
    Object.defineProperty(grande, 'size', { value: 12.5 * 1024 * 1024 });
    subir(grande);

    expect(screen.getByRole('alert')).toHaveTextContent('La imagen pesa 12.5 MB y el máximo es 10 MB');
    expect(onLeer).not.toHaveBeenCalled();
  });

  test('mientras lee queda deshabilitado y no acepta otra imagen', async () => {
    const lectura = diferida();
    const onLeer = vi.fn().mockReturnValue(lectura.promesa);
    const onListo = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={onListo} />);

    subir(png());

    expect(await screen.findByText('Leyendo el pantallazo…')).toBeInTheDocument();
    expect(zona()).toHaveAttribute('aria-disabled', 'true');
    expect(input()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeDisabled();

    fireEvent.paste(zona(), { clipboardData: { files: [png('otra.png')] } });
    expect(onLeer).toHaveBeenCalledTimes(1);

    lectura.resolver('ok');
    await waitFor(() => expect(onListo).toHaveBeenCalledWith('ok'));
    expect(zona()).toHaveAttribute('aria-disabled', 'false');
    expect(input()).not.toBeDisabled();
  });

  test('si onLeer rechaza se muestra el error y se puede reintentar sin volver a cargar', async () => {
    const onLeer = vi.fn()
      .mockRejectedValueOnce(new Error('No se pudo leer la imagen'))
      .mockResolvedValueOnce('ok');
    const onListo = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={onListo} />);

    const file = png();
    subir(file);

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer la imagen');
    expect(onListo).not.toHaveBeenCalled();
    expect(screen.getByText('oc.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => expect(onListo).toHaveBeenCalledWith('ok'));
    expect(onLeer).toHaveBeenCalledTimes(2);
    expect(onLeer).toHaveBeenLastCalledWith(file);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  test('quitar la imagen vuelve al estado vacío y libera la miniatura', async () => {
    const onLeer = vi.fn().mockResolvedValue('ok');
    const onListo = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={onListo} />);
    subir(png());
    await waitFor(() => expect(onListo).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:miniatura');
    expect(screen.queryByText('oc.png')).not.toBeInTheDocument();
    expect(screen.getByText(/OC del cliente/)).toBeInTheDocument();
  });

  test('al desmontar libera la miniatura', async () => {
    const onListo = vi.fn();
    const { unmount } = render(<PantallazoMontos onLeer={vi.fn().mockResolvedValue('ok')} onListo={onListo} />);
    subir(png());
    await waitFor(() => expect(onListo).toHaveBeenCalled());
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:miniatura');
  });

  test('Enter y Espacio abren el selector de archivos', () => {
    render(<PantallazoMontos onLeer={vi.fn()} onListo={vi.fn()} />);
    const clic = vi.spyOn(input(), 'click');
    fireEvent.keyDown(zona(), { key: 'Enter' });
    fireEvent.keyDown(zona(), { key: ' ' });
    expect(clic).toHaveBeenCalledTimes(2);
  });

  test('con deshabilitado no acepta imágenes', () => {
    const onLeer = vi.fn();
    render(<PantallazoMontos onLeer={onLeer} onListo={vi.fn()} deshabilitado />);
    expect(zona()).toHaveAttribute('aria-disabled', 'true');
    expect(input()).toBeDisabled();
    fireEvent.paste(zona(), { clipboardData: { files: [png()] } });
    expect(onLeer).not.toHaveBeenCalled();
  });
});
