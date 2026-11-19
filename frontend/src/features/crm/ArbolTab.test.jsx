import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import ArbolTab from './ArbolTab';
import { crmApi } from './crmApi';
import { ARBOL, opArbol, renderConQuery } from './fixturesCrm';

vi.mock('./crmApi', () => ({
  crmApi: {
    arbol: vi.fn(),
    actualizarOportunidad: vi.fn()
  }
}));

const fila = (id) => document.querySelector(`[data-fila-id="${id}"]`);
const idsFilas = () => [...document.querySelectorAll('[data-fila-id]')].map((f) => f.dataset.filaId);
const copia = () => JSON.parse(JSON.stringify(ARBOL));

const montar = async (props = {}, datos = copia()) => {
  crmApi.arbol.mockResolvedValue(datos);
  const r = renderConQuery(<ArbolTab onAbrirEmpresa={() => {}} onAbrirCotizacion={() => {}} {...props} />);
  await screen.findByRole('treegrid', { name: 'Árbol del CRM' });
  return r;
};

const buscar = (texto) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: texto } });

describe('ArbolTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    crmApi.actualizarOportunidad.mockResolvedValue({});
  });

  test('carga y muestra los grupos plegados, con abiertas y monto, y el pie con totales', async () => {
    await montar();
    // Por defecto: solo etapas abiertas, agrupado por empresa, por monto abierto.
    expect(idsFilas()).toEqual(['g:empresa:10', 'g:empresa:12', 'g:empresa:11']);
    const acme = within(fila('g:empresa:10'));
    expect(acme.getByText('Acme SA')).toBeInTheDocument();
    expect(acme.getByText('2 abiertas')).toBeInTheDocument();
    expect(acme.getByText('$48,200.00')).toBeInTheDocument();
    expect(within(fila('g:empresa:11')).getByText('1 abierta')).toBeInTheDocument();
    expect(screen.getByText('3 empresas · 4 oportunidades · 4 abiertas por $75,350.00')).toBeInTheDocument();
    expect(screen.queryByText(/más recientes de/)).not.toBeInTheDocument();
    expect(crmApi.arbol).toHaveBeenCalledTimes(1);
  });

  test('atributos ARIA de las filas: nivel, posición, tamaño y expanded', async () => {
    await montar();
    const grupo = fila('g:empresa:10');
    expect(grupo).toHaveAttribute('role', 'row');
    expect(grupo).toHaveAttribute('aria-level', '1');
    expect(grupo).toHaveAttribute('aria-posinset', '1');
    expect(grupo).toHaveAttribute('aria-setsize', '3');
    expect(grupo).toHaveAttribute('aria-expanded', 'false');
    expect(fila('g:empresa:11')).toHaveAttribute('aria-posinset', '3');

    fireEvent.click(grupo);
    fireEvent.click(fila('o:1'));
    expect(grupo).toHaveAttribute('aria-expanded', 'true');
    const op1 = fila('o:1');
    expect(op1).toHaveAttribute('aria-level', '2');
    expect(op1).toHaveAttribute('aria-posinset', '1');
    expect(op1).toHaveAttribute('aria-setsize', '2');
    expect(op1).toHaveAttribute('aria-expanded', 'true');
    const cot = fila('c:502');
    expect(cot).toHaveAttribute('aria-level', '3');
    expect(cot).toHaveAttribute('aria-posinset', '2');
    expect(cot).toHaveAttribute('aria-setsize', '2');
    expect(cot).not.toHaveAttribute('aria-expanded');
    // Una oportunidad sin cotizaciones no es expandible.
    fireEvent.click(fila('g:empresa:12'));
    expect(fila('o:5')).not.toHaveAttribute('aria-expanded');
    // Un único punto de tabulación.
    expect(document.querySelectorAll('[role="row"][tabindex="0"]')).toHaveLength(1);
    expect(fila('g:empresa:10')).toHaveAttribute('tabindex', '0');
  });

  test('con clic se despliega y pliega el grupo y la oportunidad', async () => {
    await montar();
    fireEvent.click(fila('g:empresa:10'));
    expect(idsFilas()).toEqual(['g:empresa:10', 'o:1', 'o:2', 'g:empresa:12', 'g:empresa:11']);
    const op1 = within(fila('o:1'));
    expect(op1.getByText('NAS sucursal Norte')).toBeInTheDocument();
    expect(op1.getByText('Ana Pérez')).toBeInTheDocument();
    expect(op1.getByText('QNAP')).toBeInTheDocument();
    expect(op1.getByText('$12,400.00')).toBeInTheDocument();
    expect(op1.getByText('6 días')).toBeInTheDocument();
    expect(op1.getByLabelText('Etapa de NAS sucursal Norte')).toHaveValue('negociacion');

    fireEvent.click(fila('o:1'));
    expect(idsFilas()).toContain('c:501');
    expect(idsFilas()).toContain('c:502');
    const vigente = within(fila('c:501'));
    expect(vigente.getByText('#1041')).toBeInTheDocument();
    expect(vigente.getByText('v2')).toBeInTheDocument();
    expect(vigente.getByText('vigente')).toBeInTheDocument();
    expect(vigente.getByText(/Proyecto Norte · PID-77 · .*2026 · alexis/)).toBeInTheDocument();
    expect(vigente.getByText('$12,400.00')).toBeInTheDocument();
    const anterior = within(fila('c:502'));
    expect(anterior.queryByText('vigente')).not.toBeInTheDocument();
    expect(anterior.queryByText(/^v\d/)).not.toBeInTheDocument(); // v1 no se muestra
    expect(anterior.getByText('$11,900.00')).toBeInTheDocument();

    fireEvent.click(fila('o:1'));
    expect(idsFilas()).not.toContain('c:501');
    fireEvent.click(fila('g:empresa:10'));
    expect(idsFilas()).toEqual(['g:empresa:10', 'g:empresa:12', 'g:empresa:11']);
  });

  test('la etiqueta "vigente" solo aparece si la oportunidad tiene más de una cotización', async () => {
    await montar();
    fireEvent.click(fila('g:empresa:10'));
    fireEvent.click(fila('o:2'));
    expect(within(fila('c:503')).queryByText('vigente')).not.toBeInTheDocument();
  });

  test('no muestra "N/A" como proyecto ni como PID, y un correo en el PID va sin prefijo', async () => {
    const datos = copia();
    // Así guarda el cotizador una cotización sin proyecto ni PID.
    Object.assign(datos.cotizaciones.find((c) => c.id === 503), { proyecto: 'N/A', pid: 'N/A' });
    Object.assign(datos.cotizaciones.find((c) => c.id === 504), { proyecto: 'Sucursal Sur', pid: 'compras@beta.cl' });
    await montar({}, datos);
    fireEvent.click(fila('g:empresa:10'));
    fireEvent.click(fila('o:2'));
    expect(fila('c:503').textContent).not.toMatch(/N\/A/);
    expect(fila('c:503').textContent).not.toMatch(/PID/);
    expect(within(fila('c:503')).getByText(/2026 · alexis$/)).toBeInTheDocument();
    fireEvent.click(fila('g:empresa:11'));
    fireEvent.click(fila('o:4'));
    expect(within(fila('c:504')).getByText(/^Sucursal Sur · compras@beta\.cl · /)).toBeInTheDocument();
  });

  test('si lo buscado está en una etapa oculta por el filtro, lo dice y ofrece verla', async () => {
    await montar();
    // "Rack perdido" está en Perdida; el filtro por defecto muestra solo las abiertas.
    buscar('rack perdido');
    expect(await screen.findByText('Nada en las etapas seleccionadas')).toBeInTheDocument();
    expect(screen.getByText('Hay 1 oportunidad que coincide en otras etapas.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas las etapas' }));
    expect(await screen.findByRole('treegrid')).toBeInTheDocument();
    expect(fila('o:6')).toBeInTheDocument();
    // Una búsqueda que no existe en ninguna etapa sigue diciendo que no hay resultados.
    buscar('esto no existe');
    expect(await screen.findByText('Ninguna oportunidad coincide con los filtros')).toBeInTheDocument();
  });

  test('chips de proyecto y BO, y motivo de pérdida', async () => {
    await montar({}, copia());
    fireEvent.click(screen.getByRole('button', { name: /Ganada/ }));
    fireEvent.click(screen.getByRole('button', { name: /Perdida/ }));
    fireEvent.click(fila('g:empresa:10'));
    expect(within(fila('o:3')).getByText('BO-1001', { selector: '.mq-arbol-chip' })).toBeInTheDocument();
    fireEvent.click(fila('g:empresa:12'));
    expect(within(fila('o:5')).getByTitle('Proyecto / BID')).toHaveTextContent('BID');
    fireEvent.click(fila('g:empresa:11'));
    expect(within(fila('o:6')).getByText('Motivo: Precio')).toBeInTheDocument();
  });

  test('teclado: flechas, Home/End, Enter, y un solo punto de tabulación que sigue al foco', async () => {
    await montar();
    const acme = fila('g:empresa:10');
    acme.focus();
    fireEvent.keyDown(acme, { key: 'ArrowRight' }); // despliega
    expect(acme).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(acme, { key: 'ArrowRight' }); // primer hijo
    expect(document.activeElement).toBe(fila('o:1'));
    expect(fila('o:1')).toHaveAttribute('tabindex', '0');
    expect(acme).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(fila('o:1'), { key: 'Enter' }); // alterna la oportunidad
    expect(fila('o:1')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(fila('o:1'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(fila('c:501'));
    fireEvent.keyDown(fila('c:501'), { key: 'ArrowLeft' }); // sube al padre
    expect(document.activeElement).toBe(fila('o:1'));
    fireEvent.keyDown(fila('o:1'), { key: 'ArrowLeft' }); // contrae
    expect(fila('o:1')).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(fila('o:1'));
    fireEvent.keyDown(fila('o:1'), { key: 'ArrowLeft' }); // sube al grupo
    expect(document.activeElement).toBe(acme);
    fireEvent.keyDown(acme, { key: 'End' });
    expect(document.activeElement).toBe(fila('g:empresa:11'));
    fireEvent.keyDown(fila('g:empresa:11'), { key: 'ArrowDown' }); // borde: sin efecto
    expect(document.activeElement).toBe(fila('g:empresa:11'));
    fireEvent.keyDown(fila('g:empresa:11'), { key: 'Home' });
    expect(document.activeElement).toBe(acme);
    fireEvent.keyDown(acme, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(acme);
    fireEvent.keyDown(acme, { key: ' ' }); // espacio alterna
    expect(acme).toHaveAttribute('aria-expanded', 'false');
  });

  test('Enter sobre una cotización la abre; sobre una oportunidad sin cotizaciones no hace nada', async () => {
    const onAbrirCotizacion = vi.fn();
    await montar({ onAbrirCotizacion });
    fireEvent.click(fila('g:empresa:10'));
    fireEvent.click(fila('o:1'));
    fireEvent.keyDown(fila('c:502'), { key: 'Enter' });
    expect(onAbrirCotizacion).toHaveBeenCalledWith(502);
    fireEvent.click(fila('g:empresa:12'));
    fireEvent.keyDown(fila('o:5'), { key: 'Enter' });
    expect(onAbrirCotizacion).toHaveBeenCalledTimes(1);
  });

  test('los controles dentro de la fila no alternan la fila ni se roban las flechas', async () => {
    await montar();
    fireEvent.click(fila('g:empresa:10'));
    const select = screen.getByLabelText('Etapa de NAS sucursal Norte');
    fireEvent.click(select);
    expect(fila('o:1')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Ficha de Acme SA' }));
    expect(fila('g:empresa:10')).toHaveAttribute('aria-expanded', 'true');
    // Una flecha con el foco en el select no mueve el foco de la fila ni se cancela.
    select.focus();
    const sinCancelar = fireEvent.keyDown(select, { key: 'ArrowDown' });
    expect(sinCancelar).toBe(true);
    expect(document.activeElement).toBe(select);
    // Enter con el foco en el select tampoco alterna.
    fireEvent.keyDown(select, { key: 'Enter' });
    expect(fila('o:1')).toHaveAttribute('aria-expanded', 'false');
  });

  describe('seguimiento y panel', () => {
    const verTodas = () => window.localStorage.setItem('crmArbol', JSON.stringify({ etapas: [] }));
    const desplegar = (...ids) => ids.forEach((id) => fireEvent.click(fila(id)));

    test('la columna Seguimiento va entre Etapa y Marca', async () => {
      await montar();
      const cabeceras = within(document.querySelector('.mq-arbol-cabecera')).getAllByRole('columnheader').map((c) => c.textContent);
      expect(cabeceras).toEqual(['Empresa', 'Etapa', 'Seguimiento', 'Marca', 'Monto', 'Días']);
      // Todas las filas tienen una celda por columna.
      desplegar('g:empresa:10', 'o:1');
      ['g:empresa:10', 'o:1', 'c:501'].forEach((id) => expect(within(fila(id)).getAllByRole('gridcell')).toHaveLength(6));
    });

    test('muestra el estado de cada oportunidad con su punto y abre el panel al hacer clic', async () => {
      const onAbrirOportunidad = vi.fn();
      await montar({ onAbrirOportunidad });
      desplegar('g:empresa:10', 'g:empresa:11');
      const sin = within(fila('o:1')).getByRole('button', { name: 'Seguimiento de NAS sucursal Norte: Sin seguimiento' });
      expect(sin).toHaveTextContent('Sin seguimiento');
      expect(sin.querySelector('.mq-punto-neutro')).toBeInTheDocument();
      expect(sin).not.toHaveAttribute('title');

      const vencida = within(fila('o:2')).getByRole('button', { name: /^Seguimiento de Cámaras bodega: Vencido hace \d+ días$/ });
      expect(vencida.querySelector('.mq-punto-critico')).toBeInTheDocument();
      expect(vencida).toHaveAttribute('title', 'Llamar a Ana por el descuento');

      const futura = within(fila('o:4')).getByRole('button', { name: 'Seguimiento de Switches Beta: 15-dic-2099' });
      expect(futura.querySelector('.mq-punto-ok')).toBeInTheDocument();

      fireEvent.click(vencida);
      expect(onAbrirOportunidad).toHaveBeenCalledWith(2);
      // El clic en el botón no despliega la fila.
      expect(fila('o:2')).toHaveAttribute('aria-expanded', 'false');
    });

    test('una oportunidad cerrada muestra "—" sin botón; los grupos y las cotizaciones dejan la celda vacía', async () => {
      verTodas();
      await montar({ onAbrirOportunidad: vi.fn() });
      desplegar('g:empresa:10', 'o:1');
      const celdaCerrada = within(fila('o:3')).getAllByRole('gridcell')[2];
      expect(celdaCerrada).toHaveTextContent('—');
      expect(within(celdaCerrada).queryByRole('button')).not.toBeInTheDocument();
      expect(within(fila('o:3')).queryByRole('button', { name: /^Seguimiento de/ })).not.toBeInTheDocument();
      expect(within(fila('g:empresa:10')).getAllByRole('gridcell')[2]).toBeEmptyDOMElement();
      expect(within(fila('c:501')).getAllByRole('gridcell')[2]).toBeEmptyDOMElement();
    });

    test('el título de la oportunidad es un botón que abre el panel sin plegar ni desplegar la fila', async () => {
      const onAbrirOportunidad = vi.fn();
      await montar({ onAbrirOportunidad });
      desplegar('g:empresa:10');
      fireEvent.click(within(fila('o:1')).getByRole('button', { name: 'NAS sucursal Norte' }));
      expect(onAbrirOportunidad).toHaveBeenCalledWith(1);
      expect(fila('o:1')).toHaveAttribute('aria-expanded', 'false');
      // Hacer clic en otra parte de la fila sigue desplegándola.
      fireEvent.click(fila('o:1'));
      expect(fila('o:1')).toHaveAttribute('aria-expanded', 'true');
    });

    test('el teclado de la fila no se mezcla con el botón del título ni con el de seguimiento', async () => {
      const onAbrirOportunidad = vi.fn();
      await montar({ onAbrirOportunidad });
      desplegar('g:empresa:10');
      const titulo = within(fila('o:1')).getByRole('button', { name: 'NAS sucursal Norte' });
      const seguimiento = within(fila('o:1')).getByRole('button', { name: /^Seguimiento de/ });
      [titulo, seguimiento].forEach((boton) => {
        boton.focus();
        const sinCancelar = fireEvent.keyDown(boton, { key: 'Enter' });
        expect(sinCancelar).toBe(true);
        fireEvent.keyDown(boton, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(boton);
        expect(fila('o:1')).toHaveAttribute('aria-expanded', 'false');
      });
      // Y las flechas con el foco en la fila siguen funcionando.
      fireEvent.keyDown(fila('o:1'), { key: 'ArrowDown' });
      expect(document.activeElement).toBe(fila('o:2'));
    });

    test('sin onAbrirOportunidad el título y el seguimiento son texto, no botones', async () => {
      await montar();
      desplegar('g:empresa:10');
      expect(within(fila('o:1')).queryByRole('button', { name: 'NAS sucursal Norte' })).not.toBeInTheDocument();
      expect(within(fila('o:1')).queryByRole('button', { name: /^Seguimiento de/ })).not.toBeInTheDocument();
      expect(within(fila('o:1')).getByText('Sin seguimiento')).toBeInTheDocument();
    });

    test('la búsqueda también calza por la nota del seguimiento', async () => {
      await montar();
      buscar('descuento');
      expect(await screen.findByText('Cámaras bodega')).toBeInTheDocument();
      expect(idsFilas()).toEqual(['g:empresa:10', 'o:2']);
    });
  });

  test('agrupar por Etapa y por Marca', async () => {
    await montar();
    const grupo = screen.getByRole('radiogroup', { name: 'Agrupar por' });
    expect(within(grupo).getByRole('radio', { name: 'Empresa' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(grupo).getByRole('radio', { name: 'Etapa' }));
    expect(within(grupo).getByRole('radio', { name: 'Etapa' })).toHaveAttribute('aria-checked', 'true');
    expect(idsFilas()).toEqual(['g:etapa:cotizada', 'g:etapa:negociacion']);
    expect(within(fila('g:etapa:cotizada')).getByText('$42,950.00')).toBeInTheDocument();
    expect(within(fila('g:etapa:cotizada')).queryByRole('button', { name: /Ficha/ })).not.toBeInTheDocument();
    expect(screen.getByText('2 etapas · 4 oportunidades · 4 abiertas por $75,350.00')).toBeInTheDocument();
    // Sin agrupar por empresa, la empresa aparece como enlace en la oportunidad.
    fireEvent.click(fila('g:etapa:cotizada'));
    expect(within(fila('o:4')).getByRole('button', { name: 'Beta Ltda' })).toBeInTheDocument();

    fireEvent.click(within(grupo).getByRole('radio', { name: 'Marca' }));
    expect(idsFilas()).toEqual(['g:marca:AXIS', 'g:marca:QNAP', 'g:marca:MIXTA', 'g:marca:SIN']);
    expect(within(fila('g:marca:SIN')).getByText('Sin marca')).toBeInTheDocument();
    expect(screen.getByText('4 marcas · 4 oportunidades · 4 abiertas por $75,350.00')).toBeInTheDocument();
  });

  test('con el teclado el grupo de "Agrupar por" cambia de opción', async () => {
    await montar();
    const empresa = screen.getByRole('radio', { name: 'Empresa' });
    fireEvent.keyDown(empresa, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Etapa' })).toHaveAttribute('aria-checked', 'true');
  });

  test('al cambiar de agrupación se reinician los grupos desplegados pero se conservan las oportunidades', async () => {
    await montar();
    fireEvent.click(fila('g:empresa:10'));
    fireEvent.click(fila('o:1'));
    fireEvent.click(screen.getByRole('radio', { name: 'Marca' }));
    expect(fila('g:marca:QNAP')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(fila('g:marca:QNAP'));
    expect(fila('o:1')).toHaveAttribute('aria-expanded', 'true');
    expect(idsFilas()).toContain('c:501');
  });

  test('buscar por empresa despliega el grupo; al borrar vuelve a lo que había', async () => {
    await montar();
    fireEvent.click(fila('g:empresa:11'));
    buscar('entel');
    await waitFor(() => expect(idsFilas()).toEqual(['g:empresa:12', 'o:5']));
    expect(fila('g:empresa:12')).toHaveAttribute('aria-expanded', 'true');
    buscar('');
    await waitFor(() => expect(idsFilas()).toEqual(['g:empresa:10', 'g:empresa:12', 'g:empresa:11', 'o:4']));
    expect(fila('g:empresa:12')).toHaveAttribute('aria-expanded', 'false');
  });

  test('buscar por #número y por PID despliega grupo y oportunidad; sin tildes ni mayúsculas', async () => {
    await montar();
    buscar('#1050');
    await waitFor(() => expect(idsFilas()).toEqual(['g:empresa:10', 'o:2', 'c:503']));
    buscar('pid-77');
    await waitFor(() => expect(idsFilas()).toEqual(['g:empresa:10', 'o:1', 'c:501', 'c:502']));
    buscar('CAMARAS');
    await waitFor(() => expect(idsFilas()).toEqual(['g:empresa:10', 'o:2']));
    buscar('');
    await waitFor(() => expect(idsFilas()).toEqual(['g:empresa:10', 'g:empresa:12', 'g:empresa:11']));
  });

  test('durante la búsqueda se puede plegar lo que ella abrió', async () => {
    await montar();
    buscar('pid-77');
    await waitFor(() => expect(idsFilas()).toContain('c:501'));
    fireEvent.click(fila('o:1'));
    expect(idsFilas()).not.toContain('c:501');
    expect(fila('o:1')).toHaveAttribute('aria-expanded', 'false');
  });

  test('sin coincidencias ofrece limpiar los filtros', async () => {
    await montar();
    buscar('zzzz');
    expect(await screen.findByText('Ninguna oportunidad coincide con los filtros')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
    // Limpiar deja todas las etapas: aparece la ganada.
    expect(idsFilas()).toContain('g:empresa:10');
    expect(screen.getByText('3 empresas · 6 oportunidades · 4 abiertas por $75,350.00')).toBeInTheDocument();
  });

  test('filtros de etapa (con conteos) y de marca', async () => {
    await montar();
    const chips = screen.getByRole('group', { name: 'Filtrar por etapa' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Nueva0', 'Cotizada2', 'Negociación2', 'Ganada1', 'Perdida1'
    ]);
    expect(within(chips).getByRole('button', { name: /Cotizada/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).getByRole('button', { name: /Ganada/ })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(chips).getByRole('button', { name: /Ganada/ }));
    expect(screen.getByText('3 empresas · 5 oportunidades · 4 abiertas por $75,350.00')).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole('button', { name: /Cotizada/ }));
    fireEvent.click(within(chips).getByRole('button', { name: /Negociación/ }));
    fireEvent.click(within(chips).getByRole('button', { name: /Nueva/ }));
    expect(idsFilas()).toEqual(['g:empresa:10']);
    expect(screen.getByText('1 empresa · 1 oportunidad · 0 abiertas por $0.00')).toBeInTheDocument();

    fireEvent.click(within(chips).getByRole('button', { name: /Ganada/ })); // sin chips = todas
    expect(screen.getByText(/6 oportunidades/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filtrar por marca'), { target: { value: 'AXIS' } });
    expect(screen.getByText(/2 oportunidades/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrar por marca'), { target: { value: 'SIN' } });
    expect(screen.getByText('1 empresa · 1 oportunidad · 1 abierta por $7,150.00')).toBeInTheDocument();
  });

  test('cambiar la etapa llama a actualizarOportunidad', async () => {
    await montar();
    fireEvent.click(fila('g:empresa:10'));
    fireEvent.change(screen.getByLabelText('Etapa de NAS sucursal Norte'), { target: { value: 'cotizada' } });
    await waitFor(() => expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'cotizada' }));
  });

  test('pasar a Perdida pide el motivo antes de llamar al servidor', async () => {
    await montar();
    fireEvent.click(fila('g:empresa:10'));
    fireEvent.change(screen.getByLabelText('Etapa de NAS sucursal Norte'), { target: { value: 'perdida' } });
    const dialogo = await screen.findByRole('dialog', { name: /Marcar como perdida/ });
    expect(crmApi.actualizarOportunidad).not.toHaveBeenCalled();
    fireEvent.change(within(dialogo).getByRole('textbox'), { target: { value: 'Precio' } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Marcar como perdida' }));
    await waitFor(() =>
      expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'perdida', motivo_perdida: 'Precio' })
    );
  });

  test('"Ficha" abre la empresa y #número abre la cotización', async () => {
    const onAbrirEmpresa = vi.fn();
    const onAbrirCotizacion = vi.fn();
    await montar({ onAbrirEmpresa, onAbrirCotizacion });
    fireEvent.click(screen.getByRole('button', { name: 'Ficha de Acme SA' }));
    expect(onAbrirEmpresa).toHaveBeenCalledWith(10);
    // El clic en el botón no despliega el grupo.
    expect(fila('g:empresa:10')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(fila('g:empresa:10'));
    fireEvent.click(fila('o:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cotización 1041' }));
    expect(onAbrirCotizacion).toHaveBeenCalledWith(501);

    // Agrupado por etapa, el nombre de la empresa de la oportunidad también abre su ficha.
    fireEvent.click(screen.getByRole('radio', { name: 'Etapa' }));
    fireEvent.click(fila('g:etapa:negociacion'));
    fireEvent.click(within(fila('o:1')).getByRole('button', { name: 'Acme SA' }));
    expect(onAbrirEmpresa).toHaveBeenLastCalledWith(10);
  });

  test('guarda las preferencias y las restaura al volver a montar', async () => {
    const { unmount } = await montar();
    fireEvent.click(screen.getByRole('radio', { name: 'Etapa' }));
    fireEvent.click(fila('g:etapa:cotizada'));
    fireEvent.click(fila('o:2'));
    fireEvent.click(screen.getByRole('button', { name: /Ganada/ }));
    fireEvent.change(screen.getByLabelText('Filtrar por marca'), { target: { value: 'AXIS' } });
    const guardado = JSON.parse(window.localStorage.getItem('crmArbol'));
    expect(guardado).toMatchObject({ agruparPor: 'etapa', marca: 'AXIS' });
    expect(guardado.etapas).toEqual(['nueva', 'cotizada', 'negociacion', 'ganada']);
    expect(guardado.expandidos).toEqual(expect.arrayContaining(['g:etapa:cotizada', 'o:2']));
    unmount();

    await montar();
    expect(screen.getByRole('radio', { name: 'Etapa' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Filtrar por marca')).toHaveValue('AXIS');
    expect(screen.getByRole('button', { name: /Ganada/ })).toHaveAttribute('aria-pressed', 'true');
    expect(fila('g:etapa:cotizada')).toHaveAttribute('aria-expanded', 'true');
    expect(fila('o:2')).toHaveAttribute('aria-expanded', 'true');
    expect(idsFilas()).toContain('c:503');
  });

  test('la búsqueda no se guarda como preferencia', async () => {
    await montar();
    buscar('acme');
    expect(JSON.parse(window.localStorage.getItem('crmArbol'))).not.toHaveProperty('busqueda');
  });

  test('Desplegar todo y Plegar todo', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar todo' }));
    expect(idsFilas()).toEqual([
      'g:empresa:10', 'o:1', 'c:501', 'c:502', 'o:2', 'c:503', 'g:empresa:12', 'o:5', 'g:empresa:11', 'o:4', 'c:504'
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Plegar todo' }));
    expect(idsFilas()).toEqual(['g:empresa:10', 'g:empresa:12', 'g:empresa:11']);
  });

  test('Plegar todo también pliega lo que abrió la búsqueda', async () => {
    await montar();
    buscar('pid-77');
    await waitFor(() => expect(idsFilas()).toContain('c:501'));
    fireEvent.click(screen.getByRole('button', { name: 'Plegar todo' }));
    expect(idsFilas()).toEqual(['g:empresa:10']);
  });

  test('avisa cuando el servidor truncó la lista', async () => {
    const datos = { ...copia(), truncado: true, total_oportunidades: 5000 };
    await montar({}, datos);
    expect(screen.getByRole('status')).toHaveTextContent('Se muestran las 6 oportunidades más recientes de 5000');
  });

  test('sin datos muestra el estado vacío', async () => {
    crmApi.arbol.mockResolvedValue({ oportunidades: [], cotizaciones: [], total_oportunidades: 0, truncado: false });
    renderConQuery(<ArbolTab />);
    expect(await screen.findByText('Aún no hay oportunidades')).toBeInTheDocument();
    expect(screen.queryByRole('treegrid')).not.toBeInTheDocument();
  });

  test('muestra esqueleto mientras carga', () => {
    crmApi.arbol.mockReturnValue(new Promise(() => {}));
    renderConQuery(<ArbolTab />);
    expect(screen.getByRole('status', { name: 'Cargando' })).toBeInTheDocument();
  });

  test('un error del servidor se muestra y se puede reintentar', async () => {
    crmApi.arbol.mockRejectedValueOnce(new Error('Servidor caído'));
    renderConQuery(<ArbolTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor caído');
    crmApi.arbol.mockResolvedValue(copia());
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('treegrid', { name: 'Árbol del CRM' })).toBeInTheDocument();
    expect(crmApi.arbol).toHaveBeenCalledTimes(2);
  });

  test('el buscador usa la referencia que le pasan y el texto de ayuda', async () => {
    const ref = React.createRef();
    await montar({ inputBusquedaRef: ref });
    expect(ref.current).toBe(screen.getByRole('searchbox'));
    expect(ref.current).toHaveAttribute('placeholder', 'Buscar empresa, oportunidad, BO, N° de cotización, proyecto o PID  ( / )');
  });

  test('dibuja como máximo 300 filas y ofrece "Mostrar 300 más"', async () => {
    const oportunidades = Array.from({ length: 350 }, (_, i) =>
      opArbol({ id: i + 1, titulo: `Op ${i + 1}`, empresa_id: i + 1, empresa_nombre: `Empresa ${String(i + 1).padStart(3, '0')}`, monto: 1000 - i, cotizaciones: 0 })
    );
    await montar({}, { oportunidades, cotizaciones: [], total_oportunidades: 350, truncado: false });
    expect(idsFilas()).toHaveLength(300);
    expect(screen.getByText('Se muestran 300 de 350 filas.')).toBeInTheDocument();
    // El pie cuenta todo, no solo lo dibujado.
    expect(screen.getByText(/350 empresas · 350 oportunidades/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 300 más' }));
    expect(idsFilas()).toHaveLength(350);
    expect(screen.queryByRole('button', { name: 'Mostrar 300 más' })).not.toBeInTheDocument();
  });

  test('End salta a la última fila aunque no esté dibujada todavía', async () => {
    const oportunidades = Array.from({ length: 350 }, (_, i) =>
      opArbol({ id: i + 1, empresa_id: i + 1, empresa_nombre: `Empresa ${String(i + 1).padStart(3, '0')}`, monto: 1000 - i, cotizaciones: 0 })
    );
    await montar({}, { oportunidades, cotizaciones: [], total_oportunidades: 350, truncado: false });
    const primera = fila('g:empresa:1');
    primera.focus();
    fireEvent.keyDown(primera, { key: 'End' });
    expect(document.activeElement).toBe(fila('g:empresa:350'));
    expect(idsFilas()).toHaveLength(350);
  });

  test('datos sucios no rompen la pantalla', async () => {
    const datos = {
      oportunidades: [
        opArbol({ id: 1, monto: null, empresa_nombre: null, empresa_id: null, dias_en_etapa: null, contacto_nombre: null, marca: null }),
        opArbol({ id: 2, monto: 'abc', empresa_nombre: null, empresa_id: null })
      ],
      cotizaciones: [{ id: 9, numero: 1, version: null, total: null, oportunidad_id: 1, created_at: 'basura' }, { id: 10, numero: 2, oportunidad_id: 999 }]
    };
    await montar({}, datos);
    expect(within(fila('g:empresa:sin')).getByText('Sin empresa')).toBeInTheDocument();
    expect(within(fila('g:empresa:sin')).queryByRole('button', { name: /Ficha/ })).not.toBeInTheDocument();
    fireEvent.click(fila('g:empresa:sin'));
    fireEvent.click(fila('o:1'));
    expect(within(fila('o:1')).getByText('—', { selector: '.mq-arbol-dias' })).toBeInTheDocument();
    expect(idsFilas()).toContain('c:9');
    expect(idsFilas()).not.toContain('c:10');
  });
});
