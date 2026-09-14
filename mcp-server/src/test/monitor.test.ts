import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { crearMonitor } from '../monitor.js';

test('T0.4 · avisa recien al segundo fallo seguido, una vez, y avisa la recuperacion', async () => {
  const resultados = [false, true, false, false, false, true];
  const avisos: string[] = [];
  const monitor = crearMonitor({
    chequear: async () => {
      if (!resultados.shift()) throw new Error('Login contra CotizadorQ fallo (HTTP 401).');
      return 'ok';
    },
    avisar: async (mensaje) => {
      avisos.push(mensaje);
    }
  });

  await monitor.ejecutar(); // falla 1
  assert.equal(avisos.length, 0, 'un fallo aislado no avisa');
  await monitor.ejecutar(); // ok: reinicia la cuenta
  await monitor.ejecutar(); // falla 1
  assert.equal(avisos.length, 0);
  await monitor.ejecutar(); // falla 2 -> avisa
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /HTTP 401/);
  await monitor.ejecutar(); // falla 3 -> no repite
  assert.equal(avisos.length, 1);
  await monitor.ejecutar(); // recupera
  assert.equal(avisos.length, 2);
  assert.match(avisos[1], /volvio/);
  assert.equal(monitor.estado().fallos_consecutivos, 0);
});

test('un webhook caido no rompe el monitor', async () => {
  const monitor = crearMonitor({
    chequear: async () => {
      throw new Error('x');
    },
    avisar: async () => {
      throw new Error('webhook 500');
    }
  });
  await monitor.ejecutar();
  const estado = await monitor.ejecutar();
  assert.equal(estado.alerta_activa, true);
});
