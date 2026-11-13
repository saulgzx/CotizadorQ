import { extraerQuote, leerQuote } from './leerQuote';

vi.mock('../../api', () => ({ iaAPI: {} }));

describe('extraerQuote', () => {
  const completo = {
    moneda: 'usd',
    descuento_global_pct: 10,
    lineas: [{ mpn: 'A-1', descripcion: 'Equipo', cantidad: 2, costo_unitario: '100.00', total_linea: '200.00' }],
    notas: 'ok'
  };
  const esperado = {
    lineas: [{ mpn: 'A-1', descripcion: 'Equipo', cantidad: 2, costo_unitario: '100.00', total_linea: '200.00' }],
    moneda: 'USD',
    descuentoGlobalPct: 10,
    notas: 'ok'
  };

  test('bloque ```json', () => {
    expect(extraerQuote(`Listo.\n\`\`\`json\n${JSON.stringify(completo)}\n\`\`\``)).toEqual(esperado);
  });

  test('bloque sin la palabra json', () => {
    expect(extraerQuote(`\`\`\`\n${JSON.stringify(completo)}\n\`\`\``)).toEqual(esperado);
  });

  test('objeto suelto, con texto alrededor', () => {
    expect(extraerQuote(`Aquí va: ${JSON.stringify(completo)} Saludos`)).toEqual(esperado);
  });

  test('array suelto de líneas, sin envoltorio', () => {
    const r = extraerQuote(JSON.stringify(completo.lineas));
    expect(r.lineas).toEqual(esperado.lineas);
    expect(r.moneda).toBe('');
    expect(r.descuentoGlobalPct).toBeNull();
    expect(r.notas).toBe('');
  });

  test('array en bloque de código', () => {
    expect(extraerQuote(`\`\`\`json\n${JSON.stringify(completo.lineas)}\n\`\`\``).lineas).toHaveLength(1);
  });

  test('descuento como texto con % o formato', () => {
    expect(extraerQuote('{"lineas":[],"descuento_global_pct":"12.5%"}').descuentoGlobalPct).toBe(12.5);
    expect(extraerQuote('{"lineas":[],"descuento_global_pct":0}').descuentoGlobalPct).toBeNull();
    expect(extraerQuote('{"lineas":[],"descuento_global_pct":null}').descuentoGlobalPct).toBeNull();
  });

  test('descripcion también como desc; claves camelCase', () => {
    const r = extraerQuote('{"lineas":[{"mpn":"A","desc":"X","qty":1,"costoUnitario":5,"totalLinea":5}]}');
    expect(r.lineas[0]).toEqual({ mpn: 'A', descripcion: 'X', cantidad: 1, costo_unitario: 5, total_linea: 5 });
  });

  test('descarta entradas que no son objetos', () => {
    expect(extraerQuote('{"lineas":[null,"x",3,[],{"mpn":"A"}]}').lineas).toHaveLength(1);
  });

  test('objeto sin lineas, o lineas que no es array', () => {
    expect(extraerQuote('{"moneda":"EUR"}')).toEqual({ lineas: [], moneda: 'EUR', descuentoGlobalPct: null, notas: '' });
    expect(extraerQuote('{"lineas":"nada"}').lineas).toEqual([]);
  });

  test.each([['```json\n{"lineas": [\n```'], ['{"lineas": [}'], ['No es un quote.'], [''], [null], [undefined], ['[1,2'], ['"hola"'], ['5']])(
    'basura %p -> vacío sin lanzar',
    (texto) => {
      expect(extraerQuote(texto)).toEqual({ lineas: [], moneda: '', descuentoGlobalPct: null, notas: '' });
    }
  );
});

