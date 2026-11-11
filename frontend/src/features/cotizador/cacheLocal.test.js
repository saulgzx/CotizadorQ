import { vi } from 'vitest';
import { guardarCache, leerCache, limpiarCaches } from './cacheLocal';

const HORA = 60 * 60 * 1000;

describe('cacheLocal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('guardar y leer devuelve el mismo dato (ida y vuelta por JSON)', () => {
    guardarCache('productos', 7, { a: 1, lista: [1, 2] });
    expect(leerCache('productos', 7)).toEqual({ a: 1, lista: [1, 2] });
  });

  test('la clave es "mq-cache:<nombre>:<usuario>" y guarda ts + data', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    guardarCache('stock', 'ana', [1]);
    expect(JSON.parse(localStorage.getItem('mq-cache:stock:ana'))).toEqual({ ts: 1000, data: [1] });
  });

  test('usuario undefined o null se guarda como "anon"; el usuario 0 se conserva como "0"', () => {
    guardarCache('a', undefined, 1);
    guardarCache('b', null, 2);
    guardarCache('c', 0, 3);
    expect(localStorage.getItem('mq-cache:a:anon')).not.toBeNull();
    expect(localStorage.getItem('mq-cache:b:anon')).not.toBeNull();
    expect(localStorage.getItem('mq-cache:c:0')).not.toBeNull();
    expect(leerCache('a', null)).toBe(1);
  });

  test('cada usuario y cada nombre tienen su propia entrada', () => {
    guardarCache('x', 1, 'uno');
    guardarCache('x', 2, 'dos');
    guardarCache('y', 1, 'otro');
    expect(leerCache('x', 1)).toBe('uno');
    expect(leerCache('x', 2)).toBe('dos');
    expect(leerCache('y', 1)).toBe('otro');
  });

  test('sin entrada devuelve null', () => {
    expect(leerCache('nada', 1)).toBeNull();
  });

  test('vence a las 24h por defecto (justo 24h aun vale; pasado, null)', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    guardarCache('p', 1, 'dato');
    now.mockReturnValue(1_000_000 + 24 * HORA);
    expect(leerCache('p', 1)).toBe('dato');
    now.mockReturnValue(1_000_000 + 24 * HORA + 1);
    expect(leerCache('p', 1)).toBeNull();
  });

  test('maxEdadMs personalizado', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(5000);
    guardarCache('p', 1, 'dato');
    now.mockReturnValue(5000 + 100);
    expect(leerCache('p', 1, 50)).toBeNull();
    expect(leerCache('p', 1, 200)).toBe('dato');
  });

  test('JSON corrupto o entrada sin ts devuelve null sin lanzar', () => {
    localStorage.setItem('mq-cache:p:1', '{no es json');
    expect(leerCache('p', 1)).toBeNull();
    localStorage.setItem('mq-cache:q:1', JSON.stringify({ data: 'sin ts' }));
    expect(leerCache('q', 1)).toBeNull();
    localStorage.setItem('mq-cache:r:1', 'null');
    expect(leerCache('r', 1)).toBeNull();
  });

  test('un dato guardado como null se lee como null', () => {
    guardarCache('p', 1, null);
    expect(leerCache('p', 1)).toBeNull();
  });

  test('si el almacenamiento falla al guardar (cuota llena) no lanza', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => guardarCache('p', 1, 'x')).not.toThrow();
  });

  test('si el almacenamiento falla al leer devuelve null', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(leerCache('p', 1)).toBeNull();
  });

  test('limpiarCaches borra solo las claves con prefijo "mq-cache:"', () => {
    guardarCache('a', 1, 1);
    guardarCache('b', 2, 2);
    localStorage.setItem('token', 'abc');
    localStorage.setItem('mq-cachex', 'no es del cache'); // no empieza por "mq-cache:"
    limpiarCaches();
    expect(leerCache('a', 1)).toBeNull();
    expect(leerCache('b', 2)).toBeNull();
    expect(localStorage.getItem('token')).toBe('abc');
    expect(localStorage.getItem('mq-cachex')).toBe('no es del cache');
  });

  test('limpiarCaches no lanza si el almacenamiento no esta disponible', () => {
    guardarCache('a', 1, 1);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => limpiarCaches()).not.toThrow();
  });
});
