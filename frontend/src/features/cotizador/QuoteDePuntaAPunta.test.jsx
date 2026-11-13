// Quote de fabricante de punta a punta, con el modal VERDADERO: se adjunta el PDF, lo "lee" la
// cola de la miniPC (API simulada), se revisa la tabla, pasa al carrito y se guarda. También
// cubre duplicar una cotización que ya tiene líneas de quote.
// QuoteEnCarrito.test.jsx prueba el carrito con el modal simulado; aquí se prueba el encaje real.
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';

// La cola del asistente (lo que atiende la miniPC), simulada.
const iaAPI = vi.hoisted(() => ({ iniciar: vi.fn(), obtener: vi.fn(), cancelar: vi.fn() }));

vi.mock('../../api', async () => {
  const base = await (await import('../ordenes/arnesOrdenes.testutil.jsx')).crearApiMock();
  return { ...base, iaAPI: { ...base.iaAPI, ...iaAPI } };
});

import { api, precalentar, prepararApi, renderApp, ADMIN } from '../ordenes/arnesOrdenes.testutil.jsx';
import { queryClient } from '../../app/queryClient';

// leerQuote consulta la cola cada 2 s de verdad: cada lectura tarda eso como mínimo.
vi.setConfig({ testTimeout: 40000 });

const esperarCotizador = async () => {
  await waitFor(() => expect(screen.queryAllByRole('heading', { level: 2, name: 'Cotización' }).length).toBeGreaterThan(0));
};

// La tabla de escritorio del carrito (también se renderizan las tarjetas móviles).
const filasDelCarrito = () => within(screen.getAllByRole('table')[0]).getAllByRole('row').slice(1);

const respuestaDelLector = (quote) => ({
  estado: 'lista',
  texto: `Listo, leí el quote.\n\`\`\`json\n${JSON.stringify(quote)}\n\`\`\``
});

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  queryClient.clear();
  prepararApi();
  iaAPI.iniciar.mockReset().mockResolvedValue({ id: 'q1' });
  iaAPI.obtener.mockReset();
  iaAPI.cancelar.mockReset().mockResolvedValue(undefined);
});

