import React, { useEffect, useMemo, useState } from 'react';
import EncabezadoPagina from '../ui/EncabezadoPagina';
import Icono from '../ui/Icono';
import { notify } from '../ui/toast';
import {
  MARCAS,
  PROVEEDORES,
  cargarConfig,
  guardarConfig,
  construirPrompt,
  construirDestino,
  urlProyectoValida,
  extraerListaDeRespuesta
} from './asistenteIA';

const claveBorrador = (usuario) =>
  `mq.ia.borrador.${String(usuario || 'anon').toLowerCase()}`;
const BORRADOR_VACIO = {
  marca: 'AXIS',
  cliente: '',
  contacto: '',
  requerimiento: '',
  notas: '',
  respuesta: ''
};

const leerBorrador = (usuario) => {
  try {
    return {
      ...BORRADOR_VACIO,
      ...JSON.parse(sessionStorage.getItem(claveBorrador(usuario)) || '{}')
    };
  } catch {
    return { ...BORRADOR_VACIO };
  }
};

const copiar = async (texto) => {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
};

const claseCampo =
  'w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100';

function Segmentado({ opciones, valor, onCambio, etiqueta }) {
  return (
    <div
      role="radiogroup"
      aria-label={etiqueta}
      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900"
    >
      {opciones.map((o) => (
        <button
          key={o.clave}
          type="button"
          role="radio"
          aria-checked={valor === o.clave}
          onClick={() => onCambio(o.clave)}
          className={`h-8 rounded-md px-3 text-sm font-medium transition ${
            valor === o.clave
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
          }`}
        >
          {o.nombre}
        </button>
      ))}
    </div>
  );
}

