#!/usr/bin/env node
// Supervisor multiplataforma del agente IA. Arranca agente.mjs y lo relanza:
//  - al instante cuando sale con CODIGO_ACTUALIZADO (se actualizo solo);
//  - con espera creciente (2 s, 4 s ... hasta 5 min) cuando se cae.
// Ctrl+C / SIGTERM detienen al agente y al supervisor.
//
// Uso: node iniciar.mjs   (o npm start)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODIGO_ACTUALIZADO } from './actualizador.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ESPERA_INICIAL_MS = 2000;
const ESPERA_MAX_MS = 5 * 60 * 1000;
const ESTABLE_MS = 60 * 1000; // si vivio tanto, la caida siguiente empieza de cero

export const siguienteEspera = (actual) => Math.min(actual * 2, ESPERA_MAX_MS);

export const supervisar = async ({
  comando = process.execPath,
  args = [path.join(AQUI, 'agente.mjs')],
  spawnImpl = spawn,
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
  ahora = () => Date.now(),
  log = console.log,
  maxLanzamientos = Infinity,
  detenido = { valor: false },
  alLanzar = () => {}
} = {}) => {
  let espera = ESPERA_INICIAL_MS;
  for (let n = 0; n < maxLanzamientos && !detenido.valor; n++) {
    const inicio = ahora();
    const { codigo, senal } = await new Promise((resolve) => {
      const hijo = spawnImpl(comando, args, { cwd: AQUI, stdio: 'inherit', windowsHide: true });
      alLanzar(hijo);
      hijo.on('error', () => resolve({ codigo: 1, senal: null }));
      hijo.on('close', (c, s) => resolve({ codigo: c, senal: s }));
    });
    if (detenido.valor) break;
    if (codigo === CODIGO_ACTUALIZADO) {
      log('Supervisor: el agente se actualizó; relanzando con el código nuevo…');
      espera = ESPERA_INICIAL_MS;
      continue;
    }
    if (ahora() - inicio >= ESTABLE_MS) espera = ESPERA_INICIAL_MS;
    log(`Supervisor: el agente terminó (${senal ? `señal ${senal}` : `código ${codigo}`}). Relanzo en ${Math.round(espera / 1000)} s`);
    await esperar(espera);
    espera = siguienteEspera(espera);
  }
};

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const detenido = { valor: false };
  let actual = null;
  const parar = (senal) => () => {
    detenido.valor = true;
    if (actual) actual.kill(senal);
  };
  process.on('SIGINT', parar('SIGINT'));
  process.on('SIGTERM', parar('SIGTERM'));
  supervisar({ detenido, alLanzar: (h) => (actual = h) }).then(() => process.exit(0));
}
