// La página (CotizadorPage) es UNA sola instancia mientras se navega entre vistas.
// Estos tests miden lo que eso evita (descargas repetidas, renders de más) y la regla de
// frescura del catálogo y del stock, que antes resolvía el remontaje en cada clic.
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('../ordenes/arnesOrdenes.testutil.jsx')).crearApiMock());

// Sonda: canManageCotizadorStock se llama en el cuerpo de CotizadorPage en cada render y en
// ningún otro componente (mismo recurso que AislamientoOrdenes.test.jsx).
const sonda = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../cotizador/cotizadorHelpers', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    canManageCotizadorStock: (...args) => {
      sonda.renders += 1;
      return real.canManageCotizadorStock(...args);
    }
  };
});

import {
  precalentar, api, prepararApi, renderApp, irAVista, escribir, ADMIN
} from '../ordenes/arnesOrdenes.testutil.jsx';
import { VIDA_UTIL_DATOS_MS } from '../cotizador/frescura';

const MIN = 60 * 1000;

// Espera a que termine lo que quedó en vuelo (cargas, efectos) antes de contar llamadas.
const asentar = () => act(() => new Promise(resolver => setTimeout(resolver, 300)));

const hayEncabezado = (nombre) => () => screen.queryAllByRole('heading', { level: 2, name: nombre }).length > 0;
const esperarVista = (nombre) => waitFor(() => expect(hayEncabezado(nombre)()).toBe(true));
const esperarOrdenes = () => screen.findByRole('button', { name: 'BO BO-1001' });

const PLACEHOLDER_BUSCADOR = /Buscar por SKU, MPN o modelo/;
const buscadorCatalogo = () => screen.findByPlaceholderText(PLACEHOLDER_BUSCADOR);

const limpiarLlamadas = () => {
  Object.values(api).forEach(grupo => Object.values(grupo).forEach(fn => fn.mockClear()));
  sonda.renders = 0;
};
const llamadas = (fn) => fn.mock.calls.length;

// Paso del tiempo sin esperar de verdad: Date.now avanza `desfase` ms (lo usan la página y
// React Query para saber qué tan viejo es un dato).
let desfase = 0;
const avanzar = (ms) => { desfase += ms; };

// Estado de visibilidad de la pestaña.
let visibilidad = 'visible';
const cambiarVisibilidad = (estado) => {
  visibilidad = estado;
  document.dispatchEvent(new Event('visibilitychange'));
};

const PRODUCTO = {
  id: 1, origen: 'QNAP', marca: 'QNAP', sku: 'TS-464', mpn: 'TS-464-4G',
  descripcion: 'NAS cuatro bahias', precio_disty: 500, gp: 0.15, tiempo_entrega: '7 dias'
};
const STOCK = { items: [{ mpn: 'TS-464-4G', quantity: 5 }] };

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  prepararApi();
  desfase = 0;
  visibilidad = 'visible';
  const ahoraReal = Date.now.bind(Date);
  vi.spyOn(Date, 'now').mockImplementation(() => ahoraReal() + desfase);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilidad });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete document.visibilityState;
});