function Tarjeta({ paso, titulo, subtitulo, children, acciones }) {
  return (
    <section className="glass-card overflow-hidden rounded-2xl border border-white/70 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900">
            {paso && <span className="mr-2 text-slate-400">{paso}</span>}
            {titulo}
          </h3>
          {subtitulo && <p className="text-xs text-slate-500">{subtitulo}</p>}
        </div>
        {acciones}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

/**
 * Tab "Asistente IA": el requerimiento se resuelve en la sesion personal de IA
 * del usuario (sus tokens, sus proyectos y skills de preventa) y la respuesta
 * vuelve al cotizador como lista de productos.
 */
export default function AsistenteIAView({ usuario, onCargarLista }) {
  const [config, setConfig] = useState(() => cargarConfig(usuario));
  const [borrador, setBorrador] = useState(() => leerBorrador(usuario));
  const [proyectosAbiertos, setProyectosAbiertos] = useState(false);
  const [verPrompt, setVerPrompt] = useState(false);

  useEffect(() => {
    setConfig(cargarConfig(usuario));
    setBorrador(leerBorrador(usuario));
  }, [usuario]);

  useEffect(() => {
    try {
      sessionStorage.setItem(claveBorrador(usuario), JSON.stringify(borrador));
    } catch {
      /* sin almacenamiento: el borrador vive solo en memoria */
    }
  }, [usuario, borrador]);

  const set = (campo) => (e) =>
    setBorrador((b) => ({ ...b, [campo]: e?.target ? e.target.value : e }));
  const proveedor = PROVEEDORES[config.proveedor];
  const marca = MARCAS[borrador.marca];

  const prompt = useMemo(
    () =>
      construirPrompt({
        marca: borrador.marca,
        requerimiento: borrador.requerimiento,
        cliente: borrador.cliente,
        contacto: borrador.contacto,
        notas: borrador.notas,
        pedirLista: config.pedirLista
      }),
    [borrador, config.pedirLista]
  );
  const destino = useMemo(
    () =>
      construirDestino({
        proveedor: config.proveedor,
        marca: borrador.marca,
        config,
        prompt
      }),
    [config, borrador.marca, prompt]
  );
  const extraida = useMemo(
    () => extraerListaDeRespuesta(borrador.respuesta),
    [borrador.respuesta]
  );
  const lineasExtraidas = extraida.texto
    ? extraida.texto.split('\n').filter(Boolean).length
    : 0;

  const actualizarConfig = (cambio) => {
    setConfig((prev) => {
      const next =
        typeof cambio === 'function' ? cambio(prev) : { ...prev, ...cambio };
      guardarConfig(usuario, next);
      return next;
    });
  };

  const setProyecto = (prov, m, url) =>
    actualizarConfig((prev) => ({
      ...prev,
      proyectos: {
        ...prev.proyectos,
        [prov]: { ...prev.proyectos[prov], [m]: url }
      }
    }));

  const abrir = () => {
    if (!borrador.requerimiento.trim()) {
      notify('Pega primero el requerimiento del cliente', { tipo: 'error' });
      return;
    }
    if (!destino.url) {
      notify(
        `Configura la URL de tu IA para ${marca.nombre} en "Mis proyectos"`,
        { tipo: 'error' }
      );
      setProyectosAbiertos(true);
      return;
    }
    // El portapapeles se pide antes de abrir la pestaña: despues el documento pierde el foco.
    const copia = copiar(prompt);
    window.open(destino.url, '_blank', 'noopener,noreferrer');
    copia.then((ok) => {
      if (destino.prefill) {
        notify(`Abierto en ${proveedor.nombre} con el requerimiento cargado`, {
          tipo: 'ok'
        });
      } else if (ok) {
        notify(`Prompt copiado. Pégalo en ${proveedor.nombre} (Ctrl+V)`, {
          tipo: 'ok',
          duracion: 7000
        });
      } else {
        notify('No se pudo copiar el prompt: usa "Copiar prompt"', {
          tipo: 'error'
        });
      }
    });
  };

  const copiarPrompt = async () => {
    notify(
      (await copiar(prompt)) ? 'Prompt copiado' : 'No se pudo copiar el prompt',
      {}
    );
  };

  const cargar = () => {
    if (!extraida.texto) return;
    onCargarLista(extraida.texto);
  };

  const opcionesProveedor = Object.values(PROVEEDORES);
  const proyectosConfigurados = Object.keys(MARCAS).filter((m) =>
    urlProyectoValida(config.proveedor, config.proyectos[config.proveedor]?.[m])
  ).length;

  return (
    <div className="view-enter space-y-4">
      <EncabezadoPagina
        seccion="Ventas"
        titulo="Asistente IA"
        subtitulo="Resuelve requerimientos con tu propia sesión de IA: tus tokens, tus proyectos y tus skills de preventa."
      >
        <Segmentado
          etiqueta="Proveedor de IA"
          opciones={opcionesProveedor}
          valor={config.proveedor}
          onCambio={(p) => actualizarConfig({ proveedor: p })}
        />
        <button
          type="button"
          className="mq-btn mq-btn-secundario"
          onClick={() => setProyectosAbiertos((v) => !v)}
          aria-expanded={proyectosAbiertos}
        >
          <Icono nombre="carpeta" />
          Mis proyectos
          <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {proyectosConfigurados}/2
          </span>
        </button>
      </EncabezadoPagina>

      {proyectosAbiertos && (
        <Tarjeta
          titulo={`Mis proyectos en ${proveedor.nombre}`}
          subtitulo={`${proveedor.ayudaProyecto} Se guarda solo en este navegador.`}
          acciones={
            <button
              type="button"
              className="mq-btn mq-btn-sm mq-btn-fantasma"
              onClick={() => setProyectosAbiertos(false)}
            >
              Listo
            </button>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            {Object.values(MARCAS).map((m) => {
              const url = config.proyectos[config.proveedor]?.[m.clave] || '';
              const valida = urlProyectoValida(config.proveedor, url);
              return (
                <label
                  key={m.clave}
                  className="flex flex-col gap-1 text-xs text-slate-500"
                >
                  <span className="flex items-center justify-between">
                    <span>
                      Proyecto {m.nombre}{' '}
                      <span className="text-slate-400">· skill {m.skill}</span>
                    </span>
                    {url && (
                      <span
                        className={
                          valida ? 'text-emerald-600' : 'text-rose-600'
                        }
                      >
                        {valida ? 'Configurado' : 'URL no válida'}
                      </span>
                    )}
                  </span>
                  <input
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(e) =>
                      setProyecto(
                        config.proveedor,
                        m.clave,
                        e.target.value.trim()
                      )
                    }
                    placeholder={
                      proveedor.urlNueva
                        ? `${proveedor.urlNueva}  (vacío = chat nuevo)`
                        : 'https://…'
                    }
                    className={`${claseCampo} h-10`}
                  />
                </label>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={config.pedirLista}
              onChange={(e) =>
                actualizarConfig({ pedirLista: e.target.checked })
              }
            />
            Pedir a la IA un bloque «{'LISTA COTIZADORQ'}» para cargar los
            productos al cotizador
          </label>
          <p className="text-xs text-slate-500">
            Sin proyecto se abre un chat nuevo: las skills y el conector MyQuote
            de tu cuenta siguen disponibles si los tienes activados en{' '}
            {proveedor.nombre}.
          </p>
        </Tarjeta>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta
          paso="1"
          titulo="Requerimiento"
          subtitulo={marca.descripcion}
          acciones={
            <Segmentado
              etiqueta="Marca"
              opciones={Object.values(MARCAS)}
              valor={borrador.marca}
              onCambio={(m) => setBorrador((b) => ({ ...b, marca: m }))}
            />
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Cliente
              <input
                value={borrador.cliente}
                onChange={set('cliente')}
                placeholder="Empresa"
                className={`${claseCampo} h-10`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Contacto
              <input
                value={borrador.contacto}
                onChange={set('contacto')}
                placeholder="Nombre de pila"
                className={`${claseCampo} h-10`}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Correo o requerimiento del cliente
            <textarea
              value={borrador.requerimiento}
              onChange={set('requerimiento')}
              rows={9}
              placeholder={
                borrador.marca === 'AXIS'
                  ? 'Pega el correo: "Necesito cotizar 4 P1475-LE con soporte de poste y PoE…"'
                  : 'Pega el correo: "Necesitamos un NAS de 4 bahías para respaldo de 8 TB…"'
              }
              className={`${claseCampo} resize-y py-2`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Notas internas (opcional)
            <input
              value={borrador.notas}
              onChange={set('notas')}
              placeholder="Ej.: el cliente ya tiene switch PoE"
              className={`${claseCampo} h-10`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className="mq-btn mq-btn-primario"
              onClick={abrir}
              disabled={!borrador.requerimiento.trim()}
            >
              Abrir en {proveedor.nombre}
              {destino.usaProyecto ? ` · proyecto ${marca.nombre}` : ''}
            </button>
            <button
              type="button"
              className="mq-btn mq-btn-secundario"
              onClick={copiarPrompt}
              disabled={!borrador.requerimiento.trim()}
            >
              <Icono nombre="portapapeles" />
              Copiar prompt
            </button>
            <button
              type="button"
              className="mq-btn mq-btn-fantasma"
              onClick={() => setVerPrompt((v) => !v)}
              aria-expanded={verPrompt}
            >
              {verPrompt ? 'Ocultar prompt' : 'Ver prompt'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {destino.prefill
              ? `El requerimiento llega cargado al chat de ${proveedor.nombre}.`
              : `Se abre ${destino.usaProyecto ? `tu proyecto ${marca.nombre}` : proveedor.nombre} y el prompt queda copiado: solo pega con Ctrl+V.`}
          </p>
          {verPrompt && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
              {prompt}
            </pre>
          )}
        </Tarjeta>

        <Tarjeta
          paso="2"
          titulo="Traer la respuesta"
          subtitulo="Pega lo que respondió la IA para cargar los productos al carrito."
          acciones={
            borrador.respuesta && (
              <button
                type="button"
                className="mq-btn mq-btn-sm mq-btn-fantasma"
                onClick={() => setBorrador((b) => ({ ...b, respuesta: '' }))}
              >
                Limpiar
              </button>
            )
          }
        >
          <textarea
            value={borrador.respuesta}
            onChange={set('respuesta')}
            rows={12}
            placeholder={
              'Pega aquí la respuesta completa (tabla del preview o bloque LISTA COTIZADORQ)'
            }
            className={`${claseCampo} resize-y py-2 font-mono text-xs`}
          />
          {borrador.respuesta.trim() && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              {extraida.origen === 'bloque' &&
                `Encontré el bloque LISTA COTIZADORQ con ${lineasExtraidas} línea${lineasExtraidas === 1 ? '' : 's'}.`}
              {extraida.origen === 'tabla' &&
                `Encontré la tabla de la cotización con ${lineasExtraidas} producto${lineasExtraidas === 1 ? '' : 's'}.`}
              {extraida.origen === 'texto' &&
                'No encontré tabla ni bloque: se intentará leer el texto línea por línea.'}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="mq-btn mq-btn-primario"
              onClick={cargar}
              disabled={!extraida.texto}
            >
              <Icono nombre="cart" />
              Cargar al cotizador
            </button>
            <span className="text-xs text-slate-500">
              Revisas cada producto antes de agregarlo.
            </span>
          </div>
        </Tarjeta>
      </div>
    </div>
  );
}