describe('leerQuote', () => {
  const file = { type: 'application/pdf' };
  const respuesta = {
    moneda: 'USD',
    descuento_global_pct: null,
    lineas: [{ mpn: 'A-1', descripcion: 'Equipo', cantidad: 2, costo_unitario: '100.00', total_linea: '200.00' }],
    notas: ''
  };

  beforeEach(() => {
    globalThis.FileReader = class {
      readAsDataURL() {
        this.result = 'data:application/pdf;base64,QUJD';
        this.onload();
      }
    };
  });

  test('manda el pantallazo de quote y devuelve líneas normalizadas', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'q1' }),
      obtener: vi
        .fn()
        .mockResolvedValueOnce({ estado: 'en_curso' })
        .mockResolvedValueOnce({ estado: 'lista', texto: `\`\`\`json\n${JSON.stringify(respuesta)}\n\`\`\`` })
    };
    const r = await leerQuote({ file, fabricante: 'iss', api, dormir: async () => {} });
    expect(api.iniciar).toHaveBeenCalledWith({
      pantallazo: { datos: 'QUJD', mime: 'application/pdf', campo: 'quote', fabricante: 'ISS' }
    });
    expect(api.obtener).toHaveBeenCalledTimes(2);
    expect(r.lineas).toEqual([
      { mpn: 'A-1', descripcion: 'Equipo', cantidad: 2, costoUnitario: 100, totalLinea: 200, tipo: null, problemas: [] }
    ]);
    expect(r.moneda).toBe('USD');
    expect(r.descuentoGlobalPct).toBeNull();
    expect(r.avisos).toEqual([]);
  });

  test('suma los avisos de líneas y los del quote (EUR, descuento, notas)', async () => {
    const texto = JSON.stringify({
      moneda: 'EUR',
      descuento_global_pct: '5',
      lineas: [{ mpn: 'A', cantidad: 1, costo_unitario: '' }],
      notas: 'Borroso'
    });
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'q1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'lista', texto })
    };
    const { avisos, descuentoGlobalPct, notas } = await leerQuote({ file, fabricante: 'NEURAL', api, dormir: async () => {} });
    expect(descuentoGlobalPct).toBe(5);
    expect(notas).toBe('Borroso');
    const todo = avisos.join('\n');
    expect(todo).toMatch(/costo unitario/);
    expect(todo).toMatch(/EUR/);
    expect(todo).toMatch(/descuento global de 5%/);
    expect(todo).toMatch(/Nota del lector: Borroso/);
  });

  test('Milestone sugiere el tipo', async () => {
    const texto = JSON.stringify({
      moneda: 'USD',
      lineas: [{ mpn: 'HUSKY-M30', descripcion: 'Husky M30', cantidad: 1, costo_unitario: 100, total_linea: 100 }]
    });
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'q1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'lista', texto })
    };
    const r = await leerQuote({ file, fabricante: 'MILESTONE', api, dormir: async () => {} });
    expect(r.lineas[0].tipo).toBe('servidor');
  });

  test('respuesta sin quote legible: vacío con aviso, sin lanzar', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'q1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'lista', texto: 'No pude leer el documento.' })
    };
    const r = await leerQuote({ file, fabricante: 'ISS', api, dormir: async () => {} });
    expect(r.lineas).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/No se encontraron líneas/);
  });

  test('propaga el error del lector', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'q1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'error', error: 'El agente no está corriendo' })
    };
    await expect(leerQuote({ file, fabricante: 'ISS', api, dormir: async () => {} })).rejects.toThrow('El agente no está corriendo');
  });

  test('error sin mensaje usa uno genérico', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'q1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'error' })
    };
    await expect(leerQuote({ file, fabricante: 'ISS', api, dormir: async () => {} })).rejects.toThrow('No se pudo leer el quote');
  });

  test('si la miniPC no responde, corta y cancela el trabajo', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'q1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'en_curso' }),
      cancelar: vi.fn().mockResolvedValue(undefined)
    };
    await expect(leerQuote({ file, fabricante: 'ISS', api, dormir: async () => {}, limiteMs: -1 })).rejects.toThrow('miniPC');
    expect(api.cancelar).toHaveBeenCalledWith('q1');
  });

  test('si cancelar falla igual lanza el error de tiempo', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'q1' }),
      obtener: vi.fn(),
      cancelar: vi.fn().mockRejectedValue(new Error('red'))
    };
    await expect(leerQuote({ file, fabricante: 'ISS', api, dormir: async () => {}, limiteMs: -1 })).rejects.toThrow('miniPC');
  });

  test('fabricante desconocido: lanza antes de mandar nada', async () => {
    const api = { iniciar: vi.fn(), obtener: vi.fn() };
    await expect(leerQuote({ file, fabricante: 'AXIS', api, dormir: async () => {} })).rejects.toThrow(/Fabricante desconocido/);
    expect(api.iniciar).not.toHaveBeenCalled();
  });
});
