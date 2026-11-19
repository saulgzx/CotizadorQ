import {
  AGRUPACIONES,
  ETAPAS_ABIERTAS,
  conteosPorEtapa,
  construirArbol,
  filasVisibles,
  guardarPreferencias,
  leerPreferencias,
  moverFoco
} from './arbol';

const op = (extra) => ({
  id: 1,
  titulo: 'NAS sucursal Norte',
  etapa: 'negociacion',
  empresa_id: 12,
  empresa_nombre: 'Acme SA',
  contacto_nombre: 'Ana Pérez',
  marca: 'QNAP',
  monto: 100,
  bo: null,
  ...extra
});
const cot = (extra) => ({ id: 1041, numero: 1041, version: 2, total: 100, oportunidad_id: 1, usuario: 'alexis', proyecto: null, pid: null, ...extra });

const DATOS = {
  oportunidades: [
    op({ id: 1, monto: 0.1 }),
    op({ id: 2, titulo: 'Cámaras bodega', etapa: 'cotizada', marca: 'AXIS', monto: 0.2, contacto_nombre: null }),
    op({ id: 3, titulo: 'Orden BO-1001', etapa: 'ganada', marca: 'AXIS', monto: 9300, bo: 'BO-1001' }),
    op({ id: 4, titulo: 'Switches', etapa: 'perdida', empresa_id: 13, empresa_nombre: 'Beta Ltda', marca: null, monto: '7150.50' }),
    op({ id: 5, titulo: 'Rack', etapa: 'nueva', empresa_id: 14, empresa_nombre: 'álvarez y Cía', marca: 'MIXTA', monto: 500 }),
    op({ id: 6, titulo: 'Disco', etapa: 'nueva', empresa_id: 15, empresa_nombre: 'Zeta', marca: 'MIXTA', monto: 500 })
  ],
  cotizaciones: [
    cot({ id: 1041, numero: 1041, oportunidad_id: 1, proyecto: 'Proyecto Norte', pid: 'PID-77' }),
    cot({ id: 1038, numero: 1038, version: 1, oportunidad_id: 1, usuario: 'maría' }),
    cot({ id: 1050, numero: 1050, oportunidad_id: 2, total: '35800' }),
    cot({ id: 999, numero: 999, oportunidad_id: 777 })
  ],
  total_oportunidades: 6,
  truncado: false
};

const ids = (arr) => arr.map((x) => x.id);

describe('constantes', () => {
  test('agrupaciones y etapas abiertas', () => {
    expect(AGRUPACIONES.map((a) => a.clave)).toEqual(['empresa', 'etapa', 'marca']);
    expect(ETAPAS_ABIERTAS).toEqual(['nueva', 'cotizada', 'negociacion']);
  });
});

