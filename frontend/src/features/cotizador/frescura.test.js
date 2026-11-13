import { VIDA_UTIL_DATOS_MS, estaVencido, mismoMapaDeStock } from './frescura';

describe('estaVencido', () => {
  const ahora = 1_000_000_000;

  it('la vida útil es de 2 minutos', () => {
    expect(VIDA_UTIL_DATOS_MS).toBe(120000);
  });

  it('sin carga previa está vencido', () => {
    expect(estaVencido(null, ahora)).toBe(true);
    expect(estaVencido(undefined, ahora)).toBe(true);
    expect(estaVencido(0, ahora)).toBe(true);
    expect(estaVencido(Number.NaN, ahora)).toBe(true);
    expect(estaVencido('hoy', ahora)).toBe(true);
  });

  it('una carga reciente no está vencida', () => {
    expect(estaVencido(ahora, ahora)).toBe(false);
    expect(estaVencido(ahora - 30 * 1000, ahora)).toBe(false);
  });

  it('justo en los 2 minutos todavía vale; un milisegundo más y vence', () => {
    expect(estaVencido(ahora - VIDA_UTIL_DATOS_MS, ahora)).toBe(false);
    expect(estaVencido(ahora - VIDA_UTIL_DATOS_MS - 1, ahora)).toBe(true);
  });

  it('una carga de hace horas está vencida', () => {
    expect(estaVencido(ahora - 3 * 60 * 60 * 1000, ahora)).toBe(true);
  });

  it('una marca en el futuro (reloj movido) se trata como vencida', () => {
    expect(estaVencido(ahora + 5000, ahora)).toBe(true);
  });

  it('acepta otra vida útil', () => {
    expect(estaVencido(ahora - 5000, ahora, 4000)).toBe(true);
    expect(estaVencido(ahora - 3000, ahora, 4000)).toBe(false);
  });

  it('sin "ahora" usa el reloj actual', () => {
    expect(estaVencido(Date.now())).toBe(false);
    expect(estaVencido(Date.now() - VIDA_UTIL_DATOS_MS - 1000)).toBe(true);
  });
});

describe('mismoMapaDeStock', () => {
  it('mapas con las mismas claves y cantidades son iguales', () => {
    expect(mismoMapaDeStock({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(mismoMapaDeStock({}, {})).toBe(true);
  });

  it('cambia una cantidad, sobra o falta una clave: son distintos', () => {
    expect(mismoMapaDeStock({ a: 1 }, { a: 2 })).toBe(false);
    expect(mismoMapaDeStock({ a: 1 }, { a: 1, b: 1 })).toBe(false);
    expect(mismoMapaDeStock({ a: 1, b: 1 }, { a: 1 })).toBe(false);
    expect(mismoMapaDeStock({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('sin mapa previo no son iguales', () => {
    expect(mismoMapaDeStock(null, {})).toBe(false);
    expect(mismoMapaDeStock({}, undefined)).toBe(false);
  });
});
