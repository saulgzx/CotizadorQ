const n = require('../src/crm/normalizar');

describe('normalizarNombreEmpresa', () => {
  test.each([
    ['SONDA S.A.', 'sonda'],
    ['Sonda SA', 'sonda'],
    ['sonda', 'sonda'],
    ['  Sonda   S.A.  ', 'sonda'],
    ['Ingeniería Ltda.', 'ingenieria'],
    ['ingenieria', 'ingenieria'],
    ['INGENIERÍA LIMITADA', 'ingenieria'],
    ['Comercial Ñuñoa SpA', 'comercial nunoa'],
    ['Foo S.p.A.', 'foo'],
    ['Andes S.A.C.', 'andes'],
    ['ACME, Inc.', 'acme'],
    ['Globex LLC', 'globex'],
    ['Pérez y Cía. Ltda.', 'perez'],
    ['Servicios Cía', 'servicios'],
    ['Juan Pérez E.I.R.L.', 'juan perez'],
    ['Juan Pérez EIRL', 'juan perez'],
    ['Seguridad & Redes S.A.', 'seguridad redes'],
    ['Intcomex-Chile', 'intcomex chile']
  ])('%p -> %p', (entrada, esperado) => {
    expect(n.normalizarNombreEmpresa(entrada)).toBe(esperado);
  });

  test('las tres formas de SONDA y de Ingenieria colapsan a la misma clave', () => {
    const sonda = new Set(['SONDA S.A.', 'Sonda SA', 'sonda'].map(n.normalizarNombreEmpresa));
    const ing = new Set(['Ingeniería Ltda.', 'ingenieria'].map(n.normalizarNombreEmpresa));
    expect([...sonda]).toEqual(['sonda']);
    expect([...ing]).toEqual(['ingenieria']);
  });

  test('un sufijo solo no queda vacio, y "sa" dentro del nombre no se toca', () => {
    expect(n.normalizarNombreEmpresa('S.A.')).toBe('s a');
    expect(n.normalizarNombreEmpresa('SA')).toBe('sa');
    expect(n.normalizarNombreEmpresa('Salsa SA')).toBe('salsa');
    expect(n.normalizarNombreEmpresa('Casa Ltda Norte')).toBe('casa ltda norte');
  });
});

describe('esValorBasura', () => {
  test.each(['', '   ', null, undefined, 'N/A', 'n/a', 'NA', 'n.a.', '-', '--', '.', '...', 'S/N', 'Sin empresa', 'null', 'x'])(
    '%p es basura',
    (v) => {
      expect(n.esValorBasura(v)).toBe(true);
    }
  );
  test.each(['Sonda', 'Ana', 'NAS Chile', 'Xtreme', 'Nasa'])('%p es un nombre util', (v) => {
    expect(n.esValorBasura(v)).toBe(false);
  });
});

describe('normalizarEmail', () => {
  test('minusculas y sin espacios; lo que no es email queda null', () => {
    expect(n.normalizarEmail('  Ana@Sonda.CL ')).toBe('ana@sonda.cl');
    expect(n.normalizarEmail('PID-1')).toBeNull();
    expect(n.normalizarEmail('N/A')).toBeNull();
    expect(n.normalizarEmail('')).toBeNull();
    expect(n.normalizarEmail(null)).toBeNull();
  });
});

describe('marca y etapa', () => {
  test('marcaDesdeOrigenes: AXIS, QNAP, MIXTA o null', () => {
    expect(n.marcaDesdeOrigenes(['AXIS', 'axis'])).toBe('AXIS');
    expect(n.marcaDesdeOrigenes(['QNAP'])).toBe('QNAP');
    expect(n.marcaDesdeOrigenes(['AXIS', 'QNAP'])).toBe('MIXTA');
    expect(n.marcaDesdeOrigenes([])).toBeNull();
    expect(n.marcaDesdeOrigenes([null, 'OTRO'])).toBeNull();
    expect(n.marcaDesdeOrigenes(undefined)).toBeNull();
  });

  test('combinarMarcas', () => {
    expect(n.combinarMarcas(null, 'AXIS')).toBe('AXIS');
    expect(n.combinarMarcas('AXIS', null)).toBe('AXIS');
    expect(n.combinarMarcas('AXIS', 'AXIS')).toBe('AXIS');
    expect(n.combinarMarcas('AXIS', 'QNAP')).toBe('MIXTA');
  });

  test.each([
    ['revision', 'cotizada'],
    ['pendiente', 'cotizada'],
    ['enviada', 'cotizada'],
    ['aprobada', 'ganada'],
    ['rechazada', 'perdida'],
    [null, 'cotizada']
  ])('estado %p -> etapa %p', (estado, etapa) => {
    expect(n.etapaDesdeEstado(estado)).toBe(etapa);
  });
});

describe('duplicados', () => {
  test('distanciaEdicion', () => {
    expect(n.distanciaEdicion('sonda', 'sonda')).toBe(0);
    expect(n.distanciaEdicion('sonda', 'sondas')).toBe(1);
    expect(n.distanciaEdicion('kitten', 'sitting')).toBe(3);
    expect(n.distanciaEdicion('abc', 'xyzxyz', 1)).toBe(2); // corta al pasar el maximo
  });

  test.each([
    ['sonda', 'sonda chile', 'contiene'],
    ['intcomex', 'intcomex chile', 'contiene'],
    ['inter sistemas', 'intersistemas', 'parecido'],
    ['sonda', 'sondas', 'parecido'],
    ['ingenieria', 'ingeneria', 'parecido'],
    ['constructora alfa', 'constructora alba', 'parecido']
  ])('%p ~ %p (%s)', (a, b, motivo) => {
    expect(n.compararNombres(a, b)).toBe(motivo);
  });

  test.each([
    ['acme', 'acma'], // demasiado corto para tolerar diferencias
    ['ibm', 'ibm chile'], // nombre corto: "contiene" exige 4 letras
    ['empresa 75', 'empresa 76'], // distinto numero
    ['colegio 1', 'colegio 12'],
    ['constructora alfa', 'constructora delta'],
    ['sondaje', 'sonda'] // "contiene" va por palabras, no por letras
  ])('%p y %p NO son duplicados', (a, b) => {
    expect(n.compararNombres(a, b)).toBeNull();
  });

  test('agruparDuplicados: grupos por semilla, sin cadenas, y deja fuera los unicos', () => {
    const empresas = [
      { id: 1, nombre: 'SONDA S.A.' },
      { id: 2, nombre: 'Sonda Chile' },
      { id: 3, nombre: 'Ingeniería Ltda.' },
      { id: 4, nombre: 'Ingenieria Sur' },
      { id: 5, nombre: 'Globex' },
      { id: 6, nombre: 'Empresa 75' },
      { id: 7, nombre: 'Empresa 76' }
    ].map((e) => ({ ...e, nombre_normalizado: n.normalizarNombreEmpresa(e.nombre) }));
    const grupos = n.agruparDuplicados(empresas);
    expect(grupos.map((g) => g.empresas.map((e) => e.id))).toEqual([
      [1, 2],
      [3, 4]
    ]);
    expect(grupos[0].motivo).toBe('Un nombre contiene al otro');
  });

  test('una serie de nombres parecidos no se junta en un grupo gigante', () => {
    // a~b y b~c, pero a y c no se parecen: no se unen en cadena.
    const empresas = ['abcdefgh', 'abcdefgx', 'abcdefxx'].map((nombre, i) => ({ id: i + 1, nombre, nombre_normalizado: nombre }));
    const grupos = n.agruparDuplicados(empresas);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].empresas.map((e) => e.id)).toEqual([1, 2]);
  });
});