describe('Quote de fabricante de punta a punta', () => {
  it('Milestone: del PDF al carrito y a la cotización guardada, cada línea con su recargo', async () => {
    iaAPI.obtener.mockResolvedValue(
      respuestaDelLector({
        moneda: 'USD',
        descuento_global_pct: null,
        lineas: [
          { mpn: 'XPCODL', descripcion: 'XProtect Corporate Device License', cantidad: 10, costo_unitario: 250, total_linea: 2500 },
          { mpn: 'HE350T-16TB', descripcion: 'Husky IVO 350T 16TB', cantidad: 1, costo_unitario: 4300.5, total_linea: 4300.5 }
        ],
        notas: ''
      })
    );
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();

    fireEvent.click(await screen.findByRole('button', { name: /Cargar quote/ }));
    const modal = await screen.findByRole('dialog', { name: 'Cargar quote de fabricante' });
    fireEvent.click(within(modal).getByRole('radio', { name: 'Milestone' }));
    const pdf = new File(['%PDF-1.4 quote'], 'quote-milestone.pdf', { type: 'application/pdf' });
    fireEvent.change(within(modal).getByLabelText('Elegir archivo del quote'), { target: { files: [pdf] } });

    // La consulta sale a la cola como quote de Milestone, con el PDF adjunto.
    await waitFor(() => expect(iaAPI.iniciar).toHaveBeenCalledTimes(1));
    expect(iaAPI.iniciar.mock.calls[0][0].pantallazo).toMatchObject({
      campo: 'quote',
      fabricante: 'MILESTONE',
      mime: 'application/pdf'
    });
    expect(iaAPI.iniciar.mock.calls[0][0].pantallazo.datos.length).toBeGreaterThan(0);

    // Tabla de revisión: la licencia va al 0 % y el Husky al 12 %.
    await within(modal).findByLabelText('MPN línea 2', {}, { timeout: 10000 });
    expect(within(modal).getByLabelText('MPN línea 1')).toHaveValue('XPCODL');
    expect(within(modal).getByLabelText('Tipo línea 1')).toHaveValue('licencia');
    expect(within(modal).getByLabelText('Tipo línea 2')).toHaveValue('servidor');
    expect(within(modal).getByLabelText('Mi costo USD línea 2')).toHaveValue('4300,50');
    expect(within(modal).getByText('4.816,56')).toBeInTheDocument(); // 4300,50 x 1,12
    expect(within(modal).getByText('5.235,39')).toBeInTheDocument(); // 4816,56 / 0,92

    fireEvent.click(within(modal).getByRole('button', { name: 'Agregar 2 al carrito' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cargar quote de fabricante' })).not.toBeInTheDocument());

    // Carrito: mismas cantidades y precios que mostró el modal.
    const [licencia, servidor] = filasDelCarrito();
    expect(within(licencia).getByLabelText('Cantidad')).toHaveValue('10');
    expect(within(licencia).getByLabelText('Precio unitario')).toHaveValue('271.74'); // 250 / 0,92
    expect(within(licencia).getByText('Quote Milestone · licencia')).toBeInTheDocument();
    expect(within(servidor).getByLabelText('Cantidad')).toHaveValue('1');
    expect(within(servidor).getByLabelText('Precio unitario')).toHaveValue('5235.39');
    expect(within(servidor).getByText('Quote Milestone · servidor')).toBeInTheDocument();
    expect(within(servidor).getByText(/Costo fabricante \$4,300\.50 \+ 12 %/)).toBeInTheDocument();

    // Guardar: cada línea viaja con su origen de costo y el costo del fabricante.
    fireEvent.click(await screen.findByRole('button', { name: 'Generar cotización' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generar igual' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar cotización' }));
    await waitFor(() => expect(api.cotizacionesAPI.create).toHaveBeenCalledTimes(1));
    const { items, total } = api.cotizacionesAPI.create.mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ origen: 'MILESTONE', marca: 'Milestone', sku: 'To Create', mpn: 'XPCODL', precio_disty: 250, gp: 0.08, cantidad: 10 });
    expect(items[1]).toMatchObject({ origen: 'MILESTONE_HW', marca: 'Milestone', sku: 'To Create', mpn: 'HE350T-16TB', precio_disty: 4300.5, gp: 0.08, cantidad: 1 });
    expect(items[0].costo_unitario).toBeCloseTo(250, 6);
    expect(items[1].costo_unitario).toBeCloseTo(4816.56, 6);
    expect(items[0].precio_unitario).toBeCloseTo(250 / 0.92, 6);
    expect(items[1].precio_unitario).toBeCloseTo(4816.56 / 0.92, 6);
    expect(total).toBeCloseTo((250 / 0.92) * 10 + 4816.56 / 0.92, 6);
  });

  it('ISS con descuento global y una línea sin costo: avisa, no deja incluirla y agrega solo la buena', async () => {
    iaAPI.obtener.mockResolvedValue(
      respuestaDelLector({
        moneda: 'USD',
        descuento_global_pct: 10,
        lineas: [
          { mpn: 'SOS-ENT', descripcion: 'SecurOS Enterprise', cantidad: 2, costo_unitario: 80.5, total_linea: 161 },
          { mpn: 'SOS-SVC', descripcion: 'Servicio de puesta en marcha', cantidad: 1, costo_unitario: null, total_linea: null }
        ],
        notas: ''
      })
    );
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarCotizador();

    fireEvent.click(await screen.findByRole('button', { name: /Cargar quote/ }));
    const modal = await screen.findByRole('dialog', { name: 'Cargar quote de fabricante' });
    fireEvent.click(within(modal).getByRole('radio', { name: 'ISS' }));
    const imagen = new File(['png'], 'quote-iss.png', { type: 'image/png' });
    fireEvent.change(within(modal).getByLabelText('Elegir archivo del quote'), { target: { files: [imagen] } });

    await within(modal).findByLabelText('MPN línea 2', {}, { timeout: 10000 });
    expect(within(within(modal).getByRole('list', { name: 'Avisos del lector' })).getByText(/descuento global de 10% que NO está aplicado/)).toBeInTheDocument();
    expect(within(modal).getByLabelText('Incluir línea 1')).toBeChecked();
    expect(within(modal).getByLabelText('Incluir línea 2')).toBeDisabled();
    expect(within(modal).getByText('sin costo')).toBeInTheDocument();
    expect(within(modal).getByText('92,58')).toBeInTheDocument(); // 80,50 x 1,15, al centavo

    fireEvent.click(within(modal).getByRole('button', { name: 'Agregar 1 al carrito' }));
    await waitFor(() => expect(filasDelCarrito()).toHaveLength(1));
    const fila = filasDelCarrito()[0];
    expect(within(fila).getByLabelText('Cantidad')).toHaveValue('2');
    expect(within(fila).getByLabelText('Precio unitario')).toHaveValue('100.63'); // 92,58 / 0,92
    expect(within(fila).getByText(/Costo fabricante \$80\.50 \+ 15 %/)).toBeInTheDocument();
  });

  it('duplicar una cotización conserva sus líneas de quote con el costo del fabricante', async () => {
    api.cotizacionesAPI.getAll.mockResolvedValue([
      {
        id: 77,
        numero: 77,
        cliente_nombre: 'Ana',
        cliente_empresa: 'Acme SA',
        cliente_email: 'PID-1',
        cliente_telefono: 'Proyecto Sur',
        total: 496.74,
        estado: 'enviada',
        created_at: new Date().toISOString(),
        items: [
          { id: 1, producto_id: null, marca: 'ISS', sku: 'To Create', mpn: 'SOS-ENT', descripcion: 'SecurOS Enterprise', origen: 'ISS', precio_disty: 100, gp: 0.08, costo_unitario: 115, cantidad: 3, precio_unitario: 125, precio_total: 375 },
          { id: 2, producto_id: null, marca: 'Milestone', sku: 'To Create', mpn: 'HE350T', descripcion: 'Husky IVO 350T', origen: 'MILESTONE_HW', precio_disty: 100, gp: 0.08, costo_unitario: 112, cantidad: 1, precio_unitario: 121.74, precio_total: 121.74 }
        ]
      }
    ]);
    renderApp({ user: ADMIN, ruta: '/historial' });

    fireEvent.click((await screen.findAllByRole('button', { name: 'Duplicar' }, { timeout: 10000 }))[0]);
    await esperarCotizador();
    await waitFor(() => expect(filasDelCarrito()).toHaveLength(2));
    const [iss, husky] = filasDelCarrito();
    expect(within(iss).getByLabelText('Cantidad')).toHaveValue('3');
    expect(within(iss).getByLabelText('Precio unitario')).toHaveValue('125.00');
    expect(within(iss).getByText('Quote ISS')).toBeInTheDocument();
    expect(within(husky).getByLabelText('Precio unitario')).toHaveValue('121.74');
    expect(within(husky).getByText('Quote Milestone · servidor')).toBeInTheDocument();
    // Ya no se informan como "sin catálogo".
    expect(screen.queryByText(/Sin catálogo/)).not.toBeInTheDocument();
  });
});
