import React, { useCallback, useEffect, useRef, useState } from 'react';
import EncabezadoPagina from '../ui/EncabezadoPagina';
import Icono from '../ui/Icono';
import { notify } from '../ui/toast';
import { iaAPI } from '../../api';
import MarkdownVista from './MarkdownVista';
import {
  MARCAS,
  construirMensajeInicial,
  extraerListaDeRespuesta,
  textoDeContenido
} from './asistenteIA';
import { markdownAHtml, markdownATexto, separarPreview } from './markdown';

const INTERVALO_MS = 1200;
const claveSesion = (usuario) =>
  `mq.ia.chat.${String(usuario || 'anon').toLowerCase()}`;
const FORM_VACIO = {
  marca: 'AXIS',
  cliente: '',
  contacto: '',
  notas: '',
  requerimiento: ''
};

const leerSesion = (usuario) => {
  try {
    const data = JSON.parse(
      sessionStorage.getItem(claveSesion(usuario)) || '{}'
    );
    return {
      form: { ...FORM_VACIO, ...(data.form || {}) },
      turnos: Array.isArray(data.turnos) ? data.turnos : []
    };
  } catch {
    return { form: { ...FORM_VACIO }, turnos: [] };
  }
};

const claseCampo =
  'w-full rounded-[10px] border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100';

const copiarConFormato = async (markdown) => {
  const html = markdownAHtml(markdown);
  const texto = markdownATexto(markdown);
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([texto], { type: 'text/plain' })
        })
      ]);
    } else {
      await navigator.clipboard.writeText(texto);
    }
    return true;
  } catch {
    return false;
  }
};

