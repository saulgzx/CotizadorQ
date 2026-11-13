// Lo abierto ENCIMA de una vista (modales, buscador rápido, ayuda) se cierra al cambiar de
// vista, como pasaba cuando cada ruta remontaba la página. Lo que es de la vista (búsquedas,
// filtros, filas expandidas) se conserva.
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('../ordenes/arnesOrdenes.testutil.jsx')).crearApiMock());

// El asistente real no interesa aquí: solo que, al cargar una lista, la página cambia de vista
// y abre "pegar lista" a la vez.
vi.mock('../ia/AsistenteIAView', () => ({
  default: ({ onCargarLista }) => (
    <div>
      <h2>Asistente simulado</h2>
      <button type="button" onClick={() => onCargarLista('TS-464 2')}>Cargar lista simulada</button>
    </div>
  )
}));

import { precalentar, prepararApi, renderApp, irAVista, escribir, ADMIN } from '../ordenes/arnesOrdenes.testutil.jsx';

const hayEncabezado = (nombre) => () => screen.queryAllByRole('heading', { level: 2, name: nombre }).length > 0;
const esperarVista = (nombre) => waitFor(() => expect(hayEncabezado(nombre)()).toBe(true));
const dialogo = (nombre) => screen.queryByRole('dialog', { name: nombre });

beforeAll(precalentar, 30000);

beforeEach(() => {
  localStorage.clear();
  prepararApi();
});

describe('Superposiciones al cambiar de vista', () => {
  it('el buscador rápido (Ctrl+K) se cierra al cambiar de vista con Alt+número', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await esperarVista('Dashboard');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Buscador rápido' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '2', altKey: true });
    await esperarVista('Cotización');
    await waitFor(() => expect(dialogo('Buscador rápido')).not.toBeInTheDocument());
  });

  it('la ayuda de atajos (?) se cierra al cambiar de vista', async () => {
    renderApp({ user: ADMIN, ruta: '/dashboard' });
    await esperarVista('Dashboard');
    fireEvent.keyDown(window, { key: '?' });
    expect(await screen.findByRole('dialog', { name: 'Atajos de teclado' })).toBeInTheDocument();
    await irAVista('Cotizador');
    await esperarVista('Cotización');
    await waitFor(() => expect(dialogo('Atajos de teclado')).not.toBeInTheDocument());
  });

  it('"Pegar lista" se cierra al ir a otra vista, y al volver sigue cerrada', async () => {
    renderApp({ user: ADMIN, ruta: '/cotizador' });
    await esperarVista('Cotización');
    fireEvent.click(await screen.findByRole('button', { name: 'Pegar lista' }));
    expect(await screen.findByRole('dialog', { name: 'Pegar lista de productos' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '1', altKey: true });
    await esperarVista('Dashboard');
    expect(dialogo('Pegar lista de productos')).not.toBeInTheDocument();
    await irAVista('Cotizador');
    await esperarVista('Cotización');
    expect(dialogo('Pegar lista de productos')).not.toBeInTheDocument();
  });

  it('el asistente IA sí puede abrir "Pegar lista" al mandar la lista al Cotizador', async () => {
    renderApp({ user: ADMIN, ruta: '/ia' });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar lista simulada' }));
    await esperarVista('Cotización');
    expect(await screen.findByRole('dialog', { name: 'Pegar lista de productos' })).toBeInTheDocument();
    // Y es una lista abierta como cualquier otra: al cambiar de vista se cierra.
    fireEvent.keyDown(window, { key: '1', altKey: true });
    await esperarVista('Dashboard');
    expect(dialogo('Pegar lista de productos')).not.toBeInTheDocument();
  });

  it('lo que es de la vista se conserva: la búsqueda global de Usuarios sigue al volver', async () => {
    renderApp({ user: ADMIN, ruta: '/admin/usuarios' });
    await esperarVista('Usuarios');
    escribir(screen.getByRole('textbox', { name: 'Buscar' }), 'maria');
    await irAVista('Dashboard');
    await esperarVista('Dashboard');
    await irAVista('Usuarios');
    await esperarVista('Usuarios');
    expect(screen.getByRole('textbox', { name: 'Buscar' })).toHaveValue('maria');
  });
});
