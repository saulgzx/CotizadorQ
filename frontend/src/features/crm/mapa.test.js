import { altoDelMapa, disponerMapa, guardarPreferenciasMapa, leerPreferenciasMapa, pesosConPiso, squarify, tamanoDeTarjeta, usdCorto } from './mapa';

// Generador pseudoaleatorio con semilla fija (mulberry32) para casos reproducibles.
const semilla = (s) => () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const area = (r) => r.w * r.h;
const solapan = (a, b, eps = 1e-6) => a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;

function verificarTeselado(items, rect, salida, tolRel = 1e-6) {
  expect(salida).toHaveLength(items.length);
  const total = items.reduce((s, it) => s + it.peso, 0);
  const areaRect = rect.w * rect.h;
  let suma = 0;
  salida.forEach((r) => {
    const it = items.find((x) => x.id === r.id);
    const esperada = (it.peso / total) * areaRect;
    expect(Math.abs(area(r) - esperada)).toBeLessThanOrEqual(Math.max(1e-6, esperada * tolRel));
    expect(r.x).toBeGreaterThanOrEqual(rect.x - 1e-6);
    expect(r.y).toBeGreaterThanOrEqual(rect.y - 1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(rect.x + rect.w + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(rect.y + rect.h + 1e-6);
    suma += area(r);
  });
  expect(Math.abs(suma - areaRect)).toBeLessThanOrEqual(areaRect * 1e-9 + 1e-6);
  for (let i = 0; i < salida.length; i += 1) {
    for (let j = i + 1; j < salida.length; j += 1) expect(solapan(salida[i], salida[j])).toBe(false);
  }
}

describe('squarify', () => {
  test('lista vacía da lista vacía', () => {
    expect(squarify([], { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
    expect(squarify(undefined, { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
  });

  test('un solo item ocupa todo el rect', () => {
    expect(squarify([{ id: 'a', peso: 7 }], { x: 10, y: 20, w: 300, h: 200 })).toEqual([{ id: 'a', x: 10, y: 20, w: 300, h: 200 }]);
  });

  test('reparte por área, sin salirse, sin solapes, en varios rects', () => {
    const casos = [
      [[6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 600, h: 400 }],
      [[10, 1], { x: 5, y: 7, w: 100, h: 900 }],
      [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { x: 0, y: 0, w: 1200, h: 600 }],
      [[100, 1, 1, 1, 1, 1, 1], { x: 0, y: 0, w: 333.3, h: 777.7 }],
      [[5, 5, 5], { x: 0, y: 0, w: 10, h: 10 }]
    ];
    casos.forEach(([pesos, rect]) => {
      const items = pesos.map((peso, i) => ({ id: `i${i}`, peso }));
      verificarTeselado(items, rect, squarify(items, rect));
    });
  });

  test('salida ordenada de mayor a menor peso', () => {
    const items = [{ id: 'a', peso: 1 }, { id: 'b', peso: 9 }, { id: 'c', peso: 4 }];
    expect(squarify(items, { x: 0, y: 0, w: 100, h: 100 }).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  test('caso aleatorio de 200 items con semilla fija', () => {
    const azar = semilla(20260);
    const items = Array.from({ length: 200 }, (_, i) => ({ id: i, peso: Math.round(Math.exp(azar() * 8) * 100) / 100 + 0.01 }));
    const rect = { x: 3, y: 4, w: 1200, h: 5000 };
    verificarTeselado(items, rect, squarify(items, rect));
  });

  test('pesos iguales dan una grilla razonable', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i, peso: 5 }));
    const salida = squarify(items, { x: 0, y: 0, w: 1200, h: 600 });
    verificarTeselado(items, { x: 0, y: 0, w: 1200, h: 600 }, salida);
    salida.forEach((r) => {
      expect(Math.max(r.w / r.h, r.h / r.w)).toBeLessThan(2.5);
    });
  });

  test('la razón de aspecto promedio queda acotada', () => {
    const azar = semilla(7);
    const items = Array.from({ length: 30 }, (_, i) => ({ id: i, peso: 1 + Math.floor(azar() * 100) }));
    const salida = squarify(items, { x: 0, y: 0, w: 1200, h: 600 });
    const promedio = salida.reduce((s, r) => s + Math.max(r.w / r.h, r.h / r.w), 0) / salida.length;
    expect(promedio).toBeLessThan(3);
  });

  test('rect de ancho o alto 0 da rectángulos de área 0 sin NaN', () => {
    const items = [{ id: 'a', peso: 3 }, { id: 'b', peso: 1 }];
    [{ x: 0, y: 0, w: 0, h: 100 }, { x: 0, y: 0, w: 100, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }].forEach((rect) => {
      const salida = squarify(items, rect);
      expect(salida).toHaveLength(2);
      salida.forEach((r) => {
        expect(area(r)).toBe(0);
        [r.x, r.y, r.w, r.h].forEach((v) => expect(Number.isNaN(v)).toBe(false));
      });
    });
  });

  test('un peso no positivo o inválido da área 0 y no rompe el resto', () => {
    const items = [{ id: 'a', peso: 4 }, { id: 'b', peso: 0 }, { id: 'c', peso: NaN }, { id: 'd', peso: 4 }];
    const salida = squarify(items, { x: 0, y: 0, w: 100, h: 100 });
    expect(salida).toHaveLength(4);
    expect(area(salida.find((r) => r.id === 'a'))).toBeCloseTo(5000, 6);
    expect(area(salida.find((r) => r.id === 'b'))).toBe(0);
    expect(area(salida.find((r) => r.id === 'c'))).toBe(0);
  });
});

describe('altoDelMapa', () => {
  test('respeta el mínimo con pocas tarjetas', () => {
    expect(altoDelMapa({ cantidad: 4, ancho: 1200 })).toBe(520);
  });
  test('crece con muchas tarjetas', () => {
    expect(altoDelMapa({ cantidad: 400, ancho: 1200 })).toBe(3000);
  });
  test('respeta el máximo', () => {
    expect(altoDelMapa({ cantidad: 100000, ancho: 1200 })).toBe(20000);
  });
  test('admite parámetros propios y ancho 0', () => {
    expect(altoDelMapa({ cantidad: 100, ancho: 400, minimo: 300, areaPorTarjeta: 16000 })).toBe(4000);
    expect(altoDelMapa({ cantidad: 100, ancho: 0 })).toBe(520);
  });
});

describe('pesosConPiso', () => {
  test('sin montos devuelve vacío', () => {
    expect(pesosConPiso([], { area: 1000 })).toEqual({ pesos: [], piso: 0, enPiso: 0 });
  });

  test('con montos parecidos el piso no altera nada', () => {
    const r = pesosConPiso([1000, 1200, 900, 1100], { area: 600000 });
    expect(r.pesos).toEqual([1000, 1200, 900, 1100]);
    expect(r.enPiso).toBe(0);
  });

  test('una oportunidad de $0 sigue siendo visible (área mínima)', () => {
    const montos = [50000, 30000, 0, 20000];
    const area = 600000;
    const { pesos, enPiso, piso } = pesosConPiso(montos, { area });
    expect(enPiso).toBe(1);
    expect(pesos[2]).toBeGreaterThan(0);
    const total = pesos.reduce((s, p) => s + p, 0);
    expect((pesos[2] / total) * area).toBeGreaterThanOrEqual(2400 - 1e-3);
    expect(piso).toBeCloseTo(pesos[2], 9);
  });

  test('la tarjeta más chica recibe al menos el área mínima', () => {
    const azar = semilla(3);
    const montos = Array.from({ length: 80 }, () => Math.round(Math.exp(azar() * 10)));
    const area = 1200 * 1500;
    const { pesos } = pesosConPiso(montos, { area, areaMinima: 2400 });
    const total = pesos.reduce((s, p) => s + p, 0);
    pesos.forEach((p) => expect((p / total) * area).toBeGreaterThanOrEqual(2400 * (1 - 1e-6)));
  });

  test('montos no numéricos, nulos o negativos valen 0; nunca NaN ni negativos', () => {
    const { pesos } = pesosConPiso([null, undefined, 'abc', -5, 'x', 100, '250'], { area: 1000000 });
    expect(pesos).toHaveLength(7);
    pesos.forEach((p) => {
      expect(Number.isFinite(p)).toBe(true);
      expect(p).toBeGreaterThan(0);
    });
    expect(pesos[6]).toBe(250);
  });

  test('si no caben o todo vale 0, todos pesan igual', () => {
    const noCaben = pesosConPiso([5, 1, 1000], { area: 3 * 2400 });
    expect(new Set(noCaben.pesos).size).toBe(1);
    expect(noCaben.enPiso).toBe(3);
    const ceros = pesosConPiso([0, 0, null], { area: 1000000 });
    expect(new Set(ceros.pesos).size).toBe(1);
    expect(ceros.pesos[0]).toBeGreaterThan(0);
    const sinArea = pesosConPiso([5, 10], { area: 0 });
    expect(new Set(sinArea.pesos).size).toBe(1);
  });
});

describe('tamanoDeTarjeta', () => {
  test('clasifica por la caja', () => {
    expect(tamanoDeTarjeta(220, 130)).toBe('xl');
    expect(tamanoDeTarjeta(219, 130)).toBe('l');
    expect(tamanoDeTarjeta(500, 129)).toBe('l');
    expect(tamanoDeTarjeta(150, 92)).toBe('l');
    expect(tamanoDeTarjeta(149, 92)).toBe('m');
    expect(tamanoDeTarjeta(96, 58)).toBe('m');
    // Compacta: no le caben tres líneas, pero sí el nombre y el monto.
    expect(tamanoDeTarjeta(95, 58)).toBe('c');
    expect(tamanoDeTarjeta(140, 44)).toBe('c');
    expect(tamanoDeTarjeta(70, 40)).toBe('c');
    expect(tamanoDeTarjeta(69, 40)).toBe('s');
    expect(tamanoDeTarjeta(70, 39)).toBe('s');
    expect(tamanoDeTarjeta(54, 34)).toBe('s');
    expect(tamanoDeTarjeta(53, 100)).toBe('xs');
    expect(tamanoDeTarjeta(0, 0)).toBe('xs');
  });
});

describe('disponerMapa: una sola escala para todo el mapa', () => {
  // Lo que no puede pasar: que una tarjeta de $50.000 en una empresa chica se vea menor que una de
  // $50.000 en una empresa grande. El título y los bordes de cada bloque ocupan píxeles fijos, así
  // que hay que compensarlos; si no, los bloques chicos pierden proporcionalmente más.
  const escalas = (r, montoDe) =>
    r.grupos.flatMap((g) => g.tarjetas).map((t) => (t.w * t.h) / montoDe.get(t.id));

  test('la misma plata ocupa la misma área en un bloque grande y en uno chico', () => {
    const grupos = [
      { id: 'grande', items: [{ id: 1, monto: 50000 }, { id: 2, monto: 200000 }, { id: 3, monto: 120000 }, { id: 4, monto: 90000 }] },
      { id: 'chico', items: [{ id: 5, monto: 50000 }] },
      { id: 'medio', items: [{ id: 6, monto: 50000 }, { id: 7, monto: 60000 }] }
    ];
    const r = disponerMapa({ grupos, ancho: 1200, alto: 640, areaMinima: 2400 });
    expect(r.enPiso).toBe(0);
    const area = new Map(r.grupos.flatMap((g) => g.tarjetas).map((t) => [t.id, t.w * t.h]));
    expect(area.get(5) / area.get(1)).toBeGreaterThan(0.97);
    expect(area.get(5) / area.get(1)).toBeLessThan(1.03);
    expect(area.get(6) / area.get(1)).toBeGreaterThan(0.97);
    expect(area.get(6) / area.get(1)).toBeLessThan(1.03);
    // Y dentro de la proporción: 200.000 ocupa cuatro veces lo que 50.000.
    expect(area.get(2) / area.get(1)).toBeGreaterThan(3.88);
    expect(area.get(2) / area.get(1)).toBeLessThan(4.12);
  });

  test('con muchos bloques dispares, ninguna tarjeta sobre el piso se aparta más de 5 % de la escala común', () => {
    let semilla = 20261119;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
    for (const [ancho, alto] of [[1296, 708], [1296, 600], [1000, 900], [1600, 620], [360, 2400]]) {
      const montoDe = new Map();
      let id = 0;
      const grupos = Array.from({ length: 16 }, (_, g) => ({
        id: `g${g}`,
        items: Array.from({ length: 1 + Math.floor(azar() * 6) }, () => {
          id += 1;
          const r = azar();
          const monto = Math.round(r < 0.1 ? 120000 + azar() * 250000 : r < 0.35 ? 30000 + azar() * 70000 : 6000 + azar() * 22000);
          montoDe.set(id, monto);
          return { id, monto };
        })
      }));
      const r = disponerMapa({ grupos, ancho, alto, areaMinima: 1200 });
      expect(r.enPiso).toBe(0);
      const e = escalas(r, montoDe).sort((a, b) => a - b);
      const mediana = e[Math.floor(e.length / 2)];
      const desvio = Math.max(...e.map((v) => Math.abs(v / mediana - 1)));
      if (desvio > 0.05) throw new Error(`${ancho}x${alto}: desvío de escala ${(desvio * 100).toFixed(1)} %`);
    }
  });
});

describe('disponerMapa', () => {
  const grupos = (azar, cantidadGrupos, maxItems) =>
    Array.from({ length: cantidadGrupos }, (_, g) => ({
      id: `g${g}`,
      items: Array.from({ length: 1 + Math.floor(azar() * maxItems) }, (_, i) => ({ id: `o${g}-${i}`, monto: Math.round(Math.exp(azar() * 9)) }))
    }));

  const verificar = (r, { cabecera = 26, relleno = 4 } = {}) => {
    r.grupos.forEach((g) => {
      expect(g.x).toBeGreaterThanOrEqual(-0.01);
      expect(g.y).toBeGreaterThanOrEqual(-0.01);
      expect(g.x + g.w).toBeLessThanOrEqual(r.ancho + 0.01);
      expect(g.y + g.h).toBeLessThanOrEqual(r.alto + 0.01);
      const topeY = g.conCabecera ? g.y + cabecera : g.y;
      const borde = g.conCabecera ? relleno : 0;
      g.tarjetas.forEach((t) => {
        [t.x, t.y, t.w, t.h].forEach((v) => expect(Number.isFinite(v)).toBe(true));
        expect(t.x).toBeGreaterThanOrEqual(g.x + borde - 0.011);
        expect(t.y).toBeGreaterThanOrEqual(topeY - 0.011);
        expect(t.x + t.w).toBeLessThanOrEqual(g.x + g.w - borde + 0.011);
        expect(t.y + t.h).toBeLessThanOrEqual(g.y + g.h - borde + 0.011);
        expect(t.tamano).toBe(tamanoDeTarjeta(t.w, t.h));
      });
      for (let i = 0; i < g.tarjetas.length; i += 1) {
        for (let j = i + 1; j < g.tarjetas.length; j += 1) expect(solapan(g.tarjetas[i], g.tarjetas[j], 0.02)).toBe(false);
      }
    });
    for (let i = 0; i < r.grupos.length; i += 1) {
      for (let j = i + 1; j < r.grupos.length; j += 1) expect(solapan(r.grupos[i], r.grupos[j], 0.02)).toBe(false);
    }
  };

  test('tarjetas dentro de su bloque, sin invadir la cabecera y sin solapes', () => {
    const azar = semilla(99);
    const entrada = grupos(azar, 12, 15);
    const r = disponerMapa({ grupos: entrada, ancho: 1200, alto: 900 });
    verificar(r);
    expect(r.grupos).toHaveLength(12);
    expect(r.grupos.reduce((s, g) => s + g.tarjetas.length, 0)).toBe(entrada.reduce((s, g) => s + g.items.length, 0));
    expect(r.grupos.some((g) => g.conCabecera)).toBe(true);
  });

  test('muchas tarjetas (500) siguen sin solapes ni salirse', () => {
    const azar = semilla(5);
    const entrada = grupos(azar, 40, 25);
    verificar(disponerMapa({ grupos: entrada, ancho: 1200, alto: 4000 }));
  });

  test('bloques ordenados de mayor a menor suma de pesos', () => {
    const r = disponerMapa({
      grupos: [
        { id: 'chico', items: [{ id: 'a', monto: 1000 }] },
        { id: 'grande', items: [{ id: 'b', monto: 90000 }, { id: 'c', monto: 50000 }] }
      ],
      ancho: 1200,
      alto: 520
    });
    expect(r.grupos.map((g) => g.id)).toEqual(['grande', 'chico']);
    expect(r.grupos[0].tarjetas.map((t) => t.id)).toEqual(['b', 'c']);
    expect(r.enPiso).toBe(0);
  });

  test('un bloque chico no lleva cabecera y sus tarjetas usan todo el bloque', () => {
    const r = disponerMapa({
      grupos: [
        { id: 'gigante', items: [{ id: 'a', monto: 1000000 }] },
        { id: 'diminuto', items: [{ id: 'b', monto: 1500 }] }
      ],
      ancho: 400,
      alto: 300
    });
    const chico = r.grupos.find((g) => g.id === 'diminuto');
    expect(chico.conCabecera).toBe(false);
    expect(chico.tarjetas[0]).toMatchObject({ x: chico.x, y: chico.y, w: chico.w, h: chico.h });
    expect(r.grupos.find((g) => g.id === 'gigante').conCabecera).toBe(true);
  });

  test('con un solo bloque grande: margen, cabecera y relleno se descuentan', () => {
    const r = disponerMapa({ grupos: [{ id: 'g', items: [{ id: 'a', monto: 10 }] }], ancho: 600, alto: 400, margen: 6, cabecera: 26, relleno: 4 });
    const g = r.grupos[0];
    expect(g).toMatchObject({ x: 3, y: 3, w: 594, h: 394, conCabecera: true });
    expect(g.tarjetas[0]).toMatchObject({ x: 7, y: 29, w: 586, h: 364, tamano: 'xl' });
  });

  test('ancho 0 no revienta', () => {
    const r = disponerMapa({ grupos: [{ id: 'g', items: [{ id: 'a', monto: 5 }, { id: 'b', monto: 0 }] }], ancho: 0, alto: 520 });
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].conCabecera).toBe(false);
    r.grupos[0].tarjetas.forEach((t) => {
      [t.x, t.y, t.w, t.h].forEach((v) => expect(Number.isNaN(v)).toBe(false));
      expect(t.tamano).toBe('xs');
    });
  });

  test('grupos vacíos o inválidos se ignoran', () => {
    const r = disponerMapa({ grupos: [{ id: 'v', items: [] }, null, { id: 'x' }, { id: 'g', items: [{ id: 'a', monto: 5 }] }], ancho: 600, alto: 400 });
    expect(r.grupos.map((g) => g.id)).toEqual(['g']);
    expect(disponerMapa({ grupos: [], ancho: 600, alto: 400 }).grupos).toEqual([]);
    expect(disponerMapa().grupos).toEqual([]);
  });

  test('el piso se calcula sobre todas las tarjetas: una de $0 sigue visible', () => {
    const r = disponerMapa({
      grupos: [
        { id: 'a', items: [{ id: 'a1', monto: 90000 }, { id: 'a2', monto: 0 }] },
        { id: 'b', items: [{ id: 'b1', monto: 60000 }] }
      ],
      ancho: 1200,
      alto: 520
    });
    expect(r.enPiso).toBe(1);
    const cero = r.grupos.flatMap((g) => g.tarjetas).find((t) => t.id === 'a2');
    expect(cero.w * cero.h).toBeGreaterThan(1000);
  });
});

describe('usdCorto', () => {
  test('abrevia con coma decimal', () => {
    expect(usdCorto(950)).toBe('$950');
    expect(usdCorto(35800)).toBe('$35,8 k');
    expect(usdCorto(1250000)).toBe('$1,25 M');
  });
  test('bordes y valores raros', () => {
    expect(usdCorto(0)).toBe('$0');
    expect(usdCorto(null)).toBe('$0');
    expect(usdCorto('abc')).toBe('$0');
    expect(usdCorto(-30)).toBe('$0');
    expect(usdCorto(1000)).toBe('$1 k');
    expect(usdCorto(12000)).toBe('$12 k');
    expect(usdCorto(999999)).toBe('$1 M');
    expect(usdCorto(20000000)).toBe('$20 M');
  });
});

describe('preferencias del mapa', () => {
  beforeEach(() => window.localStorage.clear());

  test('valores por defecto', () => {
    expect(leerPreferenciasMapa()).toEqual({
      agruparPor: 'empresa',
      colorPor: 'seguimiento',
      etapas: ['nueva', 'cotizada', 'negociacion'],
      marca: '',
      seguimiento: ''
    });
  });

  test('guarda y restaura', () => {
    const p = { agruparPor: 'marca', colorPor: 'etapa', etapas: ['ganada'], marca: 'AXIS', seguimiento: 'vencido' };
    guardarPreferenciasMapa(p);
    expect(JSON.parse(window.localStorage.getItem('crmMapa'))).toEqual(p);
    expect(leerPreferenciasMapa()).toEqual(p);
  });

  test('sanea valores inválidos y JSON roto', () => {
    window.localStorage.setItem('crmMapa', JSON.stringify({ agruparPor: 'x', colorPor: 7, etapas: ['nueva', 'zzz', 'nueva'], marca: 'ACME', seguimiento: 'mañana' }));
    expect(leerPreferenciasMapa()).toEqual({ agruparPor: 'empresa', colorPor: 'seguimiento', etapas: ['nueva'], marca: '', seguimiento: '' });
    window.localStorage.setItem('crmMapa', '{no es json');
    expect(leerPreferenciasMapa().agruparPor).toBe('empresa');
    window.localStorage.setItem('crmMapa', JSON.stringify({ etapas: 'nueva' }));
    expect(leerPreferenciasMapa().etapas).toEqual(['nueva', 'cotizada', 'negociacion']);
  });

  test('sin localStorage no revienta', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('bloqueado'); } });
    try {
      expect(() => guardarPreferenciasMapa({})).not.toThrow();
      expect(leerPreferenciasMapa().agruparPor).toBe('empresa');
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
