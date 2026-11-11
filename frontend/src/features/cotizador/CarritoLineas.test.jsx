import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import CarritoLineas from './CarritoLineas';

// El componente renderiza a la vez la vista tarjetas (movil) y la tabla (escritorio);
// el ocultamiento es solo CSS, asi que cada control aparece dos veces en el DOM.

const lineaQnap = {
  id: 'l1', origen: 'QNAP', marca: 'QNAP', sku: 'NW-1', mpn: 'TS-464', desc: 'NAS 4 bahias', cant: 2, precio: 800, tiempo: '6 semanas tras OC'
};
const lineaAxis = {
  id: 'l2', origen: 'AXIS', marca: 'AXIS', sku: 'To Create', mpn: 'P3265', desc: 'Camara domo', cant: 1, precio: 500, tiempo: '4 unidades disponible en entrega inmediata, salvo venta previa'
};

const baseProps = (extra = {}) => ({
  items: [lineaQnap, lineaAxis],
  isAdmin: false,
  precioItem: (item) => (item.id === 'l1' ? 100 : 250),
  margenItem: (item) => ({ precio: item.id === 'l1' ? 100 : 250, costo: item.id === 'l1' ? 80 : 200, gpPct: item.id === 'l1' ? 20 : 20, margenTotal: item.id === 'l1' ? 40 : 50 }),
  gpBase: () => 0.15,
  rebatePartner: () => 10,
  partnerDefault: 'Partner Autorizado',
  onCambio: vi.fn(),
  onQuitar: vi.fn(),
  onMover: vi.fn(),
  ...extra
});

describe('CarritoLineas (cliente)', () => {
  test('carrito vacio muestra el mensaje y ningun control', () => {
    render(<CarritoLineas {...baseProps({ items: [] })} />);
    expect(screen.getByText('El carrito está vacío')).toBeInTheDocument();
    expect(screen.queryByLabelText('Cantidad')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('renderiza una fila por linea con producto, cantidad, precio unitario y total', () => {
    render(<CarritoLineas {...baseProps()} />);
    const tabla = screen.getByRole('table');
    const filas = within(tabla).getAllByRole('row');
    expect(filas).toHaveLength(3); // encabezado + 2 lineas

    const fila1 = filas[1];
    expect(within(fila1).getByText('NW-1')).toBeInTheDocument();
    expect(within(fila1).getByText('TS-464')).toBeInTheDocument();
    expect(within(fila1).getByText('NAS 4 bahias')).toBeInTheDocument();
    expect(within(fila1).getByLabelText('Cantidad')).toHaveValue('2');
    expect(within(fila1).getByText('$100.00')).toBeInTheDocument(); // precio unitario
    expect(within(fila1).getByText('$200.00')).toBeInTheDocument(); // 2 x 100

    const fila2 = filas[2];
    expect(within(fila2).getAllByText('$250.00')).toHaveLength(2); // cant 1: unitario y total coinciden
  });

  test('SKU "To Create" se muestra como "SKU por crear"', () => {
    render(<CarritoLineas {...baseProps()} />);
    expect(screen.getAllByText('SKU por crear').length).toBeGreaterThan(0);
    expect(screen.queryByText('To Create')).not.toBeInTheDocument();
  });

  test('el cliente no ve costo, GP, margen ni controles de mover; la descripcion no es editable', () => {
    render(<CarritoLineas {...baseProps()} />);
    expect(screen.queryByLabelText('Costo disty')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('GP %')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Precio unitario')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Subir línea')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Descripción')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Editar entrega')).not.toBeInTheDocument();
  });

  test('muestra la entrega: texto del catalogo o etiqueta de entrega inmediata', () => {
    render(<CarritoLineas {...baseProps()} />);
    expect(screen.getAllByText('6 semanas tras OC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4 inmediata').length).toBeGreaterThan(0);
  });

  test('cambiar la cantidad llama onCambio(id, "cant", numero)', () => {
    const props = baseProps();
    render(<CarritoLineas {...props} />);
    const input = within(screen.getByRole('table')).getAllByLabelText('Cantidad')[0];
    fireEvent.change(input, { target: { value: '5' } });
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'cant', 5);
  });

  test('cantidad decimal se trunca a entero', () => {
    const props = baseProps();
    render(<CarritoLineas {...props} />);
    const input = within(screen.getByRole('table')).getAllByLabelText('Cantidad')[0];
    fireEvent.change(input, { target: { value: '3,9' } });
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'cant', 3);
  });

  test('cantidad menor al minimo (1), vacia o no numerica no dispara onCambio', () => {
    const props = baseProps();
    render(<CarritoLineas {...props} />);
    const input = within(screen.getByRole('table')).getAllByLabelText('Cantidad')[0];
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.change(input, { target: { value: '-2' } });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(props.onCambio).not.toHaveBeenCalled();
  });

  test('quitar una linea llama onQuitar con su id', () => {
    const props = baseProps();
    render(<CarritoLineas {...props} />);
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Quitar NW-1' }));
    expect(props.onQuitar).toHaveBeenCalledTimes(1);
    expect(props.onQuitar).toHaveBeenCalledWith('l1');
  });

  test('el boton quitar usa el MPN si la linea no tiene SKU', () => {
    const props = baseProps({ items: [{ ...lineaQnap, sku: '' }] });
    render(<CarritoLineas {...props} />);
    expect(screen.getAllByRole('button', { name: 'Quitar TS-464' }).length).toBeGreaterThan(0);
  });

  test('la vista de tarjetas (movil) tambien permite quitar y cambiar cantidad', () => {
    const props = baseProps();
    const { container } = render(<CarritoLineas {...props} />);
    const lista = container.querySelector('ul');
    fireEvent.click(within(lista).getAllByRole('button', { name: 'Quitar NW-1' })[0]);
    expect(props.onQuitar).toHaveBeenCalledWith('l1');
    fireEvent.change(within(lista).getAllByLabelText('Cantidad')[1], { target: { value: '7' } });
    expect(props.onCambio).toHaveBeenCalledWith('l2', 'cant', 7);
  });
});