describe('construirArbol › agrupar por empresa', () => {
  test('ids estables, orden por monto abierto desc y luego nombre (sin tildes ni mayúsculas)', () => {
    const { grupos } = construirArbol(DATOS);
    // Acme: 0.3 abierto; Álvarez y Zeta: 500 cada uno (empate -> nombre, "álvarez" antes que "zeta"); Beta: 0.
    expect(ids(grupos)).toEqual(['g:empresa:14', 'g:empresa:15', 'g:empresa:12', 'g:empresa:13']);
    expect(grupos[0]).toMatchObject({ tipo: 'grupo', agrupacion: 'empresa', clave: '14', titulo: 'álvarez y Cía', empresaId: 14 });
  });

  test('suma en centavos: 0.1 + 0.2 = 0.3 y montos en texto', () => {
    const acme = construirArbol(DATOS).grupos.find((g) => g.clave === '12');
    expect(acme.montoAbierto).toBe(0.3);
    expect(acme.montoGanado).toBe(9300);
    expect(acme.montoTotal).toBe(9300.3);
    expect(acme).toMatchObject({ conteo: 3, abiertas: 2 });
    const beta = construirArbol(DATOS).grupos.find((g) => g.clave === '13');
    expect(beta).toMatchObject({ montoAbierto: 0, montoTotal: 7150.5, abiertas: 0, conteo: 1 });
  });

  test('las oportunidades y cotizaciones conservan su orden y la más reciente es la vigente', () => {
    const acme = construirArbol(DATOS).grupos.find((g) => g.clave === '12');
    expect(ids(acme.oportunidades)).toEqual(['o:1', 'o:2', 'o:3']);
    const o1 = acme.oportunidades[0];
    expect(o1).toMatchObject({ tipo: 'oportunidad' });
    expect(o1.op.id).toBe(1);
    expect(ids(o1.cotizaciones)).toEqual(['c:1041', 'c:1038']);
    expect(o1.cotizaciones.map((c) => c.vigente)).toEqual([true, false]);
    expect(o1.cotizaciones[0]).toMatchObject({ tipo: 'cotizacion' });
    expect(o1.cotizaciones[0].cot.numero).toBe(1041);
  });

  test('ignora cotizaciones de oportunidades que no están en la lista', () => {
    const { grupos } = construirArbol(DATOS);
    const todas = grupos.flatMap((g) => g.oportunidades.flatMap((o) => ids(o.cotizaciones)));
    expect(todas).not.toContain('c:999');
  });

  test('totales sobre lo que quedó tras los filtros', () => {
    expect(construirArbol(DATOS).totales).toEqual({ grupos: 4, oportunidades: 6, abiertas: 4, montoAbierto: 1000.3, montoGanado: 9300 });
    expect(construirArbol(DATOS, { etapas: ['ganada'] }).totales).toEqual({ grupos: 1, oportunidades: 1, abiertas: 0, montoAbierto: 0, montoGanado: 9300 });
  });

  test('sin búsqueda abrirPorBusqueda está vacío', () => {
    expect(construirArbol(DATOS).abrirPorBusqueda.size).toBe(0);
  });
});

describe('construirArbol › otras agrupaciones', () => {
  test('por etapa: orden de ETAPAS y sin grupos vacíos', () => {
    const { grupos } = construirArbol(DATOS, { agruparPor: 'etapa' });
    expect(ids(grupos)).toEqual(['g:etapa:nueva', 'g:etapa:cotizada', 'g:etapa:negociacion', 'g:etapa:ganada', 'g:etapa:perdida']);
    expect(grupos.map((g) => g.titulo)).toEqual(['Nueva', 'Cotizada', 'Negociación', 'Ganada', 'Perdida']);
    expect(grupos[0]).toMatchObject({ conteo: 2, montoTotal: 1000, abiertas: 2 });
    expect(grupos[0].empresaId).toBeUndefined();
    expect(grupos[3]).toMatchObject({ abiertas: 0, montoGanado: 9300 });
  });

  test('por marca: AXIS, QNAP, MIXTA y Sin marca', () => {
    const { grupos } = construirArbol(DATOS, { agruparPor: 'marca' });
    expect(ids(grupos)).toEqual(['g:marca:AXIS', 'g:marca:QNAP', 'g:marca:MIXTA', 'g:marca:SIN']);
    expect(grupos[3].titulo).toBe('Sin marca');
    expect(grupos[0].conteo).toBe(2);
  });

  test('una agrupación desconocida cae en empresa', () => {
    expect(construirArbol(DATOS, { agruparPor: 'x' }).grupos[0].agrupacion).toBe('empresa');
  });
});

