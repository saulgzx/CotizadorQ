const crypto = require('crypto');
const {
  leerConfigWhatsApp,
  partirMensaje,
  crearWhatsApp
} = require('../src/services/whatsapp');
const {
  crearGestorConsultas,
  leerConfig
} = require('../src/services/asistenteIA');

const config = leerConfigWhatsApp({
  WHATSAPP_TOKEN: 'tok',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  WHATSAPP_VERIFY_TOKEN: 'verifica',
  WHATSAPP_APP_SECRET: 'secreto',
  WHATSAPP_NUMEROS: '+56 9 1234 5678'
});

const mensaje = (
  texto,
  { id = `m${Math.random()}`, from = '56912345678' } = {}
) => ({
  entry: [
    {
      changes: [
        {
          value: {
            messages: [{ id, from, type: 'text', text: { body: texto } }]
          }
        }
      ]
    }
  ]
});

const preparar = () => {
  const enviados = [];
  const fetchImpl = jest.fn(async (url, opts) => {
    enviados.push(JSON.parse(opts.body).text.body);
    return { ok: true };
  });
  const gestor = crearGestorConsultas({
    config: leerConfig({ IA_AGENTE_TOKEN: 's' }),
    logger: { error: jest.fn() }
  });
  const wa = crearWhatsApp({
    config,
    gestor,
    logger: { error: jest.fn(), warn: jest.fn() },
    fetchImpl
  });
  return { wa, gestor, enviados, fetchImpl };
};

describe('WhatsApp', () => {
  test('verificacion del webhook y firma de Meta', () => {
    const { wa } = preparar();
    expect(
      wa.verificar({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verifica',
        'hub.challenge': '42'
      })
    ).toBe('42');
    expect(
      wa.verificar({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'otro',
        'hub.challenge': '42'
      })
    ).toBeNull();
    // Distinto largo, prefijo, vacio o no-texto (?hub.verify_token=a&hub.verify_token=b): null.
    for (const token of ['verificaX', 'verif', '', ['verifica'], undefined]) {
      expect(wa.verificar({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '42' })).toBeNull();
    }
    const cuerpo = Buffer.from('{"a":1}');
    const firma = `sha256=${crypto.createHmac('sha256', 'secreto').update(cuerpo).digest('hex')}`;
    expect(wa.firmaValida(cuerpo, firma)).toBe(true);
    expect(wa.firmaValida(cuerpo, 'sha256=00')).toBe(false);
    expect(wa.firmaValida(undefined, firma)).toBe(false);
  });

  test('parte mensajes largos en saltos de linea', () => {
    const partes = partirMensaje(`${'a'.repeat(3000)}\n${'b'.repeat(3000)}`);
    expect(partes).toEqual(['a'.repeat(3000), 'b'.repeat(3000)]);
  });

  test('encola el requerimiento, responde por WhatsApp y mantiene la conversacion', async () => {
    const { wa, gestor, enviados } = preparar();
    await wa.procesar(mensaje('qnap nas de 30tb sobremesa', { id: 'a1' }));
    await wa.procesar(mensaje('qnap nas de 30tb sobremesa', { id: 'a1' })); // reintento de Meta: se ignora
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatch(/servidor IA de casa aparece desconectado/);

    const trabajo = await gestor.tomarTrabajo({ esperaMs: 10 });
    expect(trabajo).toMatchObject({ canal: 'whatsapp', marca: 'QNAP' });
    await wa.procesar(mensaje('y con discos?', { id: 'a2' }));
    expect(enviados[1]).toMatch(/Sigo trabajando/);

    gestor.terminarAgente(trabajo.id, { texto: 'Propuesta: TS-464' });
    await new Promise((r) => setImmediate(r));
    expect(enviados[2]).toBe('Propuesta: TS-464');

    await wa.procesar(mensaje('y con discos?', { id: 'a3' }));
    const seguimiento = await gestor.tomarTrabajo({ esperaMs: 10 });
    expect(seguimiento.marca).toBe('QNAP');
    expect(seguimiento.prompt).toContain('Propuesta: TS-464');
    expect(seguimiento.prompt.endsWith('y con discos?')).toBe(true);
  });

  test('ignora numeros no autorizados y responde comandos', async () => {
    const { wa, enviados, fetchImpl } = preparar();
    await wa.procesar(mensaje('hola', { from: '56900000000' }));
    expect(fetchImpl).not.toHaveBeenCalled();
    await wa.procesar(mensaje('ayuda'));
    expect(enviados[0]).toMatch(/nueva/);
    await wa.procesar(mensaje('nueva'));
    expect(enviados[1]).toMatch(/conversación nueva/);
  });

  test('avisar manda el texto a los numeros autorizados', async () => {
    const { wa, enviados, fetchImpl } = preparar();
    expect(
      await wa.avisar('El agente del miniPC lleva 15 min sin conectarse.')
    ).toBe(true);
    expect(enviados).toEqual([
      'El agente del miniPC lleva 15 min sin conectarse.'
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(config.numeros.length);
  });
});
