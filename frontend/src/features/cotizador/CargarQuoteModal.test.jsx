import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CargarQuoteModal, { textoNumero } from './CargarQuoteModal';

const png = (nombre = 'quote.png') => new File(['datos'], nombre, { type: 'image/png' });
const pdf = (nombre = 'quote.pdf') => new File(['%PDF'], nombre, { type: 'application/pdf' });
const conPeso = (file, mb) => {
  Object.defineProperty(file, 'size', { value: mb * 1024 * 1024 });
  return file;
};

const linea = (extra = {}) => ({
  mpn: 'ABC-1',
  descripcion: 'Equipo de prueba',
  cantidad: 2,
  costoUnitario: 100,
  totalLinea: null,
  tipo: null,
  problemas: [],
  ...extra
});
const resultado = (lineas, avisos = []) => ({ lineas, moneda: 'USD', descuentoGlobalPct: null, notas: '', avisos });

const diferida = () => {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => { resolver = res; rechazar = rej; });
  return { promesa, resolver, rechazar };
};

const montar = (props = {}) => {
  const onCerrar = vi.fn();
  const onAgregar = vi.fn();
  const leer = props.leer ?? vi.fn().mockResolvedValue(resultado([linea()]));
  const utilidades = render(
    <CargarQuoteModal abierto onCerrar={onCerrar} onAgregar={onAgregar} leer={leer} {...props} />
  );
  return { onCerrar, onAgregar, leer, ...utilidades };
};

const elegirFab = (nombre) => fireEvent.click(screen.getByRole('radio', { name: nombre }));
const subir = (file) => fireEvent.change(screen.getByLabelText('Elegir archivo del quote'), { target: { files: [file] } });
const campo = (nombre, n = 1) => screen.getByLabelText(`${nombre} línea ${n}`);
const escribir = (el, valor) => fireEvent.change(el, { target: { value: valor } });
const agregarBtn = () => screen.getByRole('button', { name: /^Agregar \d+ al carrito$/ });