function Segmentado({ opciones, valor, onCambio, etiqueta, deshabilitado }) {
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
          disabled={deshabilitado}
          onClick={() => onCambio(o.clave)}
          className={`h-8 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed ${
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

function Respuesta({ texto, onCargarLista }) {
  const { preview } = separarPreview(texto);
  const lista = extraerListaDeRespuesta(texto);
  const tieneLista = lista.origen !== 'texto';
  return (
    <div className="space-y-3">
      <MarkdownVista texto={texto} />
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button
          type="button"
          className="mq-btn mq-btn-sm mq-btn-secundario"
          onClick={async () =>
            notify(
              (await copiarConFormato(preview))
                ? 'Preview copiado: pégalo en Outlook'
                : 'No se pudo copiar',
              {}
            )
          }
        >
          <Icono nombre="portapapeles" />
          Copiar preview para Outlook
        </button>
        <button
          type="button"
          className="mq-btn mq-btn-sm mq-btn-fantasma"
          onClick={async () =>
            notify(
              (await copiarConFormato(texto))
                ? 'Respuesta copiada'
                : 'No se pudo copiar',
              {}
            )
          }
        >
          Copiar todo
        </button>
        {tieneLista && (
          <button
            type="button"
            className="mq-btn mq-btn-sm mq-btn-primario"
            onClick={() => onCargarLista(lista.texto)}
          >
            <Icono nombre="cart" />
            Cargar al cotizador
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Tab "Asistente IA": el requerimiento se resuelve dentro de MyQuote. El backend
 * llama a Claude con las skills de preventa y el conector MyQuote; nada se abre
 * fuera de la app.
 */
export default function AsistenteIAView({ usuario, onCargarLista }) {
  const inicial = useRef(leerSesion(usuario)).current;
  const [form, setForm] = useState(inicial.form);
  const [turnos, setTurnos] = useState(inicial.turnos);
  const [servicio, setServicio] = useState(null);
  const [consulta, setConsulta] = useState(null); // { id, texto, pasos }
  const [seguimiento, setSeguimiento] = useState('');
  const [error, setError] = useState('');
  const finRef = useRef(null);

  useEffect(() => {
    iaAPI
      .estado()
      .then(setServicio)
      .catch((e) => setServicio({ habilitado: false, error: e.message }));
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        claveSesion(usuario),
        JSON.stringify({ form, turnos })
      );
    } catch {
      /* sin almacenamiento: la conversacion vive en memoria */
    }
  }, [usuario, form, turnos]);

  const enCurso = !!consulta;
  const iniciada = turnos.length > 0;
  const marca = MARCAS[form.marca];

  const enviar = useCallback(
    async (nuevosTurnos) => {
      setError('');
      setTurnos(nuevosTurnos);
      const mensajes = nuevosTurnos.map((t) =>
        t.rol === 'user'
          ? { role: 'user', content: t.texto }
          : { role: 'assistant', content: t.contenido }
      );
      try {
        const c = await iaAPI.iniciar({ marca: form.marca, mensajes });
        setConsulta({ id: c.id, texto: '', pasos: [] });
      } catch (e) {
        setTurnos(nuevosTurnos.slice(0, -1));
        setError(e.message);
        return false;
      }
      return true;
    },
    [form.marca]
  );

  // Avance de la consulta en curso.
  useEffect(() => {
    if (!consulta?.id) return undefined;
    let vigente = true;
    const timer = setInterval(async () => {
      try {
        const c = await iaAPI.obtener(consulta.id);
        if (!vigente) return;
        if (c.estado === 'en_curso') {
          setConsulta((prev) =>
            prev?.id === c.id
              ? { ...prev, texto: c.texto, pasos: c.pasos }
              : prev
          );
          return;
        }
        clearInterval(timer);
        setConsulta(null);
        if (c.estado === 'lista') {
          setTurnos((prev) => [
            ...prev,
            {
              rol: 'assistant',
              contenido: c.contenido,
              texto: textoDeContenido(c.contenido) || c.texto
            }
          ]);
        } else if (c.estado === 'error') {
          setError(c.error || 'La consulta falló');
          setTurnos((prev) => {
            const ultimo = prev[prev.length - 1];
            if (prev.length > 1 && ultimo?.rol === 'user')
              setSeguimiento(ultimo.texto);
            return prev.length > 1 ? prev.slice(0, -1) : prev;
          });
        }
      } catch (e) {
        if (!vigente) return;
        clearInterval(timer);
        setConsulta(null);
        setError(e.message);
      }
    }, INTERVALO_MS);
    return () => {
      vigente = false;
      clearInterval(timer);
    };
  }, [consulta?.id]);

  useEffect(() => {
    finRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [turnos.length]);

  const consultar = () => {
    if (!form.requerimiento.trim()) return;
    enviar([{ rol: 'user', texto: construirMensajeInicial(form) }]);
  };

  const responder = async () => {
    const texto = seguimiento.trim();
    if (!texto) return;
    setSeguimiento('');
    const ok = await enviar([...turnos, { rol: 'user', texto }]);
    if (!ok) setSeguimiento(texto);
  };

  const reintentar = () => {
    if (turnos.length === 1 && turnos[0].rol === 'user') enviar(turnos);
  };

  const cancelar = async () => {
    if (!consulta) return;
    await iaAPI.cancelar(consulta.id).catch(() => {});
    setConsulta(null);
    setTurnos((prev) =>
      prev[prev.length - 1]?.rol === 'user' && prev.length > 1
        ? prev.slice(0, -1)
        : prev
    );
  };

  const nueva = () => {
    if (enCurso) return;
    setTurnos([]);
    setSeguimiento('');
    setError('');
    setForm((f) => ({ ...FORM_VACIO, marca: f.marca }));
  };

  const set = (campo) => (e) =>
    setForm((f) => ({ ...f, [campo]: e.target.value }));
  const sinConfigurar = servicio && !servicio.habilitado;
  const primerTurnoFallido = turnos.length === 1 && !enCurso && !!error;

  return (
    <div className="view-enter space-y-4">
      <EncabezadoPagina
        seccion="Ventas"
        titulo="Asistente IA"
        subtitulo="Resuelve requerimientos Axis y QNAP con tus skills de preventa y precios reales de MyQuote, sin salir de la app."
      >
        {iniciada && (
          <button
            type="button"
            className="mq-btn mq-btn-secundario"
            onClick={nueva}
            disabled={enCurso}
          >
            Nueva consulta
          </button>
        )}
      </EncabezadoPagina>

      {sinConfigurar && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {servicio.error
            ? servicio.error
            : `El asistente aún no está configurado en el servidor. Falta: ${(servicio.faltantes || []).join(', ')}.`}
        </div>
      )}

      <section className="glass-card overflow-hidden rounded-2xl border border-white/70 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">
              Requerimiento
            </h3>
            <p className="text-xs text-slate-500">
              Skill {marca.skill} · {marca.descripcion}
            </p>
          </div>
          <Segmentado
            etiqueta="Marca"
            opciones={Object.values(MARCAS)}
            valor={form.marca}
            deshabilitado={iniciada}
            onCambio={(m) => setForm((f) => ({ ...f, marca: m }))}
          />
        </div>
        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Cliente
              <input
                value={form.cliente}
                onChange={set('cliente')}
                disabled={iniciada}
                placeholder="Empresa"
                className={`${claseCampo} h-10`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Contacto
              <input
                value={form.contacto}
                onChange={set('contacto')}
                disabled={iniciada}
                placeholder="Nombre de pila"
                className={`${claseCampo} h-10`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Notas internas
              <input
                value={form.notas}
                onChange={set('notas')}
                disabled={iniciada}
                placeholder="Ej.: ya tiene switch PoE"
                className={`${claseCampo} h-10`}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Correo o requerimiento del cliente
            <textarea
              value={form.requerimiento}
              onChange={set('requerimiento')}
              disabled={iniciada}
              rows={iniciada ? 3 : 8}
              placeholder={
                form.marca === 'AXIS'
                  ? 'Pega el correo: "Necesito cotizar 4 P1475-LE con soporte de poste y PoE…"'
                  : 'Pega el correo: "Necesitamos un NAS de 4 bahías para respaldo de 8 TB…"'
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) consultar();
              }}
              className={`${claseCampo} resize-y py-2`}
            />
          </label>
          {!iniciada && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="mq-btn mq-btn-primario"
                onClick={consultar}
                disabled={!form.requerimiento.trim() || sinConfigurar}
              >
                <Icono nombre="search" />
                Consultar a la IA
              </button>
              <span className="text-xs text-slate-500">
                Ctrl+Enter · Puede tardar uno o dos minutos: consulta precio y
                stock en vivo.
              </span>
            </div>
          )}
        </div>
      </section>

      {turnos.slice(1).map((t, i) =>
        t.rol === 'assistant' ? (
          <section
            key={i}
            className="glass-card rounded-2xl border border-white/70 p-4 shadow-card"
          >
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Respuesta
            </div>
            <Respuesta texto={t.texto} onCargarLista={onCargarLista} />
          </section>
        ) : (
          <div
            key={i}
            className="ml-auto max-w-2xl whitespace-pre-wrap rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white dark:bg-slate-700"
          >
            {t.texto}
          </div>
        )
      )}

      {enCurso && (
        <section
          className="glass-card rounded-2xl border border-white/70 p-4 shadow-card"
          aria-live="polite"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              {consulta.pasos.length
                ? consulta.pasos[consulta.pasos.length - 1]
                : 'Analizando el requerimiento…'}
            </div>
            <button
              type="button"
              className="mq-btn mq-btn-xs mq-btn-fantasma"
              onClick={cancelar}
            >
              Cancelar
            </button>
          </div>
          {consulta.pasos.length > 1 && (
            <ul className="mb-3 space-y-0.5 text-xs text-slate-500">
              {consulta.pasos.slice(0, -1).map((p, i) => (
                <li key={i}>✓ {p}</li>
              ))}
            </ul>
          )}
          {consulta.texto && <MarkdownVista texto={consulta.texto} />}
        </section>
      )}

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          <span>{error}</span>
          {primerTurnoFallido && (
            <button
              type="button"
              className="mq-btn mq-btn-sm mq-btn-secundario"
              onClick={reintentar}
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      {iniciada &&
        turnos[turnos.length - 1]?.rol === 'assistant' &&
        !enCurso && (
          <section className="glass-card rounded-2xl border border-white/70 p-3 shadow-card">
            <div className="flex items-end gap-2">
              <textarea
                value={seguimiento}
                onChange={(e) => setSeguimiento(e.target.value)}
                rows={2}
                placeholder='Pide un ajuste: "agrega el midspan", "cambia a 6 unidades", "sin la tarjeta SD"…'
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
                    responder();
                }}
                className={`${claseCampo} resize-y py-2`}
              />
              <button
                type="button"
                className="mq-btn mq-btn-primario shrink-0"
                onClick={responder}
                disabled={!seguimiento.trim()}
              >
                Enviar
              </button>
            </div>
          </section>
        )}
      <div ref={finRef} />
    </div>
  );
}