describe('Navegar entre vistas no desmonta la página ni repite descargas', () => {
  it('Órdenes → Dashboard → Órdenes: sin catálogo ni stock, una descarga por entrada y la página sigue montada', async () => {
    renderApp({ user: ADMIN, ruta: '/admin/ordenes' });
    await esperarOrdenes();
    await asentar();
    // Carga inicial: el catálogo y el stock se bajan una vez.
    expect(llamadas(api.productosAPI.getAll)).toBe(1);
    expect(llamadas(api.stockAPI.getAll)).toBe(1);

    // Un nodo del menú: si la página se desmontara, dejaría de estar en el documento.
    const testigo = [
      ...screen.queryAllByRole('menuitem', { name: 'Dashboard' }),
      ...screen.queryAllByRole('button', { name: 'Dashboard' })
    ][0];
    expect(testigo.isConnected).toBe(true);

    limpiarLlamadas();
    await irAVista('Dashboard');
    await esperarVista('Dashboard');
    await asentar();
    expect(testigo.isConnected).toBe(true);
    const rendersAlDashboard = sonda.renders;
    // El catálogo y el stock NO se vuelven a bajar al cambiar de vista.
    expect(llamadas(api.productosAPI.getAll)).toBe(0);
    expect(llamadas(api.stockAPI.getAll)).toBe(0);
    // Cada dato del Dashboard se pide una vez (no dos).
    expect(llamadas(api.osoAPI.getOrders)).toBe(1);
    expect(llamadas(api.boMetaAPI.getAll)).toBe(1);
    expect(llamadas(api.usuariosAPI.getAll)).toBe(1);
    expect(llamadas(api.productosAPI.getSyncStatus)).toBe(1);
    // Las cotizaciones son dos consultas distintas (con y sin ítems), cada una una vez.
    const porForma = api.cotizacionesAPI.getAll.mock.calls.map(args => JSON.stringify(args));
    expect(porForma).toHaveLength(2);
    expect(new Set(porForma).size).toBe(2);

    limpiarLlamadas();
    await irAVista('Órdenes activas');
    await esperarOrdenes();
    await asentar();
    expect(testigo.isConnected).toBe(true);
    const rendersAOrdenes = sonda.renders;
    expect(llamadas(api.productosAPI.getAll)).toBe(0);
    expect(llamadas(api.stockAPI.getAll)).toBe(0);
    expect(llamadas(api.osoAPI.getOrders)).toBe(1);
    expect(llamadas(api.boMetaAPI.getAll)).toBe(1);
    expect(llamadas(api.cotizacionesAPI.getAll)).toBe(0);
    expect(llamadas(api.usuariosAPI.getAll)).toBe(0);

    // Antes de la ruta única: 13 renders de la página al Dashboard y 8 al volver a Órdenes
    // (ahora 7 y 3): el margen cubre variaciones menores, no un regreso al remontaje.
    expect(rendersAlDashboard).toBeLessThanOrEqual(10);
    expect(rendersAOrdenes).toBeLessThanOrEqual(5);
  });

  it('el borrador de búsqueda del Cotizador se conserva al ir a otra vista y volver', async () => {
    api.productosAPI.getAll.mockResolvedValue([PRODUCTO]);
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    const buscador = await buscadorCatalogo();
    escribir(buscador, 'TS-464');
    await irAVista('Dashboard');
    await esperarVista('Dashboard');
    await irAVista('Cotizador');
    await esperarVista('Cotización');
    expect(await buscadorCatalogo()).toHaveValue('TS-464');
  });
});

