import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import MapaTab from './MapaTab';
import { crmApi } from './crmApi';
import { opArbol, renderConQuery } from './fixturesCrm';

vi.mock('./crmApi', () => ({
  crmApi: {
    arbol: vi.fn()
  }
}));

const HOY = '2026-11-19';

// Datos propios del mapa: cada oportunidad lleva `proximo_seguimiento` y `seguimiento_nota`.
const op = (extra) =>
  opArbol({ cotizaciones: 0, cotizacion_id: null, cotizacion_numero: null, contacto_nombre: null, proximo_seguimiento: null, seguimiento_nota: null, ...extra });

const DATOS = {
  oportunidades: [
    op({ id: 1, titulo: 'Cámaras bodega', etapa: 'cotizada', marca: 'AXIS', monto: 35800, proximo_seguimiento: '2026-11-16', seguimiento_nota: 'Llamar a Ana', es_proyecto: true, bo: 'BO-77' }),
    op({ id: 2, titulo: 'NAS Norte', etapa: 'negociacion', marca: 'QNAP', monto: 12400, proximo_seguimiento: '2026-11-24' }),
    op({ id: 3, titulo: 'Storage respaldo', etapa: 'cotizada', marca: 'AXIS', monto: 14200, empresa_id: 12, empresa_nombre: 'Gamma Corp', proximo_seguimiento: HOY }),
    op({ id: 4, titulo: 'Licencias VMS', etapa: 'nueva', marca: 'MIXTA', monto: 7700, empresa_id: 12, empresa_nombre: 'Gamma Corp', proximo_seguimiento: '2026-11-20' }),
    // Sin los campos nuevos (undefined): se trata igual que null.
    (() => {
      const o = op({ id: 5, titulo: 'Switches Beta', etapa: 'nueva', marca: null, monto: 7150, empresa_id: 11, empresa_nombre: 'Beta Ltda' });
      delete o.proximo_seguimiento;
      delete o.seguimiento_nota;
      return o;
    })(),
    op({ id: 6, titulo: 'Orden cerrada', etapa: 'ganada', marca: 'AXIS', monto: 9300, empresa_id: 11, empresa_nombre: 'Beta Ltda', proximo_seguimiento: '2026-11-01' }),
    op({ id: 7, titulo: 'Proyecto sin monto', etapa: 'nueva', marca: 'QNAP', monto: 0, empresa_id: 13, empresa_nombre: 'Delta SpA' })
  ],
  cotizaciones: [],
  total_oportunidades: 7,
  truncado: false
};

const copia = () => JSON.parse(JSON.stringify(DATOS));
const tarjeta = (id) => document.querySelector(`[data-oportunidad-id="${id}"]`);
const idsTarjetas = () => [...document.querySelectorAll('[data-oportunidad-id]')].map((t) => t.dataset.oportunidadId);
const bloques = () => [...document.querySelectorAll('[data-grupo-id]')].map((b) => b.getAttribute('aria-label'));
const area = (el) => parseFloat(el.style.width) * parseFloat(el.style.height);
const leyenda = () => within(screen.getByRole('list', { name: 'Leyenda de colores' }));

const montar = async (props = {}, datos = copia()) => {
  crmApi.arbol.mockResolvedValue(datos);
  const r = renderConQuery(<MapaTab hoy={HOY} onAbrirEmpresa={() => {}} onAbrirOportunidad={() => {}} {...props} />);
  await waitFor(() => expect(document.querySelectorAll('[data-oportunidad-id]').length).toBeGreaterThan(0));
  return r;
};

const buscar = (texto) => fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en el mapa' }), { target: { value: texto } });

