import { extraerFilas, leerPantallazo } from './leerPantallazo';

vi.mock('../../api', () => ({ iaAPI: {} }));

describe('extraerFilas', () => {
  test('lee el bloque ```json de la respuesta', () => {
    const texto = [
      'Listo, leí la imagen.',
      '```json',
      '[{"sku":"02345-001","mpn":"P1475-LE","descripcion":"AXIS P1475-LE","monto":"410.00"}]',
      '```'
    ].join('\n');
    expect(extraerFilas(texto)).toEqual([
      { sku: '02345-001', mpn: 'P1475-LE', descripcion: 'AXIS P1475-LE', monto: '410.00' }
    ]);
  });

  test('tolera el array sin bloque de código', () => {
    expect(extraerFilas('[{"mpn":"P1475-LE","monto":410}]')).toEqual([
      { sku: '', mpn: 'P1475-LE', descripcion: '', monto: 410 }
    ]);
  });

  test('acepta desc como alias de descripcion', () => {
    expect(extraerFilas('[{"desc":"AXIS P1475-LE","monto":1}]')[0].descripcion).toBe('AXIS P1475-LE');
  });

  test('un JSON roto devuelve vacío en vez de reventar', () => {
    expect(extraerFilas('```json\n[{"sku": \n```')).toEqual([]);
    expect(extraerFilas('No encontré ninguna tabla.')).toEqual([]);
    expect(extraerFilas('')).toEqual([]);
    expect(extraerFilas(null)).toEqual([]);
  });

  test('descarta entradas que no son objetos', () => {
    expect(extraerFilas('[null, "x", {"mpn":"A","monto":"1"}]')).toHaveLength(1);
  });

  test('un objeto suelto en vez de array no se toma como fila', () => {
    expect(extraerFilas('```json\n{"sku":"A"}\n```')).toEqual([]);
  });
});

describe('leerPantallazo', () => {
  const file = { type: 'image/png' };
  const lineas = [{ sku: '02345-001', mpn: 'P1475-LE', desc: 'AXIS P1475-LE' }];

  beforeEach(() => {
    // archivoABase64 usa FileReader, que no existe en jsdom para objetos falsos.
    globalThis.FileReader = class {
      readAsDataURL() {
        this.result = 'data:image/png;base64,QUJD';
        this.onload();
      }
    };
  });

  test('manda el pantallazo y devuelve los montos ya calzados', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'c1' }),
      obtener: vi
        .fn()
        .mockResolvedValueOnce({ estado: 'en_curso' })
        .mockResolvedValueOnce({
          estado: 'lista',
          texto: '```json\n[{"mpn":"P1475-LE","monto":"$410.00"}]\n```'
        })
    };

    const r = await leerPantallazo({
      file,
      campo: 'intcomex',
      lineas,
      api,
      dormir: async () => {}
    });

    expect(api.iniciar).toHaveBeenCalledWith({
      marca: 'AXIS',
      mensajes: [{ role: 'user', content: expect.stringContaining('OC') }],
      pantallazo: {
        datos: 'QUJD',
        mime: 'image/png',
        campo: 'intcomex',
        lineas: [{ sku: '02345-001', mpn: 'P1475-LE', desc: 'AXIS P1475-LE' }]
      }
    });
    expect(r.asignaciones).toEqual({ '02345-001||p1475-le': 410 });
    expect(r.filas).toHaveLength(1);
  });

  test('el texto del prompt cambia según el campo', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'c1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'lista', texto: '[]' })
    };

    await leerPantallazo({ file, campo: 'axis', lineas, api, dormir: async () => {} });

    expect(api.iniciar.mock.calls[0][0].mensajes[0].content).toContain('Axis');
  });

  test('propaga el error de la consulta', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'c1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'error', error: 'El agente no está corriendo' })
    };

    await expect(
      leerPantallazo({ file, campo: 'axis', lineas, api, dormir: async () => {} })
    ).rejects.toThrow('El agente no está corriendo');
  });

  test('si la miniPC no responde, corta y cancela el trabajo', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'c1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'en_curso' }),
      cancelar: vi.fn().mockResolvedValue(undefined)
    };

    await expect(
      leerPantallazo({
        file,
        campo: 'axis',
        lineas,
        api,
        dormir: async () => {},
        limiteMs: -1
      })
    ).rejects.toThrow('miniPC');
    expect(api.cancelar).toHaveBeenCalledWith('c1');
  });

  test('una respuesta sin filas no asigna nada y deja las líneas sin dato', async () => {
    const api = {
      iniciar: vi.fn().mockResolvedValue({ id: 'c1' }),
      obtener: vi.fn().mockResolvedValue({ estado: 'lista', texto: 'No pude leer la imagen.' })
    };

    const r = await leerPantallazo({ file, campo: 'axis', lineas, api, dormir: async () => {} });

    expect(r.filas).toEqual([]);
    expect(r.asignaciones).toEqual({});
    expect(r.lineasSinDato).toEqual(['02345-001||p1475-le']);
  });
});
