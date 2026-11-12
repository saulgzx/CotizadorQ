import React, { useEffect, useId, useRef, useState } from 'react';

// Carga de un pantallazo para llenar solos los montos de una orden.
// Es agnóstico del transporte: no sabe quién lee la imagen. Recibe `onLeer`
// (async, inyectado) y entrega su resultado por `onListo`.

export const TIPOS_ACEPTADOS = ['image/png', 'image/jpeg', 'image/webp'];
export const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10 MB

const TEXTOS = {
  intcomex: {
    etiqueta: 'Cargar pantallazo para Monto Intcomex',
    instruccion: 'Pega el pantallazo de la OC del cliente',
    listo: 'Pantallazo leído. Revisa los montos Intcomex.'
  },
  axis: {
    etiqueta: 'Cargar pantallazo para Monto Axis',
    instruccion: 'Pega el pantallazo de la planilla de costos de Axis',
    listo: 'Pantallazo leído. Revisa los montos Axis.'
  }
};

export const formatearTamano = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

// Devuelve el mensaje de error, o null si el archivo sirve.
export const validarPantallazo = (file) => {
  if (!file || !TIPOS_ACEPTADOS.includes(file.type)) return 'Solo se aceptan imágenes PNG, JPG o WEBP';
  if (file.size > TAMANO_MAXIMO) return `La imagen pesa ${formatearTamano(file.size)} y el máximo es 10 MB`;
  return null;
};

const archivoDe = (dataTransfer) => {
  if (!dataTransfer) return null;
  if (dataTransfer.files && dataTransfer.files.length > 0) return dataTransfer.files[0];
  const item = Array.from(dataTransfer.items || []).find((i) => i.kind === 'file');
  return item ? item.getAsFile() : null;
};