describe('MapaTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  test('muestra una tarjeta por oportunidad abierta con su aria-label completo', async () => {
    await montar();
    expect(idsTarjetas().sort()).toEqual(['1', '2', '3', '4', '5', '7']);
    expect(tarjeta(1)).toHaveAttribute('aria-label', 'Cámaras bodega, Acme SA, $35,800.00, Cotizada, seguimiento vencido hace 3 días');
    expect(tarjeta(2)).toHaveAttribute('aria-label', 'NAS Norte, Acme SA, $12,400.00, Negociación, seguimiento 24-nov');
    expect(tarjeta(3)).toHaveAttribute('aria-label', 'Storage respaldo, Gamma Corp, $14,200.00, Cotizada, seguimiento hoy');
    expect(tarjeta(4)).toHaveAttribute('aria-label', 'Licencias VMS, Gamma Corp, $7,700.00, Nueva, seguimiento mañana');
    expect(tarjeta(5)).toHaveAttribute('aria-label', 'Switches Beta, Beta Ltda, $7,150.00, Nueva, sin seguimiento');
    expect(tarjeta(1).tagName).toBe('BUTTON');
    expect(tarjeta(1)).toHaveAttribute('title', expect.stringContaining('Nota: Llamar a Ana'));
    expect(crmApi.arbol).toHaveBeenCalledTimes(1);
  });

  test('el orden del DOM (y de tabulación) es de mayor a menor: bloques y, dentro, tarjetas', async () => {
    await montar();
    expect(idsTarjetas()).toEqual(['1', '2', '3', '4', '5', '7']);
    expect(bloques()).toEqual([
      'Acme SA: 2 oportunidades, $48,200.00',
      'Gamma Corp: 2 oportunidades, $21,900.00',
      'Beta Ltda: 1 oportunidad, $7,150.00',
      'Delta SpA: 1 oportunidad, $0.00'
    ]);
  });

  test('el área es proporcional al monto (misma empresa) y la de mayor monto es la más grande', async () => {
    await montar();
    expect(area(tarjeta(1))).toBeGreaterThan(area(tarjeta(2)));
    expect(area(tarjeta(1))).toBeGreaterThan(area(tarjeta(5)));
    expect(area(tarjeta(1)) / area(tarjeta(2))).toBeCloseTo(35800 / 12400, 1);
    expect(area(tarjeta(3)) / area(tarjeta(4))).toBeCloseTo(14200 / 7700, 1);
    // Una oportunidad de $0 sigue siendo visible: tiene un tamaño mínimo.
    expect(area(tarjeta(7))).toBeGreaterThan(1500);
  });

  test('data-urgencia: vencida, hoy, mañana, futura, sin fecha y cerrada', async () => {
    await montar();
    expect(tarjeta(1)).toHaveAttribute('data-urgencia', 'vencido');
    expect(tarjeta(3)).toHaveAttribute('data-urgencia', 'hoy');
    expect(tarjeta(4)).toHaveAttribute('data-urgencia', 'manana');
    expect(tarjeta(2)).toHaveAttribute('data-urgencia', 'futuro');
    expect(tarjeta(5)).toHaveAttribute('data-urgencia', 'sin');
    expect(tarjeta(7)).toHaveAttribute('data-urgencia', 'sin');
    fireEvent.click(screen.getByRole('button', { name: /Ganada/ }));
    expect(tarjeta(6)).toHaveAttribute('data-urgencia', 'cerrada');
    expect(tarjeta(6)).toHaveAttribute('aria-label', 'Orden cerrada, Beta Ltda, $9,300.00, Ganada');
  });

  test('cada tarjeta lleva data-tamano y el contenido cambia con el tamaño', async () => {
    await montar();
    const grande = tarjeta(1);
    expect(grande).toHaveAttribute('data-tamano', 'xl');
    // xl: monto, etapa · marca, seguimiento, nota, BID y BO.
    expect(within(grande).getByText('$35,800.00')).toBeInTheDocument();
    expect(within(grande).getByText('Cotizada · AXIS')).toBeInTheDocument();
    expect(within(grande).getByText('Vencido hace 3 días')).toBeInTheDocument();
    expect(within(grande).getByText('«Llamar a Ana»')).toBeInTheDocument();
    expect(within(grande).getByText('BID')).toBeInTheDocument();
    expect(within(grande).getByText('BO-77')).toBeInTheDocument();
    // Agrupado por empresa no se repite la empresa en la tarjeta.
    expect(within(grande).queryByText('Acme SA')).not.toBeInTheDocument();
    // Las tarjetas chicas solo traen el monto abreviado y el punto.
    const chicas = [...document.querySelectorAll('[data-tamano="s"], [data-tamano="xs"]')];
    chicas.forEach((t) => expect(within(t).queryByText(/Cotizada|Nueva/)).not.toBeInTheDocument());
  });

  test('clic y Enter (o Espacio) en una tarjeta llaman onAbrirOportunidad con el id, una sola vez', async () => {
    const onAbrirOportunidad = vi.fn();
    await montar({ onAbrirOportunidad });
    fireEvent.click(tarjeta(2));
    expect(onAbrirOportunidad).toHaveBeenLastCalledWith(2);
    expect(onAbrirOportunidad).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(tarjeta(3), { key: 'Enter' });
    expect(onAbrirOportunidad).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(tarjeta(4), { key: ' ' });
    expect(onAbrirOportunidad).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(tarjeta(5), { key: 'a' });
    expect(onAbrirOportunidad).toHaveBeenCalledTimes(3);
  });

  test('la cabecera de la empresa abre su ficha y no abre la oportunidad', async () => {
    const onAbrirEmpresa = vi.fn();
    const onAbrirOportunidad = vi.fn();
    await montar({ onAbrirEmpresa, onAbrirOportunidad });
    fireEvent.click(screen.getByRole('button', { name: 'Ficha de Acme SA' }));
    expect(onAbrirEmpresa).toHaveBeenCalledWith(10);
    expect(onAbrirOportunidad).not.toHaveBeenCalled();
  });

  test('agrupar por etapa y por marca cambia los bloques', async () => {
    await montar();
    fireEvent.click(screen.getByRole('radio', { name: 'Etapa' }));
    // Con etapas: orden fijo del embudo, no por tamaño del bloque.
    expect(bloques()).toHaveLength(3);
    expect(bloques().sort()).toEqual([
      'Cotizada: 2 oportunidades, $50,000.00',
      'Negociación: 1 oportunidad, $12,400.00',
      'Nueva: 3 oportunidades, $14,850.00'
    ]);
    expect(screen.queryByRole('button', { name: /Ficha de/ })).not.toBeInTheDocument();
    // Agrupado por etapa la tarjeta sí nombra la empresa.
    expect(within(tarjeta(1)).getByText('Acme SA')).toBeInTheDocument();
    expect(screen.getByText(/3 etapas · 6 oportunidades/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Marca' }));
    expect(bloques().sort()).toEqual([
      'AXIS: 2 oportunidades, $50,000.00',
      'MIXTA: 1 oportunidad, $7,700.00',
      'QNAP: 2 oportunidades, $12,400.00',
      'Sin marca: 1 oportunidad, $7,150.00'
    ]);
    expect(screen.getByText(/4 marcas · 6 oportunidades/)).toBeInTheDocument();
  });

  test('cambiar "Color" cambia la leyenda y las clases', async () => {
    await montar();
    expect(leyenda().getByText('Vencido')).toBeInTheDocument();
    expect(leyenda().getByText('Hoy o mañana')).toBeInTheDocument();
    expect(leyenda().getByText('Más adelante')).toBeInTheDocument();
    expect(leyenda().getByText('Sin seguimiento')).toBeInTheDocument();
    expect(tarjeta(1)).toHaveClass('mq-mapa-c-vencido');
    expect(tarjeta(2)).toHaveClass('mq-mapa-c-futuro');
    expect(tarjeta(5)).toHaveClass('mq-mapa-c-sin');

    const selector = screen.getByRole('combobox', { name: 'Color de las tarjetas' });
    fireEvent.change(selector, { target: { value: 'etapa' } });
    expect(leyenda().getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Nueva', 'Cotizada', 'Negociación']);
    expect(tarjeta(1)).toHaveClass('mq-mapa-c-etapa-cotizada');
    expect(tarjeta(2)).toHaveClass('mq-mapa-c-etapa-negociacion');
    // En modo etapa, lo vencido igual lleva su punto rojo.
    expect(tarjeta(1).querySelector('.mq-punto-critico')).not.toBeNull();
    expect(tarjeta(2).querySelector('.mq-punto')).toBeNull();

    fireEvent.change(selector, { target: { value: 'marca' } });
    expect(leyenda().getAllByRole('listitem').map((li) => li.textContent)).toEqual(['AXIS', 'QNAP', 'MIXTA', 'Sin marca']);
    expect(tarjeta(1)).toHaveClass('mq-mapa-c-marca-axis');
    expect(tarjeta(5)).toHaveClass('mq-mapa-c-marca-sin');
    expect(tarjeta(3).querySelector('.mq-punto-aviso')).not.toBeNull();
  });

  test('en seguimiento: punto rojo, ámbar, verde y hueco según la urgencia', async () => {
    await montar();
    expect(tarjeta(1).querySelector('.mq-punto-critico')).not.toBeNull();
    expect(tarjeta(3).querySelector('.mq-punto-aviso')).not.toBeNull();
    expect(tarjeta(4).querySelector('.mq-punto-aviso')).not.toBeNull();
    expect(tarjeta(2).querySelector('.mq-punto-ok')).not.toBeNull();
    expect(tarjeta(5).querySelector('.mq-mapa-punto-hueco')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ganada/ }));
    expect(tarjeta(6).querySelector('.mq-punto')).toBeNull();
    expect(leyenda().getByText('Cerrada')).toBeInTheDocument();
  });

  test('los chips de seguimiento muestran cantidades y montos', async () => {
    await montar();
    const chips = within(screen.getByRole('group', { name: 'Filtrar por seguimiento' }));
    expect(chips.getByRole('button', { name: 'Todas 6' })).toHaveAttribute('aria-pressed', 'true');
    expect(chips.getByRole('button', { name: 'Vencidas 1 · $35,800.00' })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Hoy 1 · $14,200.00' })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Esta semana 3 · $34,300.00' })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Sin seguimiento 2 · $7,150.00' })).toBeInTheDocument();
  });

  test('un chip de seguimiento filtra, y los números no cambian', async () => {
    await montar();
    const chips = within(screen.getByRole('group', { name: 'Filtrar por seguimiento' }));
    fireEvent.click(chips.getByRole('button', { name: /^Vencidas/ }));
    expect(idsTarjetas()).toEqual(['1']);
    expect(chips.getByRole('button', { name: /^Vencidas/ })).toHaveAttribute('aria-pressed', 'true');
    expect(chips.getByRole('button', { name: 'Esta semana 3 · $34,300.00' })).toBeInTheDocument();
    fireEvent.click(chips.getByRole('button', { name: /^Esta semana/ }));
    expect(idsTarjetas().sort()).toEqual(['2', '3', '4']);
    fireEvent.click(chips.getByRole('button', { name: /^Sin seguimiento/ }));
    expect(idsTarjetas().sort()).toEqual(['5', '7']);
    fireEvent.click(chips.getByRole('button', { name: /^Todas/ }));
    expect(idsTarjetas()).toHaveLength(6);
  });

  test('los chips se calculan con búsqueda y marca aplicadas, antes del filtro de seguimiento', async () => {
    await montar();
    buscar('gamma');
    await waitFor(() => expect(idsTarjetas()).toEqual(['3', '4']));
    const chips = within(screen.getByRole('group', { name: 'Filtrar por seguimiento' }));
    expect(chips.getByRole('button', { name: 'Todas 2' })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Vencidas 0 · $0.00' })).toBeInTheDocument();
    expect(chips.getByRole('button', { name: 'Esta semana 2 · $21,900.00' })).toBeInTheDocument();
  });

  test('la búsqueda filtra por empresa u oportunidad y se limpia sola', async () => {
    await montar();
    buscar('licencias');
    await waitFor(() => expect(idsTarjetas()).toEqual(['4']));
    buscar('');
    await waitFor(() => expect(idsTarjetas()).toHaveLength(6));
    buscar('zzzz');
    expect(await screen.findByText('Ninguna oportunidad coincide con los filtros')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(idsTarjetas()).toHaveLength(7));
    expect(screen.getByRole('searchbox', { name: 'Buscar en el mapa' })).toHaveValue('');
  });

  test('el filtro de etapas y la marca filtran', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /^Nueva/ }));
    expect(idsTarjetas().sort()).toEqual(['1', '2', '3']);
    fireEvent.click(screen.getByRole('button', { name: /^Ganada/ }));
    expect(idsTarjetas().sort()).toEqual(['1', '2', '3', '6']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por marca' }), { target: { value: 'AXIS' } });
    expect(idsTarjetas().sort()).toEqual(['1', '3', '6']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por marca' }), { target: { value: 'SIN' } });
    expect(idsTarjetas()).toEqual([]);
  });

  test('si lo buscado existe en una etapa oculta, lo dice y ofrece verlas todas', async () => {
    await montar();
    buscar('Orden cerrada');
    expect(await screen.findByText('Nada en las etapas seleccionadas')).toBeInTheDocument();
    expect(screen.getByText('Hay 1 oportunidad que coincide en otras etapas.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas las etapas' }));
    await waitFor(() => expect(idsTarjetas()).toEqual(['6']));
  });

  test('guarda las preferencias (sin la búsqueda) y las restaura', async () => {
    const primera = await montar();
    fireEvent.click(screen.getByRole('radio', { name: 'Marca' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Color de las tarjetas' }), { target: { value: 'etapa' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por marca' }), { target: { value: 'AXIS' } });
    fireEvent.click(screen.getByRole('button', { name: /^Vencidas/ }));
    buscar('cámaras');
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem('crmMapa'))).toEqual({
        agruparPor: 'marca',
        colorPor: 'etapa',
        etapas: ['nueva', 'cotizada', 'negociacion'],
        marca: 'AXIS',
        seguimiento: 'vencido'
      })
    );
    expect(window.localStorage.getItem('crmMapa')).not.toMatch(/cámaras/i);
    primera.unmount();

    await montar();
    expect(screen.getByRole('radio', { name: 'Marca' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Color de las tarjetas' })).toHaveValue('etapa');
    expect(screen.getByRole('combobox', { name: 'Filtrar por marca' })).toHaveValue('AXIS');
    expect(screen.getByRole('button', { name: /^Vencidas/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox', { name: 'Buscar en el mapa' })).toHaveValue('');
    expect(idsTarjetas()).toEqual(['1']);
  });

  test('con preferencias inválidas usa los valores por defecto', async () => {
    window.localStorage.setItem('crmMapa', JSON.stringify({ agruparPor: 'zzz', colorPor: 'qqq', etapas: ['nada'], marca: 'XX', seguimiento: 'ayer' }));
    await montar();
    expect(screen.getByRole('radio', { name: 'Empresa' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Color de las tarjetas' })).toHaveValue('seguimiento');
    expect(idsTarjetas()).toHaveLength(7);
  });

  test('pie con totales y nota del tamaño mínimo', async () => {
    await montar();
    expect(screen.getByText('4 empresas · 6 oportunidades · $77,250.00')).toBeInTheDocument();
    expect(screen.getByText('La más chica se muestra con un tamaño mínimo para que se pueda ver y abrir.')).toBeInTheDocument();
  });

  test('sin tarjetas en el piso no hay nota', async () => {
    const datos = copia();
    datos.oportunidades = datos.oportunidades.filter((o) => o.id !== 7);
    await montar({}, datos);
    expect(screen.queryByText(/tamaño mínimo/)).not.toBeInTheDocument();
  });

  test('el alto sale del ancho medido: 1200 sin ResizeObserver, y menos de 640 es "angosto"', async () => {
    const r = await montar();
    expect(document.querySelector('.mq-mapa-lienzo')).toHaveStyle({ height: '600px' });
    r.unmount();

    class Observador {
      constructor(callback) { this.callback = callback; }
      observe() { this.callback([{ contentRect: { width: 600 } }]); }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', Observador);
    await montar();
    expect(document.querySelector('.mq-mapa-lienzo')).toHaveStyle({ height: '460px' });
  });

  test('aviso cuando los datos vienen truncados', async () => {
    await montar({}, { ...copia(), truncado: true, total_oportunidades: 40 });
    expect(screen.getByRole('status')).toHaveTextContent('Se muestran las 7 oportunidades más recientes de 40');
  });

  test('sin aviso cuando no están truncados', async () => {
    await montar();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('estado vacío cuando no hay oportunidades', async () => {
    crmApi.arbol.mockResolvedValue({ oportunidades: [], cotizaciones: [], total_oportunidades: 0, truncado: false });
    renderConQuery(<MapaTab hoy={HOY} />);
    expect(await screen.findByText('Aún no hay oportunidades')).toBeInTheDocument();
  });

  test('error de carga con reintento', async () => {
    crmApi.arbol.mockRejectedValueOnce(new Error('Servidor caído'));
    renderConQuery(<MapaTab hoy={HOY} />);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Servidor caído');
    crmApi.arbol.mockResolvedValue(copia());
    fireEvent.click(within(alerta).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(tarjeta(1)).not.toBeNull());
    expect(crmApi.arbol).toHaveBeenCalledTimes(2);
  });

  test('el buscador recibe la ref y trae el placeholder acordado', async () => {
    const ref = React.createRef();
    await montar({ inputBusquedaRef: ref });
    expect(ref.current).toBe(screen.getByRole('searchbox', { name: 'Buscar en el mapa' }));
    expect(ref.current).toHaveAttribute('placeholder', 'Buscar empresa, oportunidad, BO, N° de cotización, proyecto o PID  ( / )');
  });
});