describe('Frescura del catálogo y del stock', () => {
  it('la vida útil es de 2 minutos', () => {
    expect(VIDA_UTIL_DATOS_MS).toBe(2 * MIN);
  });

  it('abrir directo el Cotizador baja el catálogo y el stock una sola vez', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarVista('Cotización');
    await asentar();
    expect(llamadas(api.productosAPI.getAll)).toBe(1);
    expect(llamadas(api.stockAPI.getAll)).toBe(1);
  });

  it('entrar al Cotizador con datos de hace más de 2 minutos recarga catálogo y stock', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await esperarVista('Dashboard');
    await asentar();
    limpiarLlamadas();
    avanzar(3 * MIN);
    await irAVista('Cotizador');
    await esperarVista('Cotización');
    await waitFor(() => {
      expect(llamadas(api.productosAPI.getAll)).toBe(1);
      expect(llamadas(api.stockAPI.getAll)).toBe(1);
    });
  });

  it('entrar al Cotizador con datos recientes no recarga nada', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await esperarVista('Dashboard');
    await asentar();
    limpiarLlamadas();
    avanzar(90 * 1000);
    await irAVista('Cotizador');
    await esperarVista('Cotización');
    await asentar();
    expect(llamadas(api.productosAPI.getAll)).toBe(0);
    expect(llamadas(api.stockAPI.getAll)).toBe(0);
  });

  it('entrar a Stock con datos vencidos recarga; el clic entre vistas recientes no', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await esperarVista('Dashboard');
    await asentar();
    limpiarLlamadas();
    avanzar(3 * MIN);
    await irAVista('Stock disponible');
    await esperarVista('Stock disponible');
    await waitFor(() => {
      expect(llamadas(api.productosAPI.getAll)).toBe(1);
      expect(llamadas(api.stockAPI.getAll)).toBe(1);
    });
    expect(llamadas(api.stockAPI.getCatalog)).toBe(1);

    // Recién recargado: ir y venir entre vistas no vuelve a pedir nada.
    limpiarLlamadas();
    await irAVista('Cotizador');
    await esperarVista('Cotización');
    await irAVista('Dashboard');
    await esperarVista('Dashboard');
    await irAVista('Stock disponible');
    await esperarVista('Stock disponible');
    await asentar();
    expect(llamadas(api.productosAPI.getAll)).toBe(0);
    expect(llamadas(api.stockAPI.getAll)).toBe(0);
  });

  it('volver a la pestaña con datos de hace más de 2 minutos recarga; con datos recientes no; oculta tampoco', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await esperarVista('Dashboard');
    await asentar();

    limpiarLlamadas();
    avanzar(60 * 1000);
    cambiarVisibilidad('visible');
    await asentar();
    expect(llamadas(api.productosAPI.getAll)).toBe(0);
    expect(llamadas(api.stockAPI.getAll)).toBe(0);

    avanzar(3 * MIN);
    cambiarVisibilidad('hidden');
    await asentar();
    expect(llamadas(api.productosAPI.getAll)).toBe(0);
    expect(llamadas(api.stockAPI.getAll)).toBe(0);

    cambiarVisibilidad('visible');
    await waitFor(() => {
      expect(llamadas(api.productosAPI.getAll)).toBe(1);
      expect(llamadas(api.stockAPI.getAll)).toBe(1);
    });

    // Recién recargado: otro cambio de visibilidad no repite.
    limpiarLlamadas();
    cambiarVisibilidad('visible');
    await asentar();
    expect(llamadas(api.productosAPI.getAll)).toBe(0);
    expect(llamadas(api.stockAPI.getAll)).toBe(0);
  });

  it('sin sesión no se recarga nada al volver a la pestaña', async () => {
    renderApp({ user: null, ruta: '/dashboard' });
    await screen.findByRole('heading', { name: 'Ingresar' });
    limpiarLlamadas();
    avanzar(5 * MIN);
    cambiarVisibilidad('visible');
    await asentar();
    expect(llamadas(api.productosAPI.getAll)).toBe(0);
    expect(llamadas(api.stockAPI.getAll)).toBe(0);
  });

  describe('la recarga en segundo plano no molesta a quien está trabajando', () => {
    const prepararCotizador = async () => {
      api.productosAPI.getAll.mockResolvedValue([PRODUCTO]);
      api.stockAPI.getAll.mockResolvedValue(STOCK);
      renderApp({ user: ADMIN, ruta: '/cotizador' });
      const buscador = await buscadorCatalogo();
      // Producto al carrito con el buscador.
      escribir(buscador, 'TS-464');
      fireEvent.click(await screen.findByRole('option', { name: /TS-464/ }));
      await screen.findByText(/Agregado TS-464/);
      await asentar();
      // Una búsqueda a medio escribir.
      escribir(screen.getByPlaceholderText(PLACEHOLDER_BUSCADOR), 'NAS');
      return screen.getByPlaceholderText(PLACEHOLDER_BUSCADOR);
    };

    it('mientras llega la respuesta no hay esqueleto y el carrito, la búsqueda y el catálogo siguen igual', async () => {
      const buscador = await prepararCotizador();
      expect(await screen.findByRole('option', { name: /disp\./ })).toBeInTheDocument();
      let responder;
      api.productosAPI.getAll.mockReturnValue(new Promise(resolver => { responder = resolver; }));
      limpiarLlamadas();
      avanzar(3 * MIN);
      cambiarVisibilidad('visible');
      await waitFor(() => expect(llamadas(api.productosAPI.getAll)).toBe(1));

      // En vuelo: nada cambia en pantalla.
      expect(screen.getByPlaceholderText(PLACEHOLDER_BUSCADOR)).toBe(buscador);
      expect(buscador).toHaveValue('NAS');
      expect(screen.getByText(/×1 en carrito/)).toBeInTheDocument();
      expect(screen.queryByText(/Cargando/)).not.toBeInTheDocument();
      expect(screen.getByRole('option', { name: /disp\./ })).toBeInTheDocument();

      // Llega el catálogo con un producto más: se suma sin tocar lo demás.
      await act(async () => {
        responder([PRODUCTO, { ...PRODUCTO, id: 2, sku: 'TS-664', mpn: 'TS-664-8G', descripcion: 'NAS seis bahias' }]);
      });
      expect(await screen.findByRole('option', { name: /TS-664/ })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(PLACEHOLDER_BUSCADOR)).toHaveValue('NAS');
      expect(screen.getByText(/×1 en carrito/)).toBeInTheDocument();
    });

    it('si la recarga falla se queda con el catálogo y el stock que ya tenía', async () => {
      await prepararCotizador();
      expect(await screen.findByRole('option', { name: /disp\./ })).toBeInTheDocument();
      api.productosAPI.getAll.mockRejectedValue(new Error('sin red'));
      api.stockAPI.getAll.mockRejectedValue(new Error('sin red'));
      const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
      limpiarLlamadas();
      avanzar(3 * MIN);
      cambiarVisibilidad('visible');
      await waitFor(() => {
        expect(llamadas(api.productosAPI.getAll)).toBe(1);
        expect(llamadas(api.stockAPI.getAll)).toBe(1);
      });
      await asentar();
      errores.mockRestore();
      expect(screen.getByPlaceholderText(PLACEHOLDER_BUSCADOR)).toHaveValue('NAS');
      expect(screen.getByText(/×1 en carrito/)).toBeInTheDocument();
      // El stock sigue mostrándose: un fallo en segundo plano no lo borra.
      expect(screen.getByRole('option', { name: /disp\./ })).toBeInTheDocument();
      // Y como no hubo carga exitosa, la próxima oportunidad vuelve a intentar.
      limpiarLlamadas();
      api.productosAPI.getAll.mockResolvedValue([PRODUCTO]);
      api.stockAPI.getAll.mockResolvedValue(STOCK);
      cambiarVisibilidad('visible');
      await waitFor(() => {
        expect(llamadas(api.productosAPI.getAll)).toBe(1);
        expect(llamadas(api.stockAPI.getAll)).toBe(1);
      });
    });

    it('una recarga que termina después de cerrar sesión no vuelve a llenar la pantalla', async () => {
      await prepararCotizador();
      let responder;
      api.productosAPI.getAll.mockReturnValue(new Promise(resolver => { responder = resolver; }));
      // Cerrar sesión cancela la consulta en vuelo y la página lo registra con console.error.
      const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
      avanzar(3 * MIN);
      cambiarVisibilidad('visible');
      await waitFor(() => expect(llamadas(api.productosAPI.getAll)).toBeGreaterThan(0));
      fireEvent.click((await screen.findAllByRole('menuitem', { name: 'Cerrar sesión' }))[0]);
      await screen.findByRole('heading', { name: 'Ingresar' });
      await act(async () => { responder([PRODUCTO]); });
      await asentar();
      errores.mockRestore();
      expect(screen.queryByText(/×1 en carrito/)).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /TS-464/ })).not.toBeInTheDocument();
    });
  });
});
