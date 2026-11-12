import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { claseInput } from './Dialogo';
import { fechaCL, mensajeError, usd } from './formato';
import { EstadoVacio, FilasEsqueleto } from '../ui/Esqueleto';
import Resaltado from '../ui/Resaltado';
import { notify } from '../ui/toast';

const POR_PAGINA = 25;

export default function EmpresasTab({ inputBusquedaRef, onAbrirEmpresa, onRevisarDuplicados, onCrear }) {
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(0);
  const [archivadas, setArchivadas] = useState(false);

  // Debounce de la búsqueda: 300 ms después de la última tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(texto.trim());
      setPagina(0);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const params = { q, archivadas: archivadas ? 1 : 0, limite: POR_PAGINA, offset: pagina * POR_PAGINA };
  const empresas = useQuery({
    queryKey: queryKeys.crm.empresas(params),
    queryFn: () => crmApi.listarEmpresas(params),
    placeholderData: (previo) => previo
  });
  const duplicados = useQuery({ queryKey: queryKeys.crm.duplicados, queryFn: crmApi.duplicadosEmpresas });

  useEffect(() => {
    if (empresas.isError) notify(mensajeError(empresas.error, 'No se pudieron cargar las empresas'), { tipo: 'error' });
  }, [empresas.isError, empresas.error]);

  const items = empresas.data?.items || [];
  const total = empresas.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const grupos = duplicados.data?.grupos?.length || 0;

  return (
    <div className='space-y-3'>
      {grupos > 0 && (
        <div className='flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100'>
          <span>
            Hay {grupos} {grupos === 1 ? 'grupo' : 'grupos'} de posibles duplicados entre tus empresas.
          </span>
          <button type='button' onClick={onRevisarDuplicados} className='mq-btn mq-btn-sm mq-btn-secundario'>
            Revisar duplicados
          </button>
        </div>
      )}

      <div className='flex flex-wrap items-center gap-3'>
        <input
          ref={inputBusquedaRef}
          type='search'
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          aria-label='Buscar empresas'
          placeholder='Buscar por nombre, RUT o contacto  ( / )'
          className={`${claseInput} max-w-sm flex-1`}
        />
        <label className='flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200'>
          <input type='checkbox' checked={archivadas} onChange={(e) => { setArchivadas(e.target.checked); setPagina(0); }} />
          Ver archivadas
        </label>
      </div>

      <div className='overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-900'>
        <table className='w-full text-sm'>
          <thead className='border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400'>
            <tr>
              <th scope='col' className='px-3 py-2 font-semibold'>Empresa</th>
              <th scope='col' className='px-3 py-2 font-semibold'>RUT</th>
              <th scope='col' className='px-3 py-2 text-right font-semibold'>Contactos</th>
              <th scope='col' className='px-3 py-2 text-right font-semibold'>Oport. abiertas</th>
              <th scope='col' className='px-3 py-2 text-right font-semibold'>Monto abierto</th>
              <th scope='col' className='px-3 py-2 font-semibold'>Última cotización</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-slate-100 dark:divide-slate-800'>
            {empresas.isLoading && <FilasEsqueleto filas={6} columnas={6} />}
            {items.map((emp) => (
              <tr key={emp.id} className='hover:bg-slate-50 dark:hover:bg-slate-800/60'>
                <td className='px-3 py-2'>
                  <button type='button' onClick={() => onAbrirEmpresa(emp.id)} className='text-left font-medium text-blue-700 hover:underline dark:text-blue-300'>
                    <Resaltado texto={emp.nombre} busqueda={q} />
                  </button>
                </td>
                <td className='px-3 py-2 text-slate-600 dark:text-slate-300'>{emp.rut || '—'}</td>
                <td className='px-3 py-2 text-right tabular-nums'>{emp.contactos}</td>
                <td className='px-3 py-2 text-right tabular-nums'>{emp.oportunidades_abiertas}</td>
                <td className='px-3 py-2 text-right tabular-nums'>{usd(emp.monto_abierto)}</td>
                <td className='px-3 py-2 text-slate-600 dark:text-slate-300'>{fechaCL(emp.ultima_cotizacion_en)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!empresas.isLoading && items.length === 0 && (
          q ? (
            <EstadoVacio icono='search' titulo='Sin resultados' detalle={`Ninguna empresa coincide con «${q}».`} />
          ) : (
            <EstadoVacio
              icono='users'
              titulo='Aún no hay empresas'
              detalle='Se crean solas al generar una cotización, o puedes crear la primera a mano.'
              accion={{ label: 'Nueva empresa', onClick: onCrear }}
            />
          )
        )}
      </div>

      {total > POR_PAGINA && (
        <nav aria-label='Paginación de empresas' className='flex items-center justify-between text-sm text-slate-600 dark:text-slate-300'>
          <span>{total} empresas · página {pagina + 1} de {paginas}</span>
          <span className='flex gap-2'>
            <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
            <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
          </span>
        </nav>
      )}
    </div>
  );
}
