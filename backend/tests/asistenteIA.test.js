const {
  validarEntrada,
  construirParametros,
  construirSistema,
  crearGestorConsultas,
  faltantes,
  leerConfig
} = require('../src/services/asistenteIA');

const config = leerConfig({
  ANTHROPIC_API_KEY: 'sk-test',
  MYQUOTE_MCP_URL: 'https://mcp.example/mcp',
  MYQUOTE_MCP_TOKEN: 'secreto'
});

// Stream falso: emite eventos y resuelve con el mensaje final indicado.
const streamFalso = (mensaje, eventos = []) => {
  const handlers = [];
  return {
    on: (nombre, fn) => nombre === 'streamEvent' && handlers.push(fn),
    abort: jest.fn(),
    finalMessage: async () => {
      eventos.forEach((e) => handlers.forEach((h) => h(e)));
      return mensaje;
    }
  };
};

const esperar = async (gestor, args) => {
  for (let i = 0; i < 50; i += 1) {
    const c = gestor.obtener(args);
    if (c.estado !== 'en_curso') return c;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('la consulta no termino');
};

describe('asistente IA', () => {
  test('exige las tres variables de configuracion', () => {
    expect(faltantes(leerConfig({}))).toEqual([
      'ANTHROPIC_API_KEY',
      'MYQUOTE_MCP_URL',
      'MYQUOTE_MCP_TOKEN'
    ]);
    expect(faltantes(config)).toEqual([]);
  });

  test('valida la conversacion', () => {
    expect(() =>
      validarEntrada({
        marca: 'SONY',
        mensajes: [{ role: 'user', content: 'x' }]
      })
    ).toThrow(/Marca/);
    expect(() => validarEntrada({ marca: 'AXIS', mensajes: [] })).toThrow(
      /vacia/
    );
    expect(() =>
      validarEntrada({
        marca: 'axis',
        mensajes: [{ role: 'assistant', content: [] }]
      })
    ).toThrow(/mal formada/);
    expect(() =>
      validarEntrada({
        marca: 'AXIS',
        mensajes: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: [] }
        ]
      })
    ).toThrow(/usuario/);
    const ok = validarEntrada({
      marca: 'qnap',
      mensajes: [{ role: 'user', content: 'Cotizar TS-464', extra: 1 }]
    });
    expect(ok).toEqual({
      marca: 'QNAP',
      mensajes: [{ role: 'user', content: 'Cotizar TS-464' }]
    });
  });

  test('las instrucciones cargan la skill y sus referencias', () => {
    const axis = construirSistema('AXIS');
    expect(axis).toContain('<skill nombre="preventa-axis">');
    expect(axis).toContain('references/formato-respuesta.md');
    expect(axis).toContain('LISTA COTIZADORQ');
    expect(axis).not.toMatch(/^---/);
    expect(construirSistema('QNAP')).toContain(
      '<skill nombre="preventa-qnap">'
    );
  });

  test('solo habilita herramientas de lectura de MyQuote y fichas del fabricante', () => {
    const p = construirParametros({
      config,
      marca: 'QNAP',
      mensajes: [{ role: 'user', content: 'x' }]
    });
    const toolset = p.tools.find((t) => t.type === 'mcp_toolset');
    expect(toolset.default_config).toEqual({ enabled: false });
    expect(Object.keys(toolset.configs)).toEqual([
      'buscar_productos',
      'consultar_producto',
      'simular_cotizacion'
    ]);
    expect(p.mcp_servers[0]).toMatchObject({
      url: 'https://mcp.example/mcp',
      authorization_token: 'secreto'
    });
    expect(
      p.tools
        .filter((t) => t.allowed_domains)
        .every((t) => t.allowed_domains[0] === 'qnap.com')
    ).toBe(true);
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.betas).toContain('mcp-client-2025-11-20');
  });

  test('corre la consulta, sigue un turno pausado y no la muestra a otro usuario', async () => {
    const pedidos = [];
    const respuestas = [
      streamFalso(
        {
          content: [{ type: 'mcp_tool_use', name: 'consultar_producto' }],
          stop_reason: 'pause_turn',
          usage: { input_tokens: 10, output_tokens: 2 }
        },
        [
          {
            type: 'content_block_start',
            content_block: {
              type: 'mcp_tool_use',
              name: 'consultar_producto',
              input: { sku: 'P1475-LE' }
            }
          }
        ]
      ),
      streamFalso(
        {
          content: [{ type: 'text', text: 'Andrea.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 3 }
        },
        [
          {
            type: 'content_block_start',
            content_block: { type: 'text', text: '' }
          },
          {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Andrea.' }
          }
        ]
      )
    ];
    const gestor = crearGestorConsultas({
      config,
      logger: { error: jest.fn() },
      crearCliente: () => ({
        beta: {
          messages: { stream: (p) => (pedidos.push(p), respuestas.shift()) }
        }
      })
    });
    const entrada = {
      marca: 'AXIS',
      mensajes: [{ role: 'user', content: 'Cotizar P1475-LE' }]
    };
    const { id } = gestor.iniciar({ usuarioId: 7, entrada });
    const c = await esperar(gestor, { usuarioId: 7, id });

    expect(c.estado).toBe('lista');
    expect(c.texto).toBe('Andrea.');
    expect(c.pasos).toEqual(['Consultando precio y stock: P1475-LE']);
    expect(c.contenido.map((b) => b.type)).toEqual(['mcp_tool_use', 'text']);
    expect(c.uso).toEqual({ entrada: 15, salida: 5, cache: 0 });
    expect(pedidos[1].messages).toHaveLength(2);
    expect(pedidos[1].messages[1].role).toBe('assistant');
    expect(gestor.obtener({ usuarioId: 8, id })).toBeNull();
  });

  test('un error de la API queda como mensaje claro', async () => {
    const gestor = crearGestorConsultas({
      config,
      logger: { error: jest.fn() },
      crearCliente: () => ({
        beta: {
          messages: {
            stream: () => ({
              on: () => {},
              finalMessage: () =>
                Promise.reject(Object.assign(new Error('x'), { status: 401 }))
            })
          }
        }
      })
    });
    const { id } = gestor.iniciar({
      usuarioId: 1,
      entrada: { marca: 'AXIS', mensajes: [{ role: 'user', content: 'x' }] }
    });
    const c = await esperar(gestor, { usuarioId: 1, id });
    expect(c.estado).toBe('error');
    expect(c.error).toMatch(/API key/);
  });
});
