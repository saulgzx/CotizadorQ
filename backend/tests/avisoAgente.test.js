const {
  leerConfigAviso,
  crearAvisoDesconexion,
  vigilarAgente
} = require('../src/services/avisoAgente');

const MIN = 60 * 1000;

const montar = (extra = {}) => {
  const reloj = { t: 10 * 60 * MIN, vistoEn: 10 * 60 * MIN };
  const enviados = [];
  const aviso = crearAvisoDesconexion({
    estado: () => ({ vistoEn: reloj.vistoEn }),
    enviar: extra.enviar || (async (texto) => (enviados.push(texto), true)),
    ahora: () => reloj.t,
    umbralMs: 15 * MIN,
    logger: { error: jest.fn() }
  });
  return { reloj, enviados, aviso };
};

describe('aviso de desconexion del agente', () => {
  test('no avisa mientras el agente este dentro del umbral', async () => {
    const { reloj, enviados, aviso } = montar();
    reloj.t += 14 * MIN;
    expect(await aviso.revisar()).toBeNull();
    expect(enviados).toEqual([]);
  });

  test('avisa UNA vez al pasar el umbral y no repite (sin spam)', async () => {
    const { reloj, enviados, aviso } = montar();
    reloj.t += 16 * MIN;
    expect(await aviso.revisar()).toBe('caido');
    reloj.t += 60 * MIN;
    expect(await aviso.revisar()).toBeNull();
    expect(await aviso.revisar()).toBeNull();
    expect(enviados).toEqual([
      'El agente del miniPC lleva 16 min sin conectarse.'
    ]);
  });

  test('avisa cuando vuelve y despues puede avisar otra caida', async () => {
    const { reloj, enviados, aviso } = montar();
    reloj.t += 20 * MIN;
    await aviso.revisar();
    reloj.vistoEn = reloj.t; // el agente vuelve a pedir trabajo
    reloj.t += 30 * 1000;
    expect(await aviso.revisar()).toBe('recuperado');
    expect(await aviso.revisar()).toBeNull();
    expect(enviados[1]).toMatch(/volvió a conectarse \(estuvo 21 min/);
    reloj.t += 17 * MIN;
    expect(await aviso.revisar()).toBe('caido');
    expect(enviados).toHaveLength(3);
  });

  test('un agente que nunca se ha visto no genera aviso', async () => {
    const { reloj, enviados, aviso } = montar();
    reloj.vistoEn = null;
    reloj.t += 600 * MIN;
    expect(await aviso.revisar()).toBeNull();
    expect(enviados).toEqual([]);
  });

  test('si el envio falla, no marca la caida y reintenta', async () => {
    let intentos = 0;
    const { reloj, aviso } = montar({
      enviar: async () => {
        intentos += 1;
        if (intentos === 1) throw new Error('Meta caido');
        return true;
      }
    });
    reloj.t += 20 * MIN;
    expect(await aviso.revisar()).toBeNull();
    expect(await aviso.revisar()).toBe('caido');
    expect(await aviso.revisar()).toBeNull();
    expect(intentos).toBe(2);
  });
});

describe('configuracion y conexion', () => {
  test('AGENTE_AVISO_MIN: 15 por defecto, 0 lo apaga', () => {
    expect(leerConfigAviso({}).umbralMs).toBe(15 * MIN);
    expect(leerConfigAviso({ AGENTE_AVISO_MIN: '30' }).umbralMs).toBe(30 * MIN);
    expect(leerConfigAviso({ AGENTE_AVISO_MIN: '0' }).umbralMs).toBe(0);
  });

  test('vigilarAgente solo arma el temporizador con WhatsApp y modo agente', () => {
    const setIntervalImpl = jest.fn(() => ({ unref: jest.fn() }));
    const gestor = (modo) => ({ modo: () => modo, estadoAgente: () => ({}) });
    const wa = (ok) => ({ habilitado: () => ok, avisar: jest.fn() });
    const armar = (g, w, env = {}) =>
      vigilarAgente({ gestor: g, whatsapp: w, env, setIntervalImpl });
    expect(armar(gestor('agente'), wa(false))).toBeNull();
    expect(armar(gestor('api'), wa(true))).toBeNull();
    expect(
      armar(gestor('agente'), wa(true), { AGENTE_AVISO_MIN: '0' })
    ).toBeNull();
    expect(setIntervalImpl).not.toHaveBeenCalled();
    expect(armar(gestor('agente'), wa(true))).not.toBeNull();
    expect(setIntervalImpl).toHaveBeenCalledTimes(1);
  });
});