export default function PantallazoMontos({ campo = 'intcomex', onLeer, onListo, deshabilitado = false }) {
  const textos = TEXTOS[campo] || TEXTOS.intcomex;
  const [archivo, setArchivo] = useState(null);
  const [miniatura, setMiniatura] = useState(null);
  const [estado, setEstado] = useState('vacio'); // vacio | leyendo | listo | error
  const [error, setError] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const zonaRef = useRef(null);
  const inputRef = useRef(null);
  // Identifica la lectura vigente: si se quita la imagen o se desmonta, la respuesta vieja se ignora.
  const lecturaRef = useRef(0);
  const idInput = useId();

  const leyendo = estado === 'leyendo';
  const bloqueado = deshabilitado || leyendo;

  // La miniatura vive mientras viva el archivo: se libera al cambiarlo, quitarlo o desmontar.
  useEffect(() => {
    if (!archivo) return undefined;
    const url = URL.createObjectURL(archivo);
    setMiniatura(url);
    return () => {
      URL.revokeObjectURL(url);
      setMiniatura(null);
    };
  }, [archivo]);

  useEffect(() => () => { lecturaRef.current += 1; }, []);

  const leer = async (file) => {
    const turno = ++lecturaRef.current;
    setEstado('leyendo');
    setError(null);
    let resultado;
    try {
      resultado = await onLeer(file);
    } catch (e) {
      if (turno !== lecturaRef.current) return;
      setEstado('error');
      setError((e && e.message) || 'No se pudo leer el pantallazo');
      return;
    }
    if (turno !== lecturaRef.current) return;
    setEstado('listo');
    if (onListo) onListo(resultado);
  };

  const recibir = (file) => {
    if (bloqueado || !file) return;
    const problema = validarPantallazo(file);
    if (problema) {
      // Un archivo rechazado no pisa la imagen que ya estaba cargada.
      setError(problema);
      return;
    }
    setArchivo(file);
    leer(file);
  };

  const quitar = () => {
    lecturaRef.current += 1;
    setArchivo(null);
    setEstado('vacio');
    setError(null);
  };

  const abrirSelector = () => {
    if (!bloqueado && inputRef.current) inputRef.current.click();
  };

  const alPegar = (e) => {
    const file = archivoDe(e.clipboardData);
    if (!file) return; // texto u otra cosa: no es para nosotros
    e.preventDefault();
    recibir(file);
  };

  const alSoltar = (e) => {
    e.preventDefault();
    setArrastrando(false);
    recibir(archivoDe(e.dataTransfer));
  };

  const alArrastrarEncima = (e) => {
    e.preventDefault();
    if (!bloqueado) setArrastrando(true);
  };

  const alTecla = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      abrirSelector();
    }
  };

  // El pegado llega al elemento con foco. Con el puntero encima tomamos el foco
  // solo si nadie más lo tiene, para no robárselo a un campo que se está editando.
  const alEntrarPuntero = () => {
    if (bloqueado || !zonaRef.current) return;
    const activo = document.activeElement;
    if (!activo || activo === document.body) zonaRef.current.focus({ preventScroll: true });
  };

  const alElegir = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    recibir(file);
  };

  const falloLectura = estado === 'error' && archivo;

  return (
    <div
      className='space-y-2'
      onPaste={alPegar}
      onDrop={alSoltar}
      onDragOver={alArrastrarEncima}
      onDragLeave={() => setArrastrando(false)}
      onMouseEnter={alEntrarPuntero}
    >
      <div
        ref={zonaRef}
        role='button'
        tabIndex={0}
        aria-label={textos.etiqueta}
        aria-disabled={bloqueado}
        aria-busy={leyendo}
        onClick={abrirSelector}
        onKeyDown={alTecla}
        className={`flex items-center gap-3 rounded-xl border border-dashed p-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 ${
          arrastrando
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
            : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
        } ${bloqueado ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-slate-400 dark:hover:border-slate-500'}`}
      >
        {archivo ? (
          <>
            {miniatura && (
              <img
                src={miniatura}
                alt='Miniatura del pantallazo'
                className='h-12 w-12 shrink-0 rounded-md border border-slate-200 object-cover dark:border-slate-700'
              />
            )}
            <div className='min-w-0 flex-1'>
              <div className='truncate font-medium text-slate-900 dark:text-slate-100'>{archivo.name || 'Pantallazo pegado'}</div>
              <div className='text-xs text-slate-500 dark:text-slate-400'>
                {leyendo ? 'Leyendo el pantallazo…' : formatearTamano(archivo.size)}
              </div>
            </div>
          </>
        ) : (
          <div className='min-w-0 flex-1 text-center'>
            <div className='font-medium text-slate-700 dark:text-slate-200'>{textos.instruccion}</div>
            <div className='text-xs text-slate-500 dark:text-slate-400'>
              Ctrl+V, arrastra la imagen o haz clic para elegirla. PNG, JPG o WEBP, hasta 10 MB.
            </div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        id={idInput}
        type='file'
        accept={TIPOS_ACEPTADOS.join(',')}
        onChange={alElegir}
        disabled={bloqueado}
        tabIndex={-1}
        aria-label={`${textos.etiqueta} (elegir archivo)`}
        className='sr-only'
      />

      {estado === 'listo' && (
        <p role='status' className='text-xs text-emerald-700 dark:text-emerald-300'>{textos.listo}</p>
      )}

      {error && (
        <div
          role='alert'
          className='rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-950 dark:text-rose-100'
        >
          {error}
        </div>
      )}

      {archivo && (
        <div className='flex justify-end gap-2'>
          {falloLectura && (
            <button type='button' onClick={() => leer(archivo)} disabled={deshabilitado} className='mq-btn mq-btn-sm mq-btn-secundario'>
              Reintentar
            </button>
          )}
          <button type='button' onClick={quitar} disabled={bloqueado} className='mq-btn mq-btn-sm mq-btn-secundario'>
            Quitar
          </button>
        </div>
      )}
    </div>
  );
}
