// Arnés compartido por los tests de caracterización de Órdenes, Compras y Dashboard.
// Renderiza la APLICACIÓN real (rutas incluidas) con la API mockeada y la sesión
// ya iniciada en localStorage, igual que como la ve el usuario.
//
// Uso en cada archivo de test (vi.mock se iza, por eso va escrito en el test):
//   vi.mock('../../api', async () => (await import('./arnesOrdenes.testutil.jsx')).crearApiMock());
import React from 'react';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import App from '../../App';
import { queryClient } from '../../app/queryClient';
import { Toaster } from '../ui/toast';

// La app carga cada ruta con lazy(): el primer render de cada archivo paga el import de
// la página entera (miles de líneas). Con la máquina cargada eso pasa del segundo que
// espera findBy por defecto, y el primer test fallaba 1 de cada 4 corridas completas.
// Dos resguardos: se importan los chunks antes de los tests (precalentar, en beforeAll)
// y las esperas tienen más margen.
configure({ asyncUtilTimeout: 3000 });

export const precalentar = () =>
  Promise.all([
    import('../cotizador/CotizadorPage'),
    import('../cotizador/views/DashboardView')
  ]);

// Mocks de red (se crean una sola vez por archivo de test: el módulo del arnés es único).
export const api = {
  osoAPI: { getOrders: vi.fn() },
  boMetaAPI: { getAll: vi.fn(), save: vi.fn(), remove: vi.fn() },
  boLineMetaAPI: { save: vi.fn() },
  productosAPI: { getAll: vi.fn(), getSyncStatus: vi.fn() },
  stockAPI: { getAll: vi.fn(), getCatalog: vi.fn() },
  cotizacionesAPI: { getAll: vi.fn(), create: vi.fn() },
  usuariosAPI: { getAll: vi.fn() },
  sesionesAPI: { getActive: vi.fn(), getByUser: vi.fn(), getUserLogs: vi.fn() },
  authAPI: { login: vi.fn(), logout: vi.fn() }
};

// Se parte del módulo real para no romper otros imports de '../../api'.
export async function crearApiMock() {
  const real = await vi.importActual('../../api');
  return { ...real, ...api };
}

// Usuarios de prueba.
export const ADMIN = { id: 1, usuario: 'admin', nombre: 'Admin', role: 'admin', empresa: 'Axis' };
// Mes actual en formato YYYY-MM (el dashboard muestra por defecto el mes en curso).
export const mesActual = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// --- Datos de ejemplo con la forma real de osoAPI.getOrders() y boMetaAPI.getAll() ---

export const crearOrdenes = () => [
  {
    bo: 'BO-1001',
    customerName: 'Acme SA',
    customerPO: 'OC-ACME-1',
    allocPct: 50,
    lines: [
      { lineIndex: 0, sku: 'SKU-A1', mpn: 'MPN-A1', desc: 'Camara domo exterior', orderQty: 4, shippedQty: 0, allocQty: 2, montoAxis: 100, montoIntcomex: null, tiempoEntrega: '' },
      { lineIndex: 1, sku: 'SKU-A2', mpn: 'MPN-A2', desc: 'Switch PoE ocho puertos', orderQty: 2, shippedQty: 0, allocQty: 2, montoAxis: null, montoIntcomex: 55, tiempoEntrega: '' }
    ]
  },
  {
    bo: 'BO-1002',
    customerName: 'Beta Ltda',
    customerPO: 'OC-BETA-1',
    allocPct: 100,
    lines: [
      { lineIndex: 0, sku: 'SKU-B1', mpn: 'MPN-B1', desc: 'Servidor NAS rack', orderQty: 3, shippedQty: 3, allocQty: 3, montoAxis: null, montoIntcomex: null, tiempoEntrega: '' }
    ]
  },
  {
    bo: 'BO-1003',
    customerName: 'Gamma Corp',
    customerPO: 'OC-GAMMA-1',
    allocPct: 25,
    lines: [
      { lineIndex: 0, sku: 'SKU-G1', mpn: 'MPN-G1', desc: 'Disco duro empresarial', orderQty: 4, shippedQty: 1, allocQty: 2, montoAxis: null, montoIntcomex: null, tiempoEntrega: '' }
    ]
  }
];

// Meta con la forma de la API (snake_case).
export const crearMeta = () => [
  { bo: 'BO-1001', project_name: 'Proyecto Norte', po_axis: 'PO-77' }
];

