// Ultima lectura buena de stock (T0.3).
//
// Se escribe en cada lectura exitosa y se sirve, con su fecha, cuando la
// lectura en vivo falla. Vive en memoria y en un archivo JSON: en Railway el
// disco del contenedor se pierde en cada deploy, asi que para que sobreviva
// reinicios hay que montar un volumen y apuntar STOCK_SNAPSHOT_PATH a el.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Snapshot {
  leido_en: string;
  /** MPN normalizado -> unidades. */
  items: Record<string, number | string>;
}

const ruta = () =>
  process.env.STOCK_SNAPSHOT_PATH || join(tmpdir(), 'cotizadorq-mcp', 'stock-snapshot.json');

let enMemoria: Snapshot | null = null;
let cargado = false;

const esSnapshot = (valor: unknown): valor is Snapshot =>
  Boolean(valor) &&
  typeof (valor as Snapshot).leido_en === 'string' &&
  typeof (valor as Snapshot).items === 'object' &&
  (valor as Snapshot).items !== null;

export const leerSnapshot = async (): Promise<Snapshot | null> => {
  if (cargado) return enMemoria;
  cargado = true;
  try {
    const datos: unknown = JSON.parse(await readFile(ruta(), 'utf8'));
    if (esSnapshot(datos)) enMemoria = datos;
  } catch {
    // Sin archivo o ilegible: se arranca sin snapshot, no es un error.
  }
  return enMemoria;
};

export const guardarSnapshot = async (mapa: Map<string, number | string>, leidoEn: string): Promise<void> => {
  enMemoria = { leido_en: leidoEn, items: Object.fromEntries(mapa) };
  cargado = true;
  const destino = ruta();
  try {
    await mkdir(dirname(destino), { recursive: true });
    // Escribir y renombrar: un corte a mitad de escritura no deja un JSON roto.
    const temporal = `${destino}.${process.pid}.tmp`;
    await writeFile(temporal, JSON.stringify(enMemoria), 'utf8');
    await rename(temporal, destino);
  } catch (error) {
    // El snapshot en memoria sigue sirviendo; solo se pierde entre reinicios.
    console.warn(`[stock] no se pudo persistir el snapshot en ${destino}: ${(error as Error).message}`);
  }
};

/** Solo para tests. */
export const _reiniciarSnapshot = () => {
  enMemoria = null;
  cargado = false;
};