describe('construirArbol › filtros', () => {
  test('etapas: vacía = todas; con valores, solo esas', () => {
    expect(construirArbol(DATOS, { etapas: [] }).totales.oportunidades).toBe(6);
    expect(construirArbol(DATOS, { etapas: ['nueva', 'cotizada'] }).totales.oportunidades).toBe(3);
  });

  test('marca: una marca, Sin marca o todas', () => {
    expect(construirArbol(DATOS, { marca: 'AXIS' }).totales.oportunidades).toBe(2);
    expect(construirArbol(DATOS, { marca: 'SIN' }).totales.oportunidades).toBe(1);
    expect(construirArbol(DATOS, { marca: '' }).totales.oportunidades).toBe(6);
  });

  test('una marca fuera de la lista cuenta como Sin marca', () => {
    const datos = { oportunidades: [op({ id: 9, marca: 'OTRA' })] };
    expect(construirArbol(datos, { marca: 'SIN' }).totales.oportunidades).toBe(1);
    expect(ids(construirArbol(datos, { agruparPor: 'marca' }).grupos)).toEqual(['g:marca:SIN']);
  });
});

describe('construirArbol › búsqueda', () => {
  test('sin tildes ni mayúsculas, por empresa, título, contacto, BO y marca', () => {
    expect(construirArbol(DATOS, { busqueda: 'ALVAREZ' }).totales.oportunidades).toBe(1);
    expect(construirArbol(DATOS, { busqueda: 'camaras' }).totales.oportunidades).toBe(1);
    expect(construirArbol(DATOS, { busqueda: 'perez' }).totales.oportunidades).toBe(5);
    expect(construirArbol(DATOS, { busqueda: 'bo-1001' }).totales.oportunidades).toBe(1);
    expect(construirArbol(DATOS, { busqueda: 'mixta' }).totales.oportunidades).toBe(2);
  });

  test('todas las palabras deben aparecer', () => {
    expect(construirArbol(DATOS, { busqueda: 'acme camaras' }).totales.oportunidades).toBe(1);
    expect(construirArbol(DATOS, { busqueda: 'acme zeta' }).totales.oportunidades).toBe(0);
    expect(construirArbol(DATOS, { busqueda: '   ' }).totales.oportunidades).toBe(6);
  });

  test('por número de cotización con o sin #, proyecto, PID y usuario; muestra todas sus cotizaciones', () => {
    ['#1041', '1041', 'pid-77', 'proyecto norte', 'maria', 'ALEXIS'].forEach((q) => {
      const { grupos } = construirArbol(DATOS, { busqueda: q });
      expect(grupos.flatMap((g) => ids(g.oportunidades)), q).toContain('o:1');
    });
    const { grupos } = construirArbol(DATOS, { busqueda: '#1041' });
    expect(grupos).toHaveLength(1);
    expect(ids(grupos[0].oportunidades)).toEqual(['o:1']);
    expect(ids(grupos[0].oportunidades[0].cotizaciones)).toEqual(['c:1041', 'c:1038']);
  });

  test('también calza por la nota de seguimiento de la oportunidad, sin tildes ni mayúsculas', () => {
    const datos = {
      ...DATOS,
      oportunidades: DATOS.oportunidades.map((o) =>
        o.id === 5 ? { ...o, proximo_seguimiento: '2026-11-20', seguimiento_nota: 'Llamar a Ana por el DESCUENTO de envío' } : o
      )
    };
    ['descuento', 'envio', 'llamar a ana'].forEach((q) => {
      const { grupos, abrirPorBusqueda } = construirArbol(datos, { busqueda: q });
      expect(grupos.flatMap((g) => ids(g.oportunidades)), q).toEqual(['o:5']);
      // Calzó por la oportunidad misma: solo se abre el grupo, no la oportunidad.
      expect([...abrirPorBusqueda]).toEqual(['g:empresa:14']);
    });
    expect(construirArbol(datos, { busqueda: 'descuento zeta' }).totales.oportunidades).toBe(0);
    // Sin nota (null o ausente) no rompe ni calza con "null".
    expect(construirArbol(DATOS, { busqueda: 'null' }).totales.oportunidades).toBe(0);
    expect(construirArbol({ ...datos, oportunidades: datos.oportunidades.map((o) => ({ ...o, seguimiento_nota: null })) }, { busqueda: 'null' }).totales.oportunidades).toBe(0);
  });

  test('se puede combinar oportunidad y cotización', () => {
    expect(construirArbol(DATOS, { busqueda: 'acme 1038' }).totales.oportunidades).toBe(1);
  });

  test('abrirPorBusqueda: el grupo siempre; la oportunidad solo si calzó por una cotización', () => {
    const porCot = construirArbol(DATOS, { busqueda: '#1041' }).abrirPorBusqueda;
    expect([...porCot].sort()).toEqual(['g:empresa:12', 'o:1']);
    const porEmpresa = construirArbol(DATOS, { busqueda: 'beta' }).abrirPorBusqueda;
    expect([...porEmpresa]).toEqual(['g:empresa:13']);
  });

  test('el ids de grupo de abrirPorBusqueda sigue a la agrupación', () => {
    const set = construirArbol(DATOS, { busqueda: 'pid-77', agruparPor: 'marca' }).abrirPorBusqueda;
    expect([...set].sort()).toEqual(['g:marca:QNAP', 'o:1']);
  });
});