// Configura las respuestas por defecto de la API para el escenario "normal".
export function prepararApi({ orders = crearOrdenes(), meta = crearMeta() } = {}) {
  Object.values(api).forEach(grupo => Object.values(grupo).forEach(fn => fn.mockReset()));
  api.osoAPI.getOrders.mockResolvedValue({ orders });
  api.boMetaAPI.getAll.mockResolvedValue(meta);
  api.boMetaAPI.save.mockImplementation(async (bo, payload) => ({ bo, ...payload }));
  api.boMetaAPI.remove.mockResolvedValue({ ok: true });
  api.boLineMetaAPI.save.mockResolvedValue({ ok: true });
  api.productosAPI.getAll.mockResolvedValue([]);
  api.productosAPI.getSyncStatus.mockResolvedValue({});
  api.stockAPI.getAll.mockResolvedValue({ items: [] });
  api.stockAPI.getCatalog.mockResolvedValue({ items: [] });
  api.cotizacionesAPI.getAll.mockResolvedValue([]);
  api.cotizacionesAPI.create.mockResolvedValue({ cotizacion: { id: 501, numero: 501 } });
  api.usuariosAPI.getAll.mockResolvedValue([]);
  api.sesionesAPI.getActive.mockResolvedValue([]);
  api.sesionesAPI.getByUser.mockResolvedValue([]);
  api.sesionesAPI.getUserLogs.mockResolvedValue([]);
  api.authAPI.logout.mockResolvedValue({});
}

// Sonda del enrutador: deja a los tests leer la ubicación actual y navegar como lo haría
// el navegador (atrás/adelante, URL nueva). Vive dentro del MemoryRouter.
export const enrutador = { navegar: null, ubicacion: null };

function SondaEnrutador() {
  enrutador.navegar = useNavigate();
  enrutador.ubicacion = useLocation();
  return null;
}

// Deja la sesión iniciada y renderiza la app en la ruta dada.
// Con `user: null` no se guarda sesión (visitante sin login).
export function renderApp({ user = ADMIN, ruta = '/admin/ordenes' } = {}) {
  // jsdom no trae matchMedia (lo usa el tema) ni scrollTo.
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false
  }));
  window.scrollTo = () => {};
  if (user) {
    localStorage.setItem('token', 'token-de-prueba');
    localStorage.setItem('user', JSON.stringify(user));
  }
  queryClient.clear();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <App />
        <SondaEnrutador />
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// --- Utilidades de consulta (solo roles, textos y placeholders) ---
import { within } from '@testing-library/react';

// Orden de las tarjetas con los datos de ejemplo (orden por ETA sin ETA = orden de llegada):
// 0 = BO-1001, 1 = BO-1002, 2 = BO-1003.
export const botonesDeTarjeta = (nombre) => screen.getAllByRole('button', { name: nombre });

export const botonBo = (bo) => screen.queryByRole('button', { name: `BO ${bo}` });

export const abrirDetalle = (indice) => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[indice]);
};

// Inputs de monto de la línea con ese MPN. Orden de columnas: Monto Axis, Monto Intcomex.
// (El informe oculto para PDF repite el MPN pero no tiene inputs, por eso se filtra por ellos.)
export const inputsDeLinea = (mpn) => {
  const fila = screen.getAllByRole('row').find(r =>
    r.textContent.includes(mpn) && within(r).queryAllByRole('spinbutton').length === 2);
  if (!fila) throw new Error(`No hay fila con inputs para ${mpn}`);
  const [axis, intcomex] = within(fila).getAllByRole('spinbutton');
  return { axis, intcomex };
};

export const escribir = (input, valor) => fireEvent.change(input, { target: { value: valor } });

// Opciones del menú con ese nombre. Hay menú de escritorio (menuitem) y barra con
// botones; ESPERA a que exista alguna (la página carga con lazy y, al entrar, el menú
// puede tardar un instante en estar).
const opcionesDeMenu = (nombre) =>
  waitFor(() => {
    const encontradas = [
      ...screen.queryAllByRole('menuitem', { name: nombre }),
      ...screen.queryAllByRole('button', { name: nombre })
    ];
    if (!encontradas.length) throw new Error(`No hay opción de menú ${nombre}`);
    return encontradas;
  });

// Navega por el menú (se usa la primera opción que coincida).
export const irAVista = async (nombre) => {
  fireEvent.click((await opcionesDeMenu(nombre))[0]);
};