describe('CarritoLineas (admin)', () => {
  const adminProps = (extra = {}) => baseProps({ isAdmin: true, ...extra });

  test('muestra costo, GP, precio unitario, margen y total por linea', () => {
    render(<CarritoLineas {...adminProps()} />);
    const tabla = screen.getByRole('table');
    const fila1 = within(tabla).getAllByRole('row')[1];
    expect(within(fila1).getByLabelText('Costo disty')).toHaveValue('800.00');
    expect(within(fila1).getByLabelText('GP %')).toHaveAttribute('placeholder', '15.0');
    expect(within(fila1).getByLabelText('Precio unitario')).toHaveValue('100.00');
    expect(within(fila1).getByText('$200.00')).toBeInTheDocument(); // total = precio * cant
    expect(within(fila1).getByText('$40.00')).toBeInTheDocument(); // margen total
    expect(within(fila1).getByText('global')).toBeInTheDocument();
  });

  test('GP propio de la linea reemplaza el "global"', () => {
    render(<CarritoLineas {...adminProps({ items: [{ ...lineaQnap, gpOverride: 0.25 }] })} />);
    const gp = within(screen.getByRole('table')).getByLabelText('GP %');
    expect(gp).toHaveValue('25.0');
    expect(within(screen.getByRole('table')).queryByText('global')).not.toBeInTheDocument();
  });

  test('editar el precio unitario y el GP notifica el cambio', () => {
    const props = adminProps();
    render(<CarritoLineas {...props} />);
    const tabla = screen.getByRole('table');
    fireEvent.change(within(tabla).getAllByLabelText('Precio unitario')[0], { target: { value: '120' } });
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'precioUnitario', 120);
    fireEvent.change(within(tabla).getAllByLabelText('GP %')[0], { target: { value: '30' } });
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'gpOverride', '30');
  });

  test('vaciar el GP propio de la linea vuelve al global (gpOverride "")', () => {
    const props = adminProps({ items: [{ ...lineaQnap, gpOverride: 0.25 }] });
    render(<CarritoLineas {...props} />);
    fireEvent.change(within(screen.getByRole('table')).getByLabelText('GP %'), { target: { value: '' } });
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'gpOverride', '');
  });

  test('editar el costo disty notifica el cambio', () => {
    const props = adminProps();
    render(<CarritoLineas {...props} />);
    fireEvent.change(within(screen.getByRole('table')).getAllByLabelText('Costo disty')[0], { target: { value: '900' } });
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'precio', 900);
  });

  test('costo real de stock reemplaza al input de costo y se puede volver al costo disty', () => {
    const props = adminProps({ items: [{ ...lineaQnap, costoChile: 750 }] });
    render(<CarritoLineas {...props} />);
    const tabla = screen.getByRole('table');
    expect(within(tabla).getByText('Real stock $750.00')).toBeInTheDocument();
    expect(within(tabla).queryByLabelText('Costo disty')).not.toBeInTheDocument();
    fireEvent.click(within(tabla).getByRole('button', { name: 'usar costo disty' }));
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'costoChile', null);
  });

  test('linea AXIS: muestra el selector de partner y notifica el cambio de categoria', () => {
    const props = adminProps();
    render(<CarritoLineas {...props} />);
    const tabla = screen.getByRole('table');
    const selects = within(tabla).getAllByLabelText('Categoría de partner');
    expect(selects).toHaveLength(1); // solo la linea AXIS
    expect(selects[0]).toHaveValue('Partner Autorizado');
    fireEvent.change(selects[0], { target: { value: 'Partner Gold' } });
    expect(props.onCambio).toHaveBeenCalledWith('l2', 'partnerCategory', 'Partner Gold');
  });

  test('quitar linea en vista admin', () => {
    const props = adminProps();
    render(<CarritoLineas {...props} />);
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Quitar NW-1' }));
    expect(props.onQuitar).toHaveBeenCalledWith('l1');
  });

  test('mover: la primera no sube, la ultima no baja; los demas llaman onMover(indice, delta)', () => {
    const props = adminProps();
    render(<CarritoLineas {...props} />);
    const tabla = screen.getByRole('table');
    const subir = within(tabla).getAllByRole('button', { name: 'Subir línea' });
    const bajar = within(tabla).getAllByRole('button', { name: 'Bajar línea' });
    expect(subir[0]).toBeDisabled();
    expect(bajar[1]).toBeDisabled();
    fireEvent.click(subir[1]);
    expect(props.onMover).toHaveBeenCalledWith(1, -1);
    fireEvent.click(bajar[0]);
    expect(props.onMover).toHaveBeenCalledWith(0, 1);
  });

  test('la descripcion es editable para admin', () => {
    const props = adminProps();
    render(<CarritoLineas {...props} />);
    const desc = within(screen.getByRole('table')).getAllByLabelText('Descripción')[0];
    expect(desc).toHaveValue('NAS 4 bahias');
    fireEvent.change(desc, { target: { value: 'NAS nuevo' } });
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'desc', 'NAS nuevo');
  });

  test('la entrega es editable con el lapiz', () => {
    const props = adminProps();
    render(<CarritoLineas {...props} />);
    const tabla = screen.getByRole('table');
    expect(within(tabla).queryByLabelText('Tiempo de entrega')).not.toBeInTheDocument();
    fireEvent.click(within(tabla).getAllByRole('button', { name: 'Editar entrega' })[0]);
    const area = within(tabla).getByLabelText('Tiempo de entrega');
    expect(area).toHaveValue('6 semanas tras OC');
    fireEvent.change(area, { target: { value: '2 semanas' } });
    expect(props.onCambio).toHaveBeenCalledWith('l1', 'tiempo', '2 semanas');
  });

  test('una linea sin entrega muestra directamente el campo para escribirla', () => {
    render(<CarritoLineas {...adminProps({ items: [{ ...lineaQnap, tiempo: '' }] })} />);
    expect(within(screen.getByRole('table')).getByLabelText('Tiempo de entrega')).toBeInTheDocument();
  });

  test('alertaLinea marca la fila con el motivo (titulo)', () => {
    const alertaLinea = (item) => (item.id === 'l1' ? 'bajo_piso' : item.id === 'l2' ? 'por_crear' : null);
    render(<CarritoLineas {...adminProps({ alertaLinea })} />);
    const filas = within(screen.getByRole('table')).getAllByRole('row');
    expect(filas[1]).toHaveAttribute('title', 'Margen bajo el mínimo aceptable');
    expect(filas[2]).toHaveAttribute('title', 'SKU por crear');
  });

  test('sin alertaLinea las filas no llevan titulo', () => {
    render(<CarritoLineas {...adminProps()} />);
    const filas = within(screen.getByRole('table')).getAllByRole('row');
    expect(filas[1]).not.toHaveAttribute('title');
  });
});