describe('construirArbol › datos sucios', () => {
  test('datos ausentes o sin listas', () => {
    [undefined, null, {}, { oportunidades: null, cotizaciones: 'x' }].forEach((d) => {
      const r = construirArbol(d);
      expect(r.grupos).toEqual([]);
      expect(r.totales).toEqual({ grupos: 0, oportunidades: 0, abiertas: 0, montoAbierto: 0, montoGanado: 0 });
    });
    expect(construirArbol({ oportunidades: [op()] }).grupos[0].oportunidades[0].cotizaciones).toEqual([]);
  });

  test('monto y total nulos o texto no rompen', () => {
    const datos = {
      oportunidades: [op({ id: 1, monto: null }), op({ id: 2, monto: 'abc' }), op({ id: 3, monto: '12.34' }), null, 5],
      cotizaciones: [cot({ oportunidad_id: 1, total: null }), null, { id: 5 }]
    };
    const g = construirArbol(datos).grupos[0];
    expect(g.conteo).toBe(3);
    expect(g.montoAbierto).toBe(12.34);
  });

  test('oportunidad sin empresa: grupo "Sin empresa" y sin empresaId', () => {
    const datos = { oportunidades: [op({ id: 1, empresa_id: null, empresa_nombre: null }), op({ id: 2, empresa_id: null, empresa_nombre: '' })] };
    const { grupos } = construirArbol(datos);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]).toMatchObject({ id: 'g:empresa:sin', titulo: 'Sin empresa', conteo: 2 });
    expect(grupos[0].empresaId).toBeUndefined();
  });

  test('empresa con id pero sin nombre', () => {
    const { grupos } = construirArbol({ oportunidades: [op({ empresa_nombre: undefined })] });
    expect(grupos[0]).toMatchObject({ titulo: 'Sin empresa', empresaId: 12 });
  });
});

describe('conteosPorEtapa', () => {
  test('cuenta con búsqueda y marca, sin el filtro de etapas', () => {
    expect(conteosPorEtapa(DATOS)).toEqual({ nueva: 2, cotizada: 1, negociacion: 1, ganada: 1, perdida: 1 });
    expect(conteosPorEtapa(DATOS, { marca: 'AXIS' })).toEqual({ nueva: 0, cotizada: 1, negociacion: 0, ganada: 1, perdida: 0 });
    expect(conteosPorEtapa(DATOS, { busqueda: '#1041' })).toEqual({ nueva: 0, cotizada: 0, negociacion: 1, ganada: 0, perdida: 0 });
  });

  test('datos vacíos', () => {
    expect(conteosPorEtapa(undefined)).toEqual({ nueva: 0, cotizada: 0, negociacion: 0, ganada: 0, perdida: 0 });
  });
});

