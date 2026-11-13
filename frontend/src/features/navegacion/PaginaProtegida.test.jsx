import { RUTAS_PROTEGIDAS, rutaProtegidaDe } from './PaginaProtegida';
import { ROUTE_TO_VIEW } from '../cotizador/cotizadorConstants';

describe('Tabla de rutas protegidas', () => {
  it('cada ruta lleva a su vista, la misma que usa la página para sincronizar ruta y vista', () => {
    RUTAS_PROTEGIDAS.forEach(({ path, vista }) => expect(ROUTE_TO_VIEW[path]).toBe(vista));
    expect(RUTAS_PROTEGIDAS.map(r => [r.path, r.vista])).toEqual([
      ['/dashboard', 'dashboard'],
      ['/cotizador', 'cotizador'],
      ['/historial', 'historial'],
      ['/ia', 'ia'],
      ['/crm', 'crm'],
      ['/admin/usuarios', 'usuarios'],
      ['/admin/ordenes', 'ordenes']
    ]);
  });

  it('exigen admin exactamente /crm, /admin/usuarios y /admin/ordenes', () => {
    expect(RUTAS_PROTEGIDAS.filter(r => r.admin).map(r => r.path)).toEqual(['/crm', '/admin/usuarios', '/admin/ordenes']);
  });

  it('rutaProtegidaDe reconoce la ruta como el enrutador: barra final y mayúsculas incluidas', () => {
    expect(rutaProtegidaDe('/crm')?.admin).toBe(true);
    expect(rutaProtegidaDe('/crm/')?.admin).toBe(true);
    expect(rutaProtegidaDe('/CRM')?.admin).toBe(true);
    expect(rutaProtegidaDe('/admin/ordenes/')?.vista).toBe('ordenes');
    expect(rutaProtegidaDe('/dashboard')?.admin).toBe(false);
  });

  it('una ruta que no es de la tabla no coincide', () => {
    expect(rutaProtegidaDe('/login')).toBeNull();
    expect(rutaProtegidaDe('/admin')).toBeNull();
    expect(rutaProtegidaDe('/crm/otra')).toBeNull();
  });
});