describe('CargarQuoteModal', () => {
  test('cerrado no renderiza nada', () => {
    const { container } = render(<CargarQuoteModal abierto={false} onCerrar={vi.fn()} onAgregar={vi.fn()} leer={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('abierto: diálogo accesible y ningún fabricante elegido', () => {
    montar();
    const dialogo = screen.getByRole('dialog', { name: 'Cargar quote de fabricante' });
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    const radios = within(screen.getByRole('radiogroup')).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['ISS', 'Neural Labs', 'Milestone', 'Velasea']);
    radios.forEach((r) => expect(r).toHaveAttribute('aria-checked', 'false'));
    expect(agregarBtn()).toBeDisabled();
  });

  test('muestra el recargo según el fabricante', () => {
    montar();
    elegirFab('ISS');
    expect(screen.getByText('Transporte y arancel 15 %')).toBeInTheDocument();
    elegirFab('Neural Labs');
    expect(screen.getByText('Transporte y arancel 15 %')).toBeInTheDocument();
    elegirFab('Milestone');
    expect(screen.getByText('Licencias 0 % · Servidores 12 %')).toBeInTheDocument();
    elegirFab('Velasea');
    expect(screen.getByText('Flete de entrada 1,1 % · Transporte y arancel 12 % · sin IC')).toBeInTheDocument();
  });

  test('Velasea: costo como QNAP sin IC y precio de referencia con el margen de QNAP', async () => {
    const { onAgregar } = montar();
    elegirFab('Velasea');
    subir(pdf());
    await screen.findByLabelText('MPN línea 1');
    // costo 100 -> 100 x 1,011 x 1,12 = 113,23 -> 113,23 / 0,85 = 133,21 (15 %, no 8 %)
    expect(screen.getByText('113,23')).toBeInTheDocument();
    expect(screen.getByText('133,21')).toBeInTheDocument();
    expect(screen.getByText('Precio cliente 15 %')).toBeInTheDocument();
    expect(screen.getByText(/Venta total al 15 %/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Tipo línea 1')).not.toBeInTheDocument();
    fireEvent.click(agregarBtn());
    expect(onAgregar.mock.calls[0][0][0]).toMatchObject({ origen: 'VELASEA', marca: 'Velasea', precio: 100, costoChile: 113.23, sku: 'To Create' });
  });

  test('Velasea: el precio de referencia sigue al margen global de QNAP que venga de la página', async () => {
    montar({ gpQnap: 0.2 });
    elegirFab('Velasea');
    subir(pdf());
    await screen.findByLabelText('MPN línea 1');
    expect(screen.getByText('Precio cliente 20 %')).toBeInTheDocument();
    expect(screen.getByText('141,54')).toBeInTheDocument(); // 113,23 / 0,80
    // Los demás fabricantes no dependen de ese margen: siguen al 8 %.
    elegirFab('ISS');
    expect(screen.getByText('Precio cliente 8 %')).toBeInTheDocument();
    expect(screen.getByText('125,00')).toBeInTheDocument();
  });

  test('sin fabricante no se lee el archivo y se pide elegirlo', () => {
    const { leer } = montar();
    subir(png());
    expect(leer).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Elige primero el fabricante/);
  });

  test('archivo de tipo inválido muestra error y no llama a leer', () => {
    const { leer } = montar();
    elegirFab('ISS');
    subir(new File(['x'], 'quote.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Solo se aceptan PDF o imágenes/);
    expect(leer).not.toHaveBeenCalled();
  });

  test('archivo demasiado grande muestra error y no llama a leer', () => {
    const { leer } = montar();
    elegirFab('ISS');
    subir(conPeso(pdf(), 13));
    expect(screen.getByRole('alert')).toHaveTextContent(/El PDF pesa 13\.0 MB y el máximo es 12\.0 MB/);
    subir(conPeso(png(), 7));
    expect(screen.getByRole('alert')).toHaveTextContent(/La imagen pesa 7\.0 MB y el máximo es 6\.0 MB/);
    expect(leer).not.toHaveBeenCalled();
  });

  test('lectura feliz ISS: costo Chile, precio cliente, totales y producto entregado', async () => {
    const { leer, onAgregar, onCerrar } = montar();
    elegirFab('ISS');
    const file = pdf();
    subir(file);
    await screen.findByLabelText('MPN línea 1');
    expect(leer).toHaveBeenCalledWith({ file, fabricante: 'ISS' });
    expect(campo('MPN')).toHaveValue('ABC-1');
    expect(campo('Cantidad')).toHaveValue(2);
    expect(screen.getByText('115,00')).toBeInTheDocument();
    expect(screen.getByText('125,00')).toBeInTheDocument();
    expect(screen.getByText('2 líneas'.replace('2 líneas', '1 línea'))).toBeInTheDocument();
    expect(screen.getByText('US$ 200,00')).toBeInTheDocument();
    expect(screen.getByText('US$ 230,00')).toBeInTheDocument();
    expect(screen.getByText('US$ 250,00')).toBeInTheDocument();

    fireEvent.click(agregarBtn());
    expect(onAgregar).toHaveBeenCalledTimes(1);
    const [productos] = onAgregar.mock.calls[0];
    expect(productos).toHaveLength(1);
    expect(productos[0]).toMatchObject({
      origen: 'ISS',
      costoChile: 115,
      precio: 100,
      cantidadSugerida: 2,
      mpn: 'ABC-1'
    });
    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(onAgregar.mock.invocationCallOrder[0]).toBeLessThan(onCerrar.mock.invocationCallOrder[0]);
  });

  test('muestra "Leyendo el quote…" mientras espera', async () => {
    const d = diferida();
    montar({ leer: vi.fn(() => d.promesa) });
    elegirFab('ISS');
    subir(png());
    expect(await screen.findByRole('status')).toHaveTextContent('Leyendo el quote… puede tardar hasta un minuto');
    d.resolver(resultado([linea()]));
    await screen.findByLabelText('MPN línea 1');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('Milestone licencia vs servidor: 100 -> 100 y 112; el servidor sale como MILESTONE_HW', async () => {
    const lineas = [
      linea({ mpn: 'XPCO-L', descripcion: 'XProtect Corporate Base License', cantidad: 1, tipo: 'licencia' }),
      linea({ mpn: 'HUSKY-1', descripcion: 'Husky X2 appliance', cantidad: 1, tipo: 'servidor' })
    ];
    const { onAgregar } = montar({ leer: vi.fn().mockResolvedValue(resultado(lineas)) });
    elegirFab('Milestone');
    subir(png());
    await screen.findByLabelText('MPN línea 2');
    expect(campo('Tipo', 1)).toHaveValue('licencia');
    expect(campo('Tipo', 2)).toHaveValue('servidor');
    const fila1 = campo('MPN', 1).closest('tr');
    const fila2 = campo('MPN', 2).closest('tr');
    expect(within(fila1).getByText('100,00', { selector: 'td' })).toBeInTheDocument();
    expect(within(fila2).getByText('112,00', { selector: 'td' })).toBeInTheDocument();

    fireEvent.click(agregarBtn());
    const [productos] = onAgregar.mock.calls[0];
    expect(productos.map((p) => [p.origen, p.costoChile])).toEqual([
      ['MILESTONE', 100],
      ['MILESTONE_HW', 112]
    ]);
  });

  test('cambiar el tipo de Milestone recalcula el costo Chile', async () => {
    montar({ leer: vi.fn().mockResolvedValue(resultado([linea({ mpn: 'X', descripcion: 'Care Plus license', cantidad: 1, tipo: 'licencia' })])) });
    elegirFab('Milestone');
    subir(png());
    await screen.findByLabelText('MPN línea 1');
    escribir(campo('Tipo'), 'servidor');
    expect(screen.getByText('112,00', { selector: 'td' })).toBeInTheDocument();
  });

  test('línea sin costo: no se puede incluir hasta escribir el costo', async () => {
    const { onAgregar } = montar({
      leer: vi.fn().mockResolvedValue(
        resultado([linea({ costoUnitario: null, problemas: ['sin-costo', 'total-no-cuadra'] })])
      )
    });
    elegirFab('ISS');
    subir(png());
    await screen.findByLabelText('MPN línea 1');
    const casilla = screen.getByLabelText('Incluir línea 1');
    expect(casilla).toBeDisabled();
    expect(casilla).not.toBeChecked();
    expect(screen.getByText('sin costo')).toBeInTheDocument();
    expect(screen.getByText('el total no cuadra')).toBeInTheDocument();
    expect(agregarBtn()).toBeDisabled();

    escribir(campo('Mi costo USD'), '80,5');
    expect(screen.queryByText('sin costo')).not.toBeInTheDocument();
    // El problema que venía del lector se mantiene.
    expect(screen.getByText('el total no cuadra')).toBeInTheDocument();
    expect(casilla).toBeEnabled();
    expect(casilla).not.toBeChecked(); // la persona decide
    fireEvent.click(casilla);
    expect(agregarBtn()).toBeEnabled();
    fireEvent.click(agregarBtn());
    expect(onAgregar.mock.calls[0][0][0]).toMatchObject({ precio: 80.5, costoChile: 92.58 });
  });

  test('cantidad inválida: etiqueta "sin cantidad" y casilla deshabilitada, se recalcula al corregir', async () => {
    montar({ leer: vi.fn().mockResolvedValue(resultado([linea({ cantidad: null, problemas: ['sin-cantidad'] })])) });
    elegirFab('ISS');
    subir(png());
    await screen.findByLabelText('MPN línea 1');
    expect(screen.getByText('sin cantidad')).toBeInTheDocument();
    expect(screen.getByLabelText('Incluir línea 1')).toBeDisabled();
    escribir(campo('Cantidad'), '3');
    expect(screen.queryByText('sin cantidad')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Incluir línea 1')).toBeEnabled();
    escribir(campo('Cantidad'), '1,5');
    expect(screen.getByText('sin cantidad')).toBeInTheDocument();
  });

  test('editar cantidad y costo cambia los totales y lo que se entrega', async () => {
    const { onAgregar } = montar();
    elegirFab('ISS');
    subir(png());
    await screen.findByLabelText('MPN línea 1');
    escribir(campo('Cantidad'), '5');
    escribir(campo('Mi costo USD'), '200');
    escribir(campo('Descripción'), 'Descripción corregida');
    expect(screen.getByText('230,00', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('250,00', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('US$ 1.000,00')).toBeInTheDocument();
    expect(screen.getByText('US$ 1.150,00')).toBeInTheDocument();
    expect(screen.getByText('US$ 1.250,00')).toBeInTheDocument();
    fireEvent.click(agregarBtn());
    expect(onAgregar.mock.calls[0][0][0]).toMatchObject({
      precio: 200,
      costoChile: 230,
      cantidadSugerida: 5,
      desc: 'Descripción corregida'
    });
  });

  test('desmarcar una línea la deja fuera de los totales y del carrito', async () => {
    const { onAgregar } = montar({
      leer: vi.fn().mockResolvedValue(resultado([linea({ mpn: 'A' }), linea({ mpn: 'B', cantidad: 1 })]))
    });
    elegirFab('ISS');
    subir(png());
    await screen.findByLabelText('MPN línea 2');
    expect(agregarBtn()).toHaveTextContent('Agregar 2 al carrito');
    fireEvent.click(screen.getByLabelText('Incluir línea 1'));
    expect(agregarBtn()).toHaveTextContent('Agregar 1 al carrito');
    fireEvent.click(agregarBtn());
    expect(onAgregar.mock.calls[0][0].map((p) => p.mpn)).toEqual(['B']);
  });

  test('quitar una línea la saca de la tabla', async () => {
    montar({ leer: vi.fn().mockResolvedValue(resultado([linea({ mpn: 'A' }), linea({ mpn: 'B' })])) });
    elegirFab('ISS');
    subir(png());
    await screen.findByLabelText('MPN línea 2');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar línea 1' }));
    expect(screen.queryByLabelText('MPN línea 2')).not.toBeInTheDocument();
    expect(campo('MPN')).toHaveValue('B');
  });

  test('línea a mano sin archivo', () => {
    const { leer, onAgregar } = montar();
    expect(screen.getByRole('button', { name: 'Agregar línea a mano' })).toBeDisabled();
    elegirFab('Neural Labs');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar línea a mano' }));
    expect(screen.getByLabelText('Incluir línea 1')).toBeDisabled();
    escribir(campo('MPN'), 'NL-100');
    escribir(campo('Descripción'), 'Licencia Neural');
    escribir(campo('Cantidad'), '3');
    escribir(campo('Mi costo USD'), '1.000,50');
    fireEvent.click(screen.getByLabelText('Incluir línea 1'));
    fireEvent.click(agregarBtn());
    expect(leer).not.toHaveBeenCalled();
    expect(onAgregar.mock.calls[0][0][0]).toMatchObject({
      origen: 'NEURAL',
      mpn: 'NL-100',
      precio: 1000.5,
      costoChile: 1150.58,
      cantidadSugerida: 3
    });
  });

  test('si leer falla se muestra el error, se puede reintentar y lo escrito a mano no se pierde', async () => {
    const leer = vi
      .fn()
      .mockRejectedValueOnce(new Error('La miniPC está apagada'))
      .mockResolvedValueOnce(resultado([linea({ mpn: 'LEIDA' })]));
    montar({ leer });
    elegirFab('ISS');
    fireEvent.click(screen.getByRole('button', { name: 'Agregar línea a mano' }));
    escribir(campo('MPN'), 'MANUAL');
    subir(png());
    expect(await screen.findByRole('alert')).toHaveTextContent('La miniPC está apagada');
    expect(campo('MPN')).toHaveValue('MANUAL');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByLabelText('MPN línea 2');
    expect(leer).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(campo('MPN', 1)).toHaveValue('MANUAL');
    expect(campo('MPN', 2)).toHaveValue('LEIDA');
  });

  test('muestra todos los avisos del lector', async () => {
    const avisos = ['El quote viene en EUR: revisa.', 'Hay un descuento global de 10% que NO está aplicado.', 'Nota del lector: precios sin IVA'];
    montar({ leer: vi.fn().mockResolvedValue(resultado([linea()], avisos)) });
    elegirFab('ISS');
    subir(png());
    await screen.findByLabelText('MPN línea 1');
    avisos.forEach((a) => expect(screen.getByText(a)).toBeInTheDocument());
  });

  test('una segunda lectura agrega las líneas al final', async () => {
    const leer = vi
      .fn()
      .mockResolvedValueOnce(resultado([linea({ mpn: 'PRIMERA' })], ['aviso uno']))
      .mockResolvedValueOnce(resultado([linea({ mpn: 'SEGUNDA' })], ['aviso dos']));
    const { onAgregar } = montar({ leer });
    elegirFab('ISS');
    subir(png('uno.png'));
    await screen.findByLabelText('MPN línea 1');
    subir(png('dos.png'));
    await screen.findByLabelText('MPN línea 2');
    expect(campo('MPN', 1)).toHaveValue('PRIMERA');
    expect(campo('MPN', 2)).toHaveValue('SEGUNDA');
    expect(screen.getByText('aviso uno')).toBeInTheDocument();
    expect(screen.getByText('aviso dos')).toBeInTheDocument();
    fireEvent.click(agregarBtn());
    expect(onAgregar.mock.calls[0][0].map((p) => p.mpn)).toEqual(['PRIMERA', 'SEGUNDA']);
  });

  test('cambiar de fabricante con líneas cargadas recalcula los costos sin borrar lo escrito', async () => {
    montar();
    elegirFab('ISS');
    subir(png());
    await screen.findByLabelText('MPN línea 1');
    escribir(campo('Descripción'), 'Editada');
    expect(screen.getByText('115,00', { selector: 'td' })).toBeInTheDocument();
    elegirFab('Milestone');
    expect(campo('Descripción')).toHaveValue('Editada');
    expect(screen.getByText('100,00', { selector: 'td' })).toBeInTheDocument();
    expect(campo('Tipo')).toBeInTheDocument();
  });

  test('pegar una imagen con Ctrl+V la lee', async () => {
    const { leer } = montar();
    elegirFab('ISS');
    const file = png('image.png');
    fireEvent.paste(screen.getByRole('dialog'), { clipboardData: { files: [file] } });
    await screen.findByLabelText('MPN línea 1');
    expect(leer).toHaveBeenCalledWith({ file, fabricante: 'ISS' });
  });

  test('pegar texto no lee nada', () => {
    const { leer } = montar();
    elegirFab('ISS');
    fireEvent.paste(screen.getByRole('dialog'), { clipboardData: { files: [], items: [{ kind: 'string' }] } });
    expect(leer).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('soltar un archivo lo lee', async () => {
    const { leer } = montar();
    elegirFab('ISS');
    const file = pdf();
    fireEvent.drop(screen.getByRole('button', { name: 'Elegir o soltar el archivo del quote' }), { dataTransfer: { files: [file] } });
    await screen.findByLabelText('MPN línea 1');
    expect(leer).toHaveBeenCalledWith({ file, fabricante: 'ISS' });
  });

  test('Escape y Cancelar cierran sin agregar', async () => {
    const { onCerrar, onAgregar } = montar();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCerrar).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onCerrar).toHaveBeenCalledTimes(3);
    expect(onAgregar).not.toHaveBeenCalled();
  });

  test('al cerrarse y reabrirse parte limpio', async () => {
    const { rerender, leer, onCerrar, onAgregar } = montar();
    elegirFab('Milestone');
    subir(png('uno.png'));
    await screen.findByLabelText('MPN línea 1');
    rerender(<CargarQuoteModal abierto={false} onCerrar={onCerrar} onAgregar={onAgregar} leer={leer} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<CargarQuoteModal abierto onCerrar={onCerrar} onAgregar={onAgregar} leer={leer} />);
    expect(screen.queryByLabelText('MPN línea 1')).not.toBeInTheDocument();
    expect(screen.queryByText('uno.png')).not.toBeInTheDocument();
    screen.getAllByRole('radio').forEach((r) => expect(r).toHaveAttribute('aria-checked', 'false'));
    expect(agregarBtn()).toBeDisabled();
  });

  test('una lectura en vuelo al cerrar se descarta', async () => {
    const d = diferida();
    const leer = vi.fn(() => d.promesa);
    const { rerender, onCerrar, onAgregar } = montar({ leer });
    elegirFab('ISS');
    subir(png());
    rerender(<CargarQuoteModal abierto={false} onCerrar={onCerrar} onAgregar={onAgregar} leer={leer} />);
    d.resolver(resultado([linea()]));
    await Promise.resolve();
    rerender(<CargarQuoteModal abierto onCerrar={onCerrar} onAgregar={onAgregar} leer={leer} />);
    await waitFor(() => expect(screen.queryByLabelText('MPN línea 1')).not.toBeInTheDocument());
  });

  test('"revisar tipo" aparece en una línea dudosa de Milestone y desaparece al elegir el tipo', async () => {
    montar({
      leer: vi.fn().mockResolvedValue(
        resultado([
          linea({ mpn: 'ZZ-9', descripcion: 'Producto raro', tipo: 'licencia' }),
          linea({ mpn: 'XPCO', descripcion: 'XProtect Corporate Base License', tipo: 'licencia' })
        ])
      )
    });
    elegirFab('Milestone');
    subir(png());
    await screen.findByLabelText('MPN línea 2');
    expect(screen.getAllByText('revisar tipo')).toHaveLength(1);
    expect(campo('MPN', 1).closest('tr')).toContainElement(screen.getByText('revisar tipo'));
    escribir(campo('Tipo', 1), 'licencia');
    expect(screen.queryByText('revisar tipo')).not.toBeInTheDocument();
  });

  test('con ISS no hay selector de tipo ni "revisar tipo"', async () => {
    montar({ leer: vi.fn().mockResolvedValue(resultado([linea({ descripcion: 'Producto raro' })])) });
    elegirFab('ISS');
    subir(png());
    await screen.findByLabelText('MPN línea 1');
    expect(screen.queryByLabelText('Tipo línea 1')).not.toBeInTheDocument();
    expect(screen.queryByText('revisar tipo')).not.toBeInTheDocument();
  });
});

describe('textoNumero', () => {
  test('coma decimal y al menos dos decimales', () => {
    expect(textoNumero(100)).toBe('100,00');
    expect(textoNumero(1234.5)).toBe('1234,50');
    expect(textoNumero(80.55)).toBe('80,55');
    expect(textoNumero(0.1234)).toBe('0,1234');
    expect(textoNumero(null)).toBe('');
    expect(textoNumero(undefined)).toBe('');
  });

  test('tres decimales se escriben con cuatro para que no se relean como miles', async () => {
    const { normalizarMonto } = await import('./pantallazoMontos');
    expect(textoNumero(12.125)).toBe('12,1250');
    // Lo que se muestra debe volver a leerse como el mismo número al editar el campo.
    for (const n of [12.125, 1.5, 100, 999.999, 1234.5, 0.125, 2500, 80.55]) {
      expect(normalizarMonto(textoNumero(n))).toBe(n);
    }
  });
});