describe('filasVisibles', () => {
  const arbol = construirArbol(DATOS);

  test('todo plegado: solo los grupos, con posición y tamaño', () => {
    const filas = filasVisibles(arbol, new Set());
    expect(filas).toHaveLength(4);
    expect(filas[0]).toMatchObject({ id: 'g:empresa:14', tipo: 'grupo', nivel: 1, expandible: true, expandido: false, padreId: null, posicion: 1, tamano: 4 });
    expect(filas[3]).toMatchObject({ posicion: 4, tamano: 4 });
  });

  test('desplegado: oportunidades y cotizaciones en orden de pantalla', () => {
    const filas = filasVisibles(arbol, new Set(['g:empresa:12', 'o:1']));
    expect(ids(filas)).toEqual([
      'g:empresa:14', 'g:empresa:15', 'g:empresa:12', 'o:1', 'c:1041', 'c:1038', 'o:2', 'o:3', 'g:empresa:13'
    ]);
    const o1 = filas.find((f) => f.id === 'o:1');
    expect(o1).toMatchObject({ nivel: 2, expandible: true, expandido: true, padreId: 'g:empresa:12', posicion: 1, tamano: 3 });
    const c = filas.find((f) => f.id === 'c:1038');
    expect(c).toMatchObject({ nivel: 3, expandible: false, expandido: false, padreId: 'o:1', posicion: 2, tamano: 2 });
    expect(c.nodo.cot.numero).toBe(1038);
  });

  test('una oportunidad sin cotizaciones no es expandible', () => {
    const filas = filasVisibles(arbol, new Set(['g:empresa:12', 'o:3']));
    expect(filas.find((f) => f.id === 'o:3')).toMatchObject({ expandible: false, expandido: false });
  });

  test('un hijo no se ve si su abuelo está plegado aunque su padre esté en el Set', () => {
    const filas = filasVisibles(arbol, new Set(['o:1']));
    expect(ids(filas).includes('o:1')).toBe(false);
    expect(ids(filas).includes('c:1041')).toBe(false);
  });

  test('acepta un arreglo y datos vacíos', () => {
    expect(filasVisibles(arbol, ['g:empresa:13'])).toHaveLength(5);
    expect(filasVisibles(undefined, undefined)).toEqual([]);
  });
});

