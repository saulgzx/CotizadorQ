const {
  validarEntrada,
  construirParametros,
  construirSistema,
  crearGestorConsultas,
  faltantes,
  leerConfig,
  modo,
  usuarioPermitido,
  construirPromptAgente
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
  test('limpia comillas alrededor de la API key', () => {
    expect(leerConfig({ ANTHROPIC_API_KEY: ' "sk-ant-api03-x" ' }).apiKey).toBe(
      'sk-ant-api03-x'
    );
  });

  test('exige configuracion solo en modo API', () => {
    expect(faltantes(leerConfig({}))).toHaveLength(3);
    expect(faltantes(config)).toEqual([]);
    const agente = leerConfig({ IA_AGENTE_TOKEN: 'secreto' });
    expect(modo(agente)).toBe('agente');
    expect(faltantes(agente)).toEqual([]);
  });

  test('IA_USUARIOS limita quien usa el asistente', () => {
    const c = leerConfig({ IA_USUARIOS: 'Alexis, otro' });
    expect(usuarioPermitido(c, 'alexis')).toBe(true);
    expect(usuarioPermitido(c, 'jleon')).toBe(false);
    expect(usuarioPermitido(leerConfig({}), 'cualquiera')).toBe(true);
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
      'simular_cotizacion',
      'calcular_precios'
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
                Promise.reject(
                  Object.assign(new Error('x'), {
                    status: 401,
                    error: {
                      type: 'error',
                      error: {
                        type: 'authentication_error',
                        message: 'invalid x-api-key'
                      }
                    }
                  })
                )
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
    expect(c.error).toContain('authentication_error: invalid x-api-key');
  });

  describe('modo agente', () => {
    const configAgente = leerConfig({ IA_AGENTE_TOKEN: 'secreto' });
    const entrada = {
      marca: 'AXIS',
      mensajes: [{ role: 'user', content: 'Cotizar P1475-LE' }]
    };

    test('el prompt lleva la skill, el formato del canal y la conversacion previa', () => {
      const web = construirPromptAgente(entrada);
      expect(web).toContain('preventa-axis');
      expect(web).toContain('LISTA COTIZADORQ');
      expect(web).toContain('calcular_precios');
      expect(web).toContain('Gold');
      expect(web.endsWith('Cotizar P1475-LE')).toBe(true);
      const wa = construirPromptAgente({
        marca: null,
        canal: 'whatsapp',
        mensajes: [
          { role: 'user', content: 'nas 30tb' },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Propuesta TS-464' }]
          },
          { role: 'user', content: 'y sin discos?' }
        ]
      });
      expect(wa).toContain('preventa-axis para Axis');
      expect(wa).toContain('WhatsApp');
      expect(wa).toContain('<asistente>\nPropuesta TS-464');
      expect(wa.endsWith('y sin discos?')).toBe(true);
    });

    test('el agente toma la consulta, informa avance y la termina', async () => {
      let t = 1000;
      const terminadas = [];
      const gestor = crearGestorConsultas({
        config: configAgente,
        logger: { error: jest.fn() },
        ahora: () => t
      });
      expect(gestor.estadoAgente().conectado).toBe(false);
      const { id } = gestor.iniciar({
        usuarioId: 1,
        entrada,
        alTerminar: (v) => terminadas.push(v.estado)
      });
      expect(gestor.obtener({ usuarioId: 1, id }).pasos).toEqual([
        'En cola: esperando al servidor IA de casa'
      ]);

      const trabajo = await gestor.tomarTrabajo({ esperaMs: 10 });
      expect(trabajo).toMatchObject({ id, canal: 'web', marca: 'AXIS' });
      expect(trabajo.prompt).toContain('Cotizar P1475-LE');
      expect(gestor.estadoAgente().conectado).toBe(true);
      expect(await gestor.tomarTrabajo({ esperaMs: 10 })).toBeNull();

      expect(
        gestor.avanceAgente(id, {
          texto: 'Andrea.',
          paso: 'Consultando precio y stock: P1475-LE'
        })
      ).toBe(true);
      expect(gestor.obtener({ usuarioId: 1, id })).toMatchObject({
        texto: 'Andrea.',
        estado: 'en_curso'
      });
      expect(gestor.terminarAgente(id, { texto: 'Andrea. Final' })).toBe(true);
      const fin = gestor.obtener({ usuarioId: 1, id });
      expect(fin.estado).toBe('lista');
      expect(fin.contenido).toEqual([{ type: 'text', text: 'Andrea. Final' }]);
      await new Promise((r) => setImmediate(r));
      expect(terminadas).toEqual(['lista']);
      expect(gestor.avanceAgente(id, { texto: 'x' })).toBe(false);
    });

    test('un agente esperando recibe la consulta apenas llega', async () => {
      const gestor = crearGestorConsultas({
        config: configAgente,
        logger: { error: jest.fn() }
      });
      const espera = gestor.tomarTrabajo({ esperaMs: 5000 });
      const { id } = gestor.iniciar({ usuarioId: 1, entrada });
      expect((await espera).id).toBe(id);
    });

    test('vuelve a la cola si el agente deja de reportar y falla si nadie la toma', async () => {
      let t = 0;
      const gestor = crearGestorConsultas({
        config: configAgente,
        logger: { error: jest.fn() },
        ahora: () => t
      });
      const a = gestor.iniciar({ usuarioId: 1, entrada });
      await gestor.tomarTrabajo({ esperaMs: 10 });
      t = 4 * 60 * 1000; // sin latido por 4 min
      const otraVez = await gestor.tomarTrabajo({ esperaMs: 10 });
      expect(otraVez.id).toBe(a.id);

      const b = gestor.iniciar({ usuarioId: 2, entrada });
      t += 6 * 60 * 1000; // nadie la toma en 6 min
      const vencida = gestor.obtener({ usuarioId: 2, id: b.id });
      expect(vencida.estado).toBe('error');
      expect(vencida.error).toMatch(/miniPC/);
    });

    test('cancelar avisa al agente con un rechazo', async () => {
      const gestor = crearGestorConsultas({
        config: configAgente,
        logger: { error: jest.fn() }
      });
      const { id } = gestor.iniciar({ usuarioId: 1, entrada });
      await gestor.tomarTrabajo({ esperaMs: 10 });
      expect(gestor.cancelar({ usuarioId: 1, id })).toBe(true);
      expect(gestor.avanceAgente(id, { texto: 'x' })).toBe(false);
      expect(gestor.terminarAgente(id, { texto: 'x' })).toBe(false);
    });
  });
});
