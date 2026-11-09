import {
  construirMensajeInicial,
  textoDeContenido,
  extraerListaDeRespuesta
} from './asistenteIA';

describe('asistente IA: mensaje y contenido', () => {
  test('el primer mensaje lleva los datos del cliente y el requerimiento', () => {
    expect(
      construirMensajeInicial({
        requerimiento: ' Cotizar TS-464 ',
        cliente: 'Acme',
        notas: 'urgente'
      })
    ).toBe(
      'Cliente: Acme\nNotas internas (no van en el correo): urgente\n\nRequerimiento:\nCotizar TS-464'
    );
    expect(construirMensajeInicial({ requerimiento: 'x' })).toBe(
      'Requerimiento:\nx'
    );
  });

  test('el texto visible ignora bloques de herramientas', () => {
    const contenido = [
      { type: 'mcp_tool_use' },
      { type: 'text', text: 'Hola' },
      { type: 'thinking' },
      { type: 'text', text: 'Chao' }
    ];
    expect(textoDeContenido(contenido)).toBe('Hola\n\nChao');
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
