const {
  leerConfigChequeo,
  detalleSeguro,
  crearChequeo,
  crearAvisoIntegraciones,
  crearMonitor
} = require('../src/services/integraciones');

const MIN = 60 * 1000;
const logger = () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() });

describe('leerConfigChequeo', () => {
  test('15 minutos por defecto, 0 lo apaga', () => {
    expect(leerConfigChequeo({}).intervaloMs).toBe(15 * MIN);
    expect(leerConfigChequeo({ INTEGRACIONES_CHECK_MIN: '5' }).intervaloMs).toBe(5 * MIN);
    expect(leerConfigChequeo({ INTEGRACIONES_CHECK_MIN: '0' }).intervaloMs).toBe(0);
    expect(leerConfigChequeo({ INTEGRACIONES_CHECK_MIN: 'abc' }).intervaloMs).toBe(0);
  });
});

describe('crearChequeo', () => {
  const chequeo = (comprobaciones, timeoutMs = 50) => crearChequeo({ comprobaciones, timeoutMs });

  test('ok: devuelve nombre, ok, detalle, duracion y fecha', async () => {
    const [r] = await chequeo([{ nombre: 'a', ejecutar: async () => 'responde' }]).ejecutar();
    expect(r).toMatchObject({ nombre: 'a', ok: true, estado: 'ok', detalle: 'responde' });
    expect(typeof r.duracion_ms).toBe('number');
    expect(new Date(r.revisado_en).toISOString()).toBe(r.revisado_en);
  });

  test('fallo: ok=false y detalle sin secretos', async () => {
    const sucio = new Error(
      'bot@proyecto.iam.gserviceaccount.com hoja 1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 -----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----'
    );
    const [r] = await chequeo([{ nombre: 'a', ejecutar: async () => { throw sucio; } }]).ejecutar();
    expect(r.ok).toBe(false);
    expect(r.estado).toBe('fallo');
    expect(r.detalle).not.toMatch(/proyecto\.iam|1AbCdEf|MIIabc|BEGIN/);
  });

  test('error de autenticacion de Google se resume sin texto original', () => {
    expect(detalleSeguro(new Error('invalid_grant: Invalid JWT Signature bot@x.com'))).toBe(
      'autenticacion con Google fallida (credenciales ausentes o invalidas)'
    );
    expect(detalleSeguro(Object.assign(new Error('x'), { code: 403 }))).toMatch(/403/);
  });

  test('timeout: una comprobacion colgada falla sin bloquear a las demas', async () => {
    const res = await chequeo([
      { nombre: 'lenta', ejecutar: () => new Promise(() => {}) },
      { nombre: 'rapida', ejecutar: async () => 'ok' }
    ]).ejecutar();
    expect(res[0]).toMatchObject({ nombre: 'lenta', ok: false });
    expect(res[0].detalle).toMatch(/timeout/);
    expect(res[1].ok).toBe(true);
  });

  test('no configurado no es un fallo', async () => {
    const [r] = await chequeo([
      { nombre: 'sheets', ejecutar: async () => ({ noConfigurado: true, detalle: 'GOOGLE_SHEETS_ID no configurado' }) }
    ]).ejecutar();
    expect(r).toMatchObject({ ok: true, estado: 'no_configurado' });
  });

  test('una comprobacion dependiente no se ejecuta si la otra fallo o no esta configurada', async () => {
    const dep = jest.fn(async () => 'x');
    const falla = await chequeo([
      { nombre: 'sheets', ejecutar: async () => { throw new Error('boom'); } },
      { nombre: 'costo', depende: 'sheets', ejecutar: dep }
    ]).ejecutar();
    expect(falla[1]).toMatchObject({ ok: false, estado: 'fallo' });
    const sinConfig = await chequeo([
      { nombre: 'sheets', ejecutar: async () => ({ noConfigurado: true }) },
      { nombre: 'costo', depende: 'sheets', ejecutar: dep }
    ]).ejecutar();
    expect(sinConfig[1]).toMatchObject({ ok: true, estado: 'no_configurado' });
    expect(dep).not.toHaveBeenCalled();
  });
});

