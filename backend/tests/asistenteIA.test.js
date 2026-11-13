const {
  validarEntrada,
  construirParametros,
  construirSistema,
  crearGestorConsultas,
  faltantes,
  leerConfig,
  modo,
  usuarioPermitido,
  construirPromptAgente,
  archivoPantallazo,
  LIMITE_CUERPO_CONSULTA
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
    expect(axis).toContain('cotizar_rapido con TODOS los ítems en una sola llamada');
    expect(axis).toContain('Si cotizar_rapido no está disponible');
    expect(axis).toContain('nunca para una consulta de precio, stock o plazo');
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
      'cotizar_rapido',
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
      expect(web).toContain('cotizar_rapido con TODOS los ítems en una sola llamada');
      expect(web).toContain('Si cotizar_rapido no está disponible');
      expect(web).toContain('en paralelo');
      expect(web).toContain('solo para homologar un modelo, completar accesorios o responder una duda técnica; nunca para una consulta de precio, stock o plazo');
      expect(web).toContain('Gold');
      expect(web.endsWith('Cotizar P1475-LE')).toBe(true);
      // Marca conocida: la skill y sus referencias ya van en el prompt.
      expect(web).toContain('ya está cargada, no uses Skill ni Read');
      expect(web).toContain('<skill nombre="preventa-axis">');
      expect(web).toContain('<referencia archivo="references/formato-respuesta.md">');
      expect(web).not.toContain('<skill nombre="preventa-qnap">');
      const qnap = construirPromptAgente({ ...entrada, marca: 'QNAP' });
      expect(qnap).toContain('<skill nombre="preventa-qnap">');
      expect(qnap).not.toContain('<skill nombre="preventa-axis">');
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
      // Sin marca: no se precarga ninguna skill.
      expect(wa).not.toContain('<skill nombre=');
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

    test('guarda la version que informa el agente; uno viejo no la manda', async () => {
      const gestor = crearGestorConsultas({
        config: configAgente,
        logger: { error: jest.fn() }
      });
      expect(gestor.estadoAgente().version).toBeNull();
      await gestor.tomarTrabajo({ esperaMs: 5 });
      expect(gestor.estadoAgente().version).toBeNull();
      await gestor.tomarTrabajo({ esperaMs: 5, version: 'abc1234' });
      expect(gestor.estadoAgente().version).toBe('abc1234');
      await gestor.tomarTrabajo({ esperaMs: 5 });
      expect(gestor.estadoAgente().version).toBe('abc1234');
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

    test('guarda las metricas del agente, las saneadas, y calcula promedios por herramienta', async () => {
      let t = 1000;
      const gestor = crearGestorConsultas({
        config: configAgente,
        logger: { error: jest.fn() },
        ahora: () => t
      });
      const correr = async (metricas, texto = 'ok') => {
        const { id } = gestor.iniciar({ usuarioId: 1, entrada });
        t += 500;
        await gestor.tomarTrabajo({ esperaMs: 10 });
        t += 2000;
        gestor.terminarAgente(id, { texto, metricas });
        return id;
      };
      await correr({
        total_ms: 1800,
        arranque_ms: 400,
        turnos: 4,
        herramientas: [
          { nombre: 'consultar_producto', ms: 300 },
          { nombre: 'consultar_producto', ms: 500, error: true },
          { nombre: 'mal nombre con espacios', ms: 5 },
          { nombre: 'Read', ms: 'no es numero' },
          { nombre: 'Skill', ms: 200, contenido: 'datos de cliente' }
        ],
        contenido: 'datos de cliente'
      });
      // Un agente viejo no manda metricas: no rompe y queda registrada sin tiempos del agente.
      await correr(undefined);
      const r = gestor.metricas({ limite: 10 });
      expect(r.consultas).toBe(2);
      expect(r.ultimas[1].agente).toEqual({
        total_ms: 1800,
        arranque_ms: 400,
        api_ms: null,
        turnos: 4,
        herramientas: [
          { nombre: 'consultar_producto', ms: 300 },
          { nombre: 'consultar_producto', ms: 500, error: true },
          { nombre: 'Skill', ms: 200 }
        ]
      });
      expect(r.ultimas[0].agente).toBeNull();
      expect(r.ultimas[0].cola_ms).toBe(500);
      expect(r.ultimas[0].total_backend_ms).toBe(2500);
      expect(r.herramientas.consultar_producto).toEqual({
        llamadas: 2,
        ms_total: 800,
        errores: 1,
        ms_promedio: 400
      });
      expect(r.total_ms_promedio).toBe(1800);
      expect(r.turnos_promedio).toBe(4);
      expect(JSON.stringify(r)).not.toContain('datos de cliente');
      expect(JSON.stringify(r)).not.toContain('Cotizar P1475-LE');
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
  describe('pantallazo', () => {
    const configAgente = leerConfig({ IA_AGENTE_TOKEN: 'secreto' });
    const PNG_B64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const lineas = [
      { sku: 'AX123456', mpn: '02328-001', desc: 'AXIS P1475-LE' },
      { sku: 'AX654321', mpn: '01972-004', desc: 'AXIS Q6135-LE PTZ' }
    ];
    const pantallazo = {
      datos: PNG_B64,
      mime: 'image/png',
      campo: 'intcomex',
      lineas
    };
    const conversacion = {
      marca: 'AXIS',
      mensajes: [{ role: 'user', content: 'Cotizar P1475-LE' }]
    };

    test('validarEntrada acepta un pantallazo valido, con o sin conversacion', () => {
      const ok = validarEntrada({ ...conversacion, pantallazo });
      expect(ok).toEqual({
        marca: 'AXIS',
        mensajes: conversacion.mensajes,
        pantallazo
      });
      // Solo la imagen: marca y mensajes son opcionales.
      expect(validarEntrada({ pantallazo })).toEqual({
        marca: null,
        mensajes: [],
        pantallazo
      });
      // Los tres formatos y los dos campos.
      ['image/png', 'image/jpeg', 'image/webp'].forEach((mime) =>
        expect(
          validarEntrada({ pantallazo: { ...pantallazo, mime } }).pantallazo.mime
        ).toBe(mime)
      );
      expect(
        validarEntrada({ pantallazo: { ...pantallazo, campo: 'axis' } })
          .pantallazo.campo
      ).toBe('axis');
    });

    test('las lineas se recortan, quedan en una linea y se descartan campos de mas', () => {
      const r = validarEntrada({
        pantallazo: {
          ...pantallazo,
          lineas: [
            { sku: '  AX1  ', mpn: 123, desc: `a\nb ${'x'.repeat(500)}`, precio: 9 },
            {},
            null
          ]
        }
      }).pantallazo.lineas;
      expect(r[0].sku).toBe('AX1');
      expect(r[0].mpn).toBe('123');
      expect(r[0].desc).toHaveLength(200);
      expect(r[0].desc.startsWith('a b x')).toBe(true);
      expect(r[0]).not.toHaveProperty('precio');
      expect(r[1]).toEqual({ sku: '', mpn: '', desc: '' });
      expect(r[2]).toEqual({ sku: '', mpn: '', desc: '' });
      // Sin lineas tambien vale.
      const { lineas: _omitidas, ...sinLineas } = pantallazo;
      expect(validarEntrada({ pantallazo: sinLineas }).pantallazo.lineas).toEqual([]);
    });

    test('rechaza un mime no soportado', () => {
      ['image/gif', 'application/msword', 'text/plain', '', undefined].forEach((mime) =>
        expect(() =>
          validarEntrada({ pantallazo: { ...pantallazo, mime } })
        ).toThrow('Solo se aceptan PDF o imágenes PNG, JPG o WEBP')
      );
    });

    test('rechaza base64 invalido, incluido el prefijo data:', () => {
      [
        'esto no es base64 !!',
        `data:image/png;base64,${PNG_B64}`,
        'abc',
        '',
        12345,
        null
      ].forEach((datos) => {
        let error;
        try {
          validarEntrada({ pantallazo: { ...pantallazo, datos } });
        } catch (e) {
          error = e;
        }
        expect(error?.status).toBe(400);
        expect(error.message).toMatch(/base64|vacia/);
      });
    });

    test('rechaza una imagen de mas de 6 MB y dice cuanto pesa', () => {
      const de = (bytes) => Buffer.alloc(bytes, 1).toString('base64');
      const justo = 6 * 1024 * 1024;
      expect(
        validarEntrada({ pantallazo: { ...pantallazo, datos: de(justo) } })
          .pantallazo.datos
      ).toHaveLength(Math.ceil(justo / 3) * 4);
      expect(() =>
        validarEntrada({ pantallazo: { ...pantallazo, datos: de(justo + 1) } })
      ).toThrow(/pesa 6\.0 MB y el máximo para imágenes es 6\.0 MB/);
      expect(() =>
        validarEntrada({
          pantallazo: { ...pantallazo, datos: de(7.5 * 1024 * 1024) }
        })
      ).toThrow(/pesa 7\.5 MB y el máximo para imágenes es 6\.0 MB/);
    });

    // --- PDF de la OC completa ---
    const MB = 1024 * 1024;
    const deBytes = (bytes) => Buffer.alloc(bytes, 1).toString('base64');
    const pdf = { ...pantallazo, mime: 'application/pdf' };

    test('acepta application/pdf', () => {
      expect(validarEntrada({ pantallazo: pdf }).pantallazo).toEqual(pdf);
    });

    test('un PDF de 10 MB pasa y uno de 13 MB se rechaza con el maximo de 12 MB', () => {
      expect(
        validarEntrada({ pantallazo: { ...pdf, datos: deBytes(10 * MB) } })
          .pantallazo.mime
      ).toBe('application/pdf');
      // Justo en el limite tambien pasa.
      expect(() =>
        validarEntrada({ pantallazo: { ...pdf, datos: deBytes(12 * MB) } })
      ).not.toThrow();
      let error;
      try {
        validarEntrada({ pantallazo: { ...pdf, datos: deBytes(13 * MB) } });
      } catch (e) {
        error = e;
      }
      expect(error?.status).toBe(400);
      expect(error.message).toBe(
        'El PDF pesa 13.0 MB y el máximo para PDF es 12.0 MB'
      );
    });

    test('una imagen de 7 MB se rechaza con el maximo de 6 MB, no con el del PDF', () => {
      ['image/png', 'image/jpeg', 'image/webp'].forEach((mime) =>
        expect(() =>
          validarEntrada({
            pantallazo: { ...pantallazo, mime, datos: deBytes(7 * MB) }
          })
        ).toThrow('La imagen pesa 7.0 MB y el máximo para imágenes es 6.0 MB')
      );
    });

    test('el cuerpo de la consulta admite el PDF mas grande en base64', () => {
      const cuerpo = JSON.stringify({
        pantallazo: { ...pdf, datos: deBytes(12 * MB), lineas: Array(300).fill(lineas[0]) }
      });
      expect(Buffer.byteLength(cuerpo)).toBeLessThan(LIMITE_CUERPO_CONSULTA);
    });

    test('el archivo sigue al mime: pdf para el PDF, png para las imagenes', () => {
      expect(archivoPantallazo('application/pdf')).toBe('pantallazo.pdf');
      ['image/png', 'image/jpeg', 'image/webp'].forEach((mime) =>
        expect(archivoPantallazo(mime)).toBe('pantallazo.png')
      );
    });

    test('el prompt de un PDF nombra ./pantallazo.pdf, pide leer todas las paginas y mantiene las reglas duras', () => {
      const p = construirPromptAgente({ marca: null, mensajes: [], pantallazo: pdf });
      expect(p).toContain('./pantallazo.pdf');
      expect(p).not.toContain('pantallazo.png');
      expect(p).not.toMatch(/imagen/i);
      expect(p).toMatch(/varias páginas: léelas TODAS/);
      expect(p).toContain('parámetro pages');
      expect(p).toContain('líneas de producto que no están en la lista de la orden');
      // Reglas duras, las mismas que para la imagen.
      expect(p).toMatch(/déjalo vacío.*en vez de adivinar/);
      expect(p).toContain('No inventes SKU ni MPN');
      expect(p).toContain('No los copies de la lista de la orden');
      expect(p).toContain('No calcules ni conviertas montos');
      expect(p).toContain('devuelve un array vacío');
      expect(p).toContain('sin reformatear');
      expect(p).toContain('no uses las herramientas del conector MyQuote');
      expect(p).toContain('no busques en la web');
      expect(p).toContain('[ { "sku": "", "mpn": "", "descripcion": "", "monto": "" } ]');
      lineas.forEach((l) => expect(p).toContain(l.sku));
    });

    test('el prompt de una imagen sigue nombrando ./pantallazo.png y no habla de paginas', () => {
      ['image/png', 'image/jpeg', 'image/webp'].forEach((mime) => {
        const p = construirPromptAgente({
          marca: null,
          mensajes: [],
          pantallazo: { ...pantallazo, mime }
        });
        expect(p).toContain('./pantallazo.png');
        expect(p).not.toContain('pantallazo.pdf');
        expect(p).not.toMatch(/p[áa]gina|PDF|pages/i);
      });
    });

    test('el trabajo de un PDF lleva su mime al agente y el prompt con el mismo nombre de archivo', async () => {
      const gestor = crearGestorConsultas({ config: configAgente });
      const c = gestor.iniciar({ usuarioId: 1, entrada: validarEntrada({ pantallazo: pdf }) });
      const trabajo = await gestor.tomarTrabajo({ esperaMs: 10 });
      expect(trabajo.imagen).toEqual({ datos: PNG_B64, mime: 'application/pdf' });
      expect(trabajo.prompt).toContain(`./${archivoPantallazo(trabajo.imagen.mime)}`);
      gestor.cancelar({ usuarioId: 1, id: c.id });
    });

    test('rechaza un campo distinto de axis o intcomex, y lineas mal formadas', () => {
      ['cliente', 'AXIS', '', undefined].forEach((campo) =>
        expect(() =>
          validarEntrada({ pantallazo: { ...pantallazo, campo } })
        ).toThrow(/axis o intcomex/)
      );
      expect(() =>
        validarEntrada({ pantallazo: { ...pantallazo, lineas: 'x' } })
      ).toThrow(/lista/);
      expect(() =>
        validarEntrada({
          pantallazo: { ...pantallazo, lineas: Array(301).fill({ sku: 'a' }) }
        })
      ).toThrow(/maximo 300/);
      expect(
        validarEntrada({
          pantallazo: { ...pantallazo, lineas: Array(300).fill({ sku: 'a' }) }
        }).pantallazo.lineas
      ).toHaveLength(300);
      expect(() => validarEntrada({ pantallazo: 'imagen' })).toThrow(
        /mal formado/
      );
    });

    test('sin pantallazo valida igual que antes', () => {
      expect(validarEntrada(conversacion)).toEqual({
        marca: 'AXIS',
        mensajes: conversacion.mensajes
      });
      expect(validarEntrada({ ...conversacion, pantallazo: null })).toEqual({
        marca: 'AXIS',
        mensajes: conversacion.mensajes
      });
      // La marca y la conversacion siguen siendo obligatorias.
      expect(() => validarEntrada({ mensajes: conversacion.mensajes })).toThrow(
        /Marca/
      );
      expect(() => validarEntrada({ marca: 'AXIS' })).toThrow(/vacia/);
      // Con pantallazo, una marca que si viene tiene que ser valida.
      expect(() => validarEntrada({ marca: 'SONY', pantallazo })).toThrow(
        /Marca/
      );
    });

    test('el prompt de pantallazo pide leer ./pantallazo.png y responder solo con json', () => {
      const p = construirPromptAgente({ marca: 'AXIS', mensajes: [], pantallazo });
      expect(p).toContain('./pantallazo.png');
      expect(p).toContain('```json');
      expect(p).toContain(
        '[ { "sku": "", "mpn": "", "descripcion": "", "monto": "" } ]'
      );
      // Las lineas de la orden.
      lineas.forEach((l) => {
        expect(p).toContain(l.sku);
        expect(p).toContain(l.mpn);
        expect(p).toContain(l.desc);
      });
      // Reglas duras.
      expect(p).toMatch(/déjalo vacío.*en vez de adivinar/);
      expect(p).toContain('No inventes SKU ni MPN');
      expect(p).toContain('No calcules ni conviertas montos');
      expect(p).toContain('devuelve un array vacío');
      expect(p).toContain('sin reformatear');
      expect(p).toContain('no uses las herramientas del conector MyQuote');
      expect(p).toContain('no busques en la web');
      // Es lectura, no cotizacion: ni skill ni formato de cotizacion.
      expect(p).not.toContain('<skill nombre=');
      expect(p).not.toContain('LISTA COTIZADORQ');
      expect(p).not.toContain('cotizar_rapido');
    });

    test('el prompt cambia segun el campo: OC del cliente o planilla de costos de Axis', () => {
      const oc = construirPromptAgente({ marca: null, mensajes: [], pantallazo });
      const costos = construirPromptAgente({
        marca: null,
        mensajes: [],
        pantallazo: { ...pantallazo, campo: 'axis' }
      });
      expect(oc).toContain('orden de compra (OC) que el cliente');
      expect(oc).toContain('precio de venta');
      expect(oc).not.toContain('planilla de costos');
      expect(costos).toContain('planilla de costos de Axis');
      expect(costos).toContain('costo unitario');
      expect(costos).not.toContain('precio de venta');
      expect(costos).not.toContain('orden de compra');
    });

    test('sin pantallazo el prompt es el de siempre y sigue cargando la skill', () => {
      const normal = construirPromptAgente(conversacion);
      expect(construirPromptAgente({ ...conversacion, pantallazo: null })).toBe(
        normal
      );
      expect(normal).toContain('<skill nombre="preventa-axis">');
      expect(normal).toContain('LISTA COTIZADORQ');
      expect(normal).not.toContain('pantallazo');
      expect(normal.endsWith('Cotizar P1475-LE')).toBe(true);
    });

    test('el trabajo lleva la imagen al agente y la suelta al terminar', async () => {
      const gestor = crearGestorConsultas({ config: configAgente });
      const c = gestor.iniciar({
        usuarioId: 1,
        entrada: validarEntrada({ pantallazo })
      });
      // La imagen no se le devuelve al navegador.
      expect(JSON.stringify(c)).not.toContain(PNG_B64);
      const trabajo = await gestor.tomarTrabajo({ esperaMs: 10 });
      expect(trabajo).toEqual({
        id: c.id,
        prompt: expect.stringContaining('./pantallazo.png'),
        canal: 'web',
        marca: null,
        imagen: { datos: PNG_B64, mime: 'image/png' }
      });
      // Si el agente la suelta, el siguiente intento la recibe otra vez con la imagen.
      gestor.liberarTrabajo(trabajo.id);
      const otraVez = await gestor.tomarTrabajo({ esperaMs: 10 });
      expect(otraVez.imagen).toEqual({ datos: PNG_B64, mime: 'image/png' });
      gestor.cancelar({ usuarioId: 1, id: c.id });

      // Una consulta normal viaja sin imagen.
      gestor.iniciar({ usuarioId: 1, entrada: validarEntrada(conversacion) });
      const normal = await gestor.tomarTrabajo({ esperaMs: 10 });
      expect(normal.imagen).toBeNull();
      expect(normal.prompt).toContain('<skill nombre="preventa-axis">');
    });

    test('en modo API un pantallazo se rechaza sin llamar a la API', () => {
      const crearCliente = jest.fn();
      const gestor = crearGestorConsultas({ config, crearCliente });
      let error;
      try {
        gestor.iniciar({ usuarioId: 1, entrada: validarEntrada({ pantallazo }) });
      } catch (e) {
        error = e;
      }
      expect(error?.status).toBe(409);
      expect(error.message).toMatch(/servidor IA de casa/);
      expect(crearCliente).not.toHaveBeenCalled();
    });
  });
});
