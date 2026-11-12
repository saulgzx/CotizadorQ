import { cotizacionesAPI, LOTE_IDS_COTIZACIONES } from './api';

const respuesta = (cuerpo, ok = true, status = 200) => ({ ok, status, json: async () => cuerpo });

describe('cotizacionesAPI: archivar y restaurar por lotes', () => {
  let fetchMock;

  beforeEach(() => {
    localStorage.setItem('token', 'token-de-prueba');
    fetchMock = vi.fn(async (_url, opciones) => {
      const { ids } = JSON.parse(opciones.body);
      return respuesta({ cotizaciones: ids.length, oportunidades: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const lotes = () => fetchMock.mock.calls.map(([, opciones]) => JSON.parse(opciones.body).ids.length);

  test('archivar más de 500 ids los envía en lotes y suma los conteos', async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => i + 1);
    const resultado = await cotizacionesAPI.archivar({ ids });
    expect(lotes()).toEqual([LOTE_IDS_COTIZACIONES, LOTE_IDS_COTIZACIONES, 201]);
    expect(fetchMock.mock.calls.every(([url]) => url.endsWith('/api/cotizaciones/archivar'))).toBe(true);
    expect(resultado).toEqual({ cotizaciones: 1201, oportunidades: 3 });
  });

  test('descarta ids repetidos o no válidos antes de enviar', async () => {
    await cotizacionesAPI.restaurar([5, '5', 7, null, 0, 'x', 7.5]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ids: [5, 7] });
  });

  test('sin ids válidos no llama al servidor', async () => {
    expect(await cotizacionesAPI.archivar({ ids: [] })).toEqual({ cotizaciones: 0, oportunidades: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('archivar por fecha envía antes_de en una sola llamada', async () => {
    fetchMock.mockImplementation(async () => respuesta({ cotizaciones: 9, oportunidades: 4 }));
    expect(await cotizacionesAPI.archivar({ antesDe: '2026-11-10' })).toEqual({ cotizaciones: 9, oportunidades: 4 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ antes_de: '2026-11-10' });
  });

  test('un error de validación muestra el detalle del servidor', async () => {
    fetchMock.mockImplementation(async () => respuesta({ error: 'Payload invalido', details: ['ids admite como maximo 500 elementos'] }, false, 400));
    await expect(cotizacionesAPI.archivar({ ids: [1] })).rejects.toThrow('Payload invalido: ids admite como maximo 500 elementos');
  });
});