describe('crearAvisoIntegraciones', () => {
  const montar = () => {
    const reloj = { t: 1000 * MIN };
    const enviados = [];
    const aviso = crearAvisoIntegraciones({
      enviar: async (t) => (enviados.push(t), true),
      ahora: () => reloj.t,
      logger: logger()
    });
    return { reloj, enviados, aviso };
  };
  const r = (nombre, ok) => ({ nombre, ok, detalle: ok ? 'ok' : 'roto' });

  test('ok -> fallo -> ok manda un solo aviso por transicion', async () => {
    const { reloj, enviados, aviso } = montar();
    await aviso.revisar([r('google_sheets', true)]);
    expect(enviados).toHaveLength(0);

    await aviso.revisar([r('google_sheets', false)]);
    await aviso.revisar([r('google_sheets', false)]);
    await aviso.revisar([r('google_sheets', false)]);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatch(/falla.*google_sheets/);

    reloj.t += 30 * MIN;
    await aviso.revisar([r('google_sheets', true)]);
    await aviso.revisar([r('google_sheets', true)]);
    expect(enviados).toHaveLength(2);
    expect(enviados[1]).toMatch(/se recuper.*30 min/);
  });

  test('un fallo desde el primer chequeo tambien avisa; cada integracion por separado', async () => {
    const { enviados, aviso } = montar();
    await aviso.revisar([r('postgresql', true), r('google_sheets', false), r('costo_chile', false)]);
    expect(enviados).toHaveLength(2);
  });

  test('si el envio falla se reintenta en el siguiente chequeo', async () => {
    const enviar = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const aviso = crearAvisoIntegraciones({ enviar, logger: logger() });
    await aviso.revisar([r('a', false)]);
    await aviso.revisar([r('a', false)]);
    await aviso.revisar([r('a', false)]);
    expect(enviar).toHaveBeenCalledTimes(2);
  });
});

describe('crearMonitor', () => {
  test('guarda el ultimo resultado, registra un error por integracion caida y avisa', async () => {
    const log = logger();
    let sheetsOk = false;
    const enviados = [];
    const monitor = crearMonitor({
      chequeo: crearChequeo({
        comprobaciones: [
          { nombre: 'postgresql', ejecutar: async () => 'ok' },
          { nombre: 'google_sheets', ejecutar: async () => { if (!sheetsOk) throw new Error('x'); return 'ok'; } }
        ]
      }),
      aviso: crearAvisoIntegraciones({ enviar: async (t) => (enviados.push(t), true), logger: log }),
      logger: log
    });
    expect(monitor.ultimo()).toBeNull();

    const r1 = await monitor.revisar();
    expect(r1.ok).toBe(false);
    expect(monitor.ultimo()).toBe(r1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toMatchObject({ integracion: 'google_sheets' });
    expect(enviados).toHaveLength(1);

    sheetsOk = true;
    expect((await monitor.revisar()).ok).toBe(true);
    expect(enviados).toHaveLength(2);
  });

  test('iniciar no lanza aunque el chequeo reviente, y el timer es unref', async () => {
    const log = logger();
    const timer = { unref: jest.fn() };
    const setIntervalImpl = jest.fn(() => timer);
    const monitor = crearMonitor({
      chequeo: { ejecutar: async () => { throw new Error('inesperado'); } },
      logger: log
    });
    expect(monitor.iniciar({ intervaloMs: 15 * MIN, setIntervalImpl })).toBe(timer);
    await monitor.revisar();
    expect(timer.unref).toHaveBeenCalled();
    expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), 15 * MIN);
    expect(log.error).toHaveBeenCalled();
    expect(monitor.iniciar({ intervaloMs: 0, setIntervalImpl })).toBeNull();
  });
});
