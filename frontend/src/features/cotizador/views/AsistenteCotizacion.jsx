import React, { useState } from 'react';
import { cotizacionesAPI } from '../../../api';

// Asistente de cotización: el vendedor pega el requerimiento del cliente en texto
// libre y el backend lo interpreta contra el catálogo, devolviendo líneas propuestas.
//
// Nada se agrega solo: las propuestas se revisan y el vendedor confirma. Los precios
// no vienen del modelo, se toman del producto real del catálogo local.
const CONFIANZA_ESTILOS = {
  alta: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  media: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  baja: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
};

const EJEMPLO = 'Ej: El cliente necesita 2 NAS de 8 bahías para 40TB, 3 switches de 24 puertos PoE y 6 cámaras domo para exterior.';

export default function AsistenteCotizacion({ productos, onAplicar, onCerrar }) {
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  const [seleccion, setSeleccion] = useState({});

  const interpretar = async () => {
    if (!texto.trim() || cargando) return;
    setCargando(true);
    setError('');
    setResultado(null);
    try {
      const data = await cotizacionesAPI.interpretar(texto);
      setResultado(data);
      // Por defecto se preseleccionan solo las coincidencias fiables. Las de
      // confianza baja exigen que el vendedor las marque a mano.
      const inicial = {};
      (data.lineas || []).forEach((linea) => {
        inicial[linea.producto_id] = {
          marcado: linea.confianza !== 'baja',
          cantidad: linea.cantidad
        };
      });
      setSeleccion(inicial);
    } catch (err) {
      setError(err.message || 'No se pudo interpretar el requerimiento');
    } finally {
      setCargando(false);
    }
  };

  const toggle = (productoId) => {
    setSeleccion((prev) => ({
      ...prev,
      [productoId]: { ...prev[productoId], marcado: !prev[productoId]?.marcado }
    }));
  };

  const cambiarCantidad = (productoId, valor) => {
    const cantidad = Math.max(1, parseInt(valor, 10) || 1);
    setSeleccion((prev) => ({ ...prev, [productoId]: { ...prev[productoId], cantidad } }));
  };

  const lineas = resultado?.lineas || [];
  const marcadas = lineas.filter((linea) => seleccion[linea.producto_id]?.marcado);

  const aplicar = () => {
    // Se resuelve contra el catálogo ya cargado en la página: si un id no está
    // presente se omite en vez de agregar una línea sin precio.
    const porId = new Map(productos.map((p) => [Number(p.id), p]));
    const aAgregar = marcadas
      .map((linea) => {
        const producto = porId.get(Number(linea.producto_id));
        if (!producto) return null;
        return { producto, cantidad: seleccion[linea.producto_id]?.cantidad || 1 };
      })
      .filter(Boolean);

    if (aAgregar.length > 0) onAplicar(aAgregar);
    onCerrar();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="glass-card my-8 w-full max-w-3xl rounded-2xl border border-white/70 p-6 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.9)] dark:border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Asistente de cotización</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Pegá el requerimiento del cliente y se propondrán productos del catálogo.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
            aria-label="Cerrar asistente"
          >
            ✕
          </button>
        </div>

        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder={EJEMPLO}
          className="mt-4 w-full rounded-xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-100"
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{texto.length}/4000</span>
          <button
            type="button"
            onClick={interpretar}
            disabled={cargando || !texto.trim()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-700 dark:hover:bg-slate-600"
          >
            {cargando ? 'Interpretando…' : 'Interpretar requerimiento'}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </p>
        )}

        {resultado && (
          <div className="mt-5 space-y-4">
            {lineas.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No se encontraron productos del catálogo que coincidan con el requerimiento.
              </p>
            )}

            {lineas.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Productos propuestos ({lineas.length})
                </p>
                {lineas.map((linea) => {
                  const estado = seleccion[linea.producto_id] || {};
                  return (
                    <div
                      key={linea.producto_id}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/10"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(estado.marcado)}
                        onChange={() => toggle(linea.producto_id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-slate-900"
                        aria-label={`Incluir ${linea.sku || linea.descripcion}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {linea.sku || linea.mpn || 'Sin SKU'}
                          </span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-white/10 dark:text-slate-400">
                            {linea.origen}
                          </span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${CONFIANZA_ESTILOS[linea.confianza] || CONFIANZA_ESTILOS.baja}`}>
                            confianza {linea.confianza}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">{linea.descripcion}</p>
                        {linea.razon && (
                          <p className="mt-1 text-xs italic text-slate-400">{linea.razon}</p>
                        )}
                      </div>
                      <input
                        type="number"
                        min="1"
                        value={estado.cantidad ?? linea.cantidad}
                        onChange={(e) => cambiarCantidad(linea.producto_id, e.target.value)}
                        className="w-16 shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-100"
                        aria-label="Cantidad"
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {resultado.sin_coincidencia?.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Sin coincidencia en el catálogo
                </p>
                <ul className="mt-2 space-y-1">
                  {resultado.sin_coincidencia.map((item, i) => (
                    <li key={i} className="text-sm text-amber-800 dark:text-amber-200">
                      <span className="font-medium">{item.texto}</span>
                      {item.motivo ? ` — ${item.motivo}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {resultado.notas && (
              <p className="text-sm text-slate-500 dark:text-slate-400">{resultado.notas}</p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-white/10">
              <button
                type="button"
                onClick={onCerrar}
                className="rounded-xl px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100 dark:hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={aplicar}
                disabled={marcadas.length === 0}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                Agregar {marcadas.length} {marcadas.length === 1 ? 'producto' : 'productos'}
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
          Las propuestas son sugerencias generadas automáticamente. Revisá SKU y cantidades antes de
          enviar la cotización: los precios se calculan en el servidor a partir del catálogo.
        </p>
      </div>
    </div>
  );
}
