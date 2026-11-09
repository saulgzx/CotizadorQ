import {
  construirPrompt,
  construirDestino,
  configVacia,
  normalizarConfig,
  urlProyectoValida,
  extraerListaDeRespuesta
} from './asistenteIA';

describe('asistente IA: prompt y destino', () => {
  test('el prompt invoca la skill de la marca e incluye el requerimiento', () => {
    const p = construirPrompt({
      marca: 'QNAP',
      requerimiento: 'Cotizar TS-464',
      cliente: 'Acme'
    });
    expect(p).toContain('preventa-qnap');
    expect(p).toContain('Cliente: Acme');
    expect(p).toContain('Cotizar TS-464');
    expect(p).toContain('LISTA COTIZADORQ');
    expect(
      construirPrompt({ marca: 'AXIS', requerimiento: 'x', pedirLista: false })
    ).not.toContain('LISTA COTIZADORQ');
  });

  test('Claude sin proyecto abre un chat nuevo con el prompt en ?q=', () => {
    const d = construirDestino({
      proveedor: 'claude',
      marca: 'AXIS',
      config: configVacia(),
      prompt: 'hola mundo'
    });
    expect(d.prefill).toBe(true);
    expect(new URL(d.url).searchParams.get('q')).toBe('hola mundo');
  });

  test('con proyecto configurado abre el proyecto y usa el portapapeles', () => {
    const config = configVacia();
    config.proyectos.claude.AXIS = 'https://claude.ai/project/abc';
    const d = construirDestino({
      proveedor: 'claude',
      marca: 'AXIS',
      config,
      prompt: 'x'
    });
    expect(d).toEqual({
      url: 'https://claude.ai/project/abc',
      usaProyecto: true,
      prefill: false
    });
  });

  test('prompt demasiado largo no va en la URL', () => {
    const d = construirDestino({
      proveedor: 'chatgpt',
      marca: 'QNAP',
      config: configVacia(),
      prompt: 'a'.repeat(9000)
    });
    expect(d).toEqual({
      url: 'https://chatgpt.com/',
      usaProyecto: false,
      prefill: false
    });
  });

  test('solo acepta URLs https del dominio del proveedor', () => {
    expect(urlProyectoValida('claude', 'https://claude.ai/project/1')).toBe(
      true
    );
    expect(urlProyectoValida('claude', 'javascript:alert(1)')).toBe(false);
    expect(urlProyectoValida('claude', 'https://evil.com/claude.ai/')).toBe(
      false
    );
    expect(urlProyectoValida('otra', 'http://inseguro.com')).toBe(false);
    expect(normalizarConfig({ proveedor: 'nope' }).proveedor).toBe('claude');
  });
});

describe('asistente IA: leer la respuesta', () => {
  test('prioriza el bloque LISTA COTIZADORQ', () => {
    const r = extraerListaDeRespuesta(
      'preview...\n\nLISTA COTIZADORQ\n```\n100010879\t2\nRAIL-B02\t1\n```\n'
    );
    expect(r).toEqual({ origen: 'bloque', texto: '100010879\t2\nRAIL-B02\t1' });
  });

  test('lee la tabla markdown del preview: SKU o MPN si es To Create', () => {
    const texto = [
      'Andrea.',
      '',
      '| Marca | Cant. | SKU | MPN | Descripción | P. Unit. | P. Total | Entrega |',
      '|---|---|---|---|---|---|---|---|',
      '| Axis | 4 | 100010879 | 02747-001 | AXIS P1475-LE | $1,234.00 | **$4,936.00** | 8 - 10 semanas tras OC |',
      '| Axis | 2 | To Create | 01234-002 | AXIS T8120 | $90.00 | **$180.00** | Stock |',
      '',
      'Quedo atento'
    ].join('\n');
    expect(extraerListaDeRespuesta(texto)).toEqual({
      origen: 'tabla',
      texto: '100010879\t4\n01234-002\t2'
    });
  });

  test('tabla pegada desde Outlook (tabs)', () => {
    const texto =
      'Marca\tCant.\tSKU\tMPN\nQNAP\t1\tNW001QNA07\tTS-435XeU-4G-US';
    expect(extraerListaDeRespuesta(texto).texto).toBe('NW001QNA07\t1');
  });

  test('sin tabla ni bloque devuelve el texto', () => {
    expect(extraerListaDeRespuesta('2 x RAIL-B02')).toEqual({
      origen: 'texto',
      texto: '2 x RAIL-B02'
    });
  });
});