describe('moverFoco', () => {
  const arbol = construirArbol(DATOS);
  const filas = filasVisibles(arbol, new Set(['g:empresa:12', 'o:1']));
  // g14, g15, g12, o1, c1041, c1038, o2, o3, g13

  test('ArrowDown / ArrowUp y bordes', () => {
    expect(moverFoco(filas, 'g:empresa:14', 'ArrowDown')).toEqual({ foco: 'g:empresa:15', expandir: null, contraer: null });
    expect(moverFoco(filas, 'g:empresa:15', 'ArrowUp').foco).toBe('g:empresa:14');
    expect(moverFoco(filas, 'g:empresa:14', 'ArrowUp').foco).toBe('g:empresa:14');
    expect(moverFoco(filas, 'g:empresa:13', 'ArrowDown').foco).toBe('g:empresa:13');
  });

  test('Home y End', () => {
    expect(moverFoco(filas, 'c:1041', 'Home').foco).toBe('g:empresa:14');
    expect(moverFoco(filas, 'c:1041', 'End').foco).toBe('g:empresa:13');
    expect(moverFoco(filas, 'g:empresa:14', 'Home').foco).toBe('g:empresa:14');
  });

  test('ArrowRight: expande si está plegada, va al primer hijo si está desplegada, nada en hojas', () => {
    expect(moverFoco(filas, 'g:empresa:15', 'ArrowRight')).toEqual({ foco: 'g:empresa:15', expandir: 'g:empresa:15', contraer: null });
    expect(moverFoco(filas, 'g:empresa:12', 'ArrowRight')).toEqual({ foco: 'o:1', expandir: null, contraer: null });
    expect(moverFoco(filas, 'o:1', 'ArrowRight').foco).toBe('c:1041');
    expect(moverFoco(filas, 'c:1041', 'ArrowRight')).toEqual({ foco: 'c:1041', expandir: null, contraer: null });
    // Oportunidad sin cotizaciones: no es expandible.
    expect(moverFoco(filas, 'o:3', 'ArrowRight')).toEqual({ foco: 'o:3', expandir: null, contraer: null });
  });

  test('ArrowLeft: contrae si está desplegada, si no sube al padre; los grupos plegados no se mueven', () => {
    expect(moverFoco(filas, 'g:empresa:12', 'ArrowLeft')).toEqual({ foco: 'g:empresa:12', expandir: null, contraer: 'g:empresa:12' });
    expect(moverFoco(filas, 'c:1041', 'ArrowLeft').foco).toBe('o:1');
    expect(moverFoco(filas, 'o:2', 'ArrowLeft').foco).toBe('g:empresa:12');
    expect(moverFoco(filas, 'g:empresa:15', 'ArrowLeft')).toEqual({ foco: 'g:empresa:15', expandir: null, contraer: null });
  });

  test('teclas ajenas, id desconocido y lista vacía', () => {
    expect(moverFoco(filas, 'g:empresa:14', 'a')).toEqual({ foco: 'g:empresa:14', expandir: null, contraer: null });
    expect(moverFoco(filas, 'zzz', 'ArrowDown').foco).toBe('g:empresa:14');
    expect(moverFoco([], 'x', 'ArrowDown')).toEqual({ foco: 'x', expandir: null, contraer: null });
    expect(moverFoco(undefined, null, 'End')).toEqual({ foco: null, expandir: null, contraer: null });
  });
});

describe('preferencias', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  test('valores por defecto', () => {
    expect(leerPreferencias()).toEqual({ agruparPor: 'empresa', etapas: ['nueva', 'cotizada', 'negociacion'], marca: '', expandidos: [] });
  });

  test('guardar y leer', () => {
    guardarPreferencias({ agruparPor: 'marca', etapas: ['ganada'], marca: 'SIN', expandidos: ['g:marca:AXIS', 'o:4'] });
    expect(JSON.parse(window.localStorage.getItem('crmArbol')).agruparPor).toBe('marca');
    expect(leerPreferencias()).toEqual({ agruparPor: 'marca', etapas: ['ganada'], marca: 'SIN', expandidos: ['g:marca:AXIS', 'o:4'] });
  });

  test('etapas vacías se respetan (= todas)', () => {
    guardarPreferencias({ agruparPor: 'etapa', etapas: [], marca: '', expandidos: [] });
    expect(leerPreferencias().etapas).toEqual([]);
  });

  test('sanea valores inválidos', () => {
    window.localStorage.setItem('crmArbol', JSON.stringify({
      agruparPor: 'otra', etapas: ['ganada', 'xx', 'ganada', 3], marca: 'ZZZ', expandidos: ['g:a:1', 5, 'x:2', 'o:', 'o:7', 'g:a:1']
    }));
    expect(leerPreferencias()).toEqual({ agruparPor: 'empresa', etapas: ['ganada'], marca: '', expandidos: ['g:a:1', 'o:7'] });
    window.localStorage.setItem('crmArbol', JSON.stringify({ etapas: 'x', expandidos: 'y' }));
    expect(leerPreferencias()).toEqual({ agruparPor: 'empresa', etapas: ['nueva', 'cotizada', 'negociacion'], marca: '', expandidos: [] });
  });

  test('JSON roto o storage que falla no lanzan', () => {
    window.localStorage.setItem('crmArbol', '{roto');
    expect(leerPreferencias().agruparPor).toBe('empresa');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('lleno'); });
    expect(leerPreferencias().marca).toBe('');
    expect(() => guardarPreferencias({ agruparPor: 'marca' })).not.toThrow();
  });
});
