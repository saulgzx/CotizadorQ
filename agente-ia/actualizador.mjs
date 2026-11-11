// Auto-actualizacion del agente: compara el repo local con origin/main y, si
// esta atrasado y es seguro, hace un fast-forward. Nunca hace nada destructivo:
// sin reset --hard, sin stash, sin fuerza, y no toca un arbol sucio u otra rama.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Codigo de salida con que agente.mjs pide al supervisor (iniciar.mjs) que lo relance con el codigo nuevo. */
export const CODIGO_ACTUALIZADO = 75;

const ARCHIVOS_DEPENDENCIAS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'];

/** Ejecuta git SIN shell y con timeout. Nunca rechaza: devuelve { codigo, salida, error }. */
export const crearGit =
  (cwd, { timeoutMs = 60000, execFileImpl = execFile } = {}) =>
  (args, { timeout = timeoutMs } = {}) =>
    new Promise((resolve) => {
      execFileImpl('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        const salida = String(stdout || '').trim();
        if (!error) return resolve({ codigo: 0, salida, error: '' });
        const detalle = String(stderr || '').trim() || error.message;
        resolve({ codigo: typeof error.code === 'number' ? error.code : 1, salida, error: error.killed ? `timeout: ${detalle}` : detalle });
      });
    });

/** SHA corto de HEAD, o null si no hay git. */
export const versionActual = async (git) => {
  const r = await git(['rev-parse', '--short', 'HEAD'], { timeout: 10000 });
  return r.codigo === 0 && r.salida ? r.salida : null;
};

/** Instala dependencias (npm ci si hay lockfile). npm en Windows es npm.cmd: ahi hace falta shell (args fijos). */
export const instalarDependencias = (cwd, { execFileImpl = execFile, timeoutMs = 10 * 60 * 1000 } = {}) =>
  new Promise((resolve) => {
    const orden = existsSync(path.join(cwd, 'package-lock.json')) ? 'ci' : 'install';
    execFileImpl(
      'npm',
      [orden, '--no-audit', '--no-fund'],
      { cwd, timeout: timeoutMs, windowsHide: true, shell: process.platform === 'win32' },
      (error, _stdout, stderr) => resolve(error ? { ok: false, error: String(stderr || error.message).trim().slice(-300) } : { ok: true, orden })
    );
  });

/**
 * Revisa y, si corresponde, actualiza. Devuelve { estado, ... } y no lanza.
 * estado: 'actualizado' | 'al-dia' | 'sin-git' | 'otra-rama' | 'fetch-fallo' | 'sucio'
 *         | 'divergido' | 'pull-fallo' | 'npm-fallo'
 * `git` e `instalar` son inyectables para probar sin tocar nada real.
 * npmPendiente: una pasada anterior actualizo el codigo pero fallo npm; se reintenta.
 */
export const comprobarActualizacion = async ({ git, instalar, log = console.log, npmPendiente = false }) => {
  const aviso = (estado, msg, extra = {}) => {
    log(`Auto-actualización: ${msg}`);
    return { estado, ...extra };
  };

  const rama = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 10000 });
  if (rama.codigo !== 0) return aviso('sin-git', `no hay git en esta carpeta (${rama.error.slice(0, 120)}); no se actualiza solo.`);
  if (rama.salida !== 'main') return aviso('otra-rama', `la rama actual es "${rama.salida}", no "main"; no se actualiza.`);

  const fetch = await git(['fetch', 'origin', 'main']);
  if (fetch.codigo !== 0) return aviso('fetch-fallo', `falló git fetch (${fetch.error.slice(0, 160)}); reintento más tarde.`);

  const local = await git(['rev-parse', 'HEAD'], { timeout: 10000 });
  const remoto = await git(['rev-parse', 'origin/main'], { timeout: 10000 });
  if (local.codigo !== 0 || remoto.codigo !== 0) return aviso('fetch-fallo', 'no se pudo leer HEAD u origin/main.');

  if (local.salida === remoto.salida) {
    if (!npmPendiente) return { estado: 'al-dia' };
    const r = await instalar();
    if (!r.ok) return aviso('npm-fallo', `sigue fallando la instalación de dependencias (${r.error}).`);
    return aviso('actualizado', 'dependencias instaladas; reiniciando.', { de: local.salida, a: remoto.salida });
  }

  // HEAD debe ser ancestro de origin/main (solo atrasado). Con commits propios no se toca.
  const ancestro = await git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { timeout: 10000 });
  if (ancestro.codigo !== 0) return aviso('divergido', 'la copia local tiene commits que no están en origin/main; no se actualiza.');

  const arbol = await git(['status', '--porcelain', '--untracked-files=no'], { timeout: 15000 });
  if (arbol.codigo !== 0) return aviso('sucio', 'no se pudo leer el estado del árbol de trabajo; no se actualiza.');
  if (arbol.salida) return aviso('sucio', 'hay cambios locales sin confirmar; no se actualiza hasta que el árbol esté limpio.');

  // Rutas relativas a agente-ia/ (cwd), limitadas a esta carpeta.
  const cambios = await git(['diff', '--name-only', '--relative', 'HEAD', 'origin/main', '--', '.'], { timeout: 15000 });
  const cambioDeps = cambios.codigo === 0 && cambios.salida.split(/\r?\n/).some((f) => ARCHIVOS_DEPENDENCIAS.includes(f.trim()));

  const pull = await git(['pull', '--ff-only', 'origin', 'main']);
  if (pull.codigo !== 0) return aviso('pull-fallo', `falló git pull --ff-only (${pull.error.slice(0, 160)}); no se cambió nada.`);

  if (cambioDeps) {
    const r = await instalar();
    if (!r.ok) return aviso('npm-fallo', `código actualizado pero falló npm (${r.error}); sigo con el código en memoria y reintento.`);
  }
  return aviso('actualizado', `${local.salida.slice(0, 7)} → ${remoto.salida.slice(0, 7)}; reiniciando para usar el código nuevo.`, {
    de: local.salida,
    a: remoto.salida
  });
};
