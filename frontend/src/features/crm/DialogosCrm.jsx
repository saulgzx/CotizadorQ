import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Dialogo, { Campo, claseInput } from './Dialogo';
import { crmApi } from './crmApi';
import { queryKeys } from '../../app/queryKeys';
import { notify } from '../ui/toast';
import NumeroInput from '../ui/NumeroInput';
import { ETAPAS, MARCAS, mensajeError } from './formato';

const Acciones = ({ onCerrar, enviando, etiqueta, deshabilitado }) => (
  <div className='mt-4 flex justify-end gap-2'>
    <button type='button' onClick={onCerrar} className='mq-btn mq-btn-secundario'>Cancelar</button>
    <button type='submit' disabled={enviando || deshabilitado} className='mq-btn mq-btn-primario'>
      {enviando ? 'Guardando…' : etiqueta}
    </button>
  </div>
);

const vacioANull = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());

/** Crear o editar empresa. En creación, un 409 ofrece abrir la existente. */
export function EmpresaDialogo({ empresa, onCerrar, onGuardada, onAbrirExistente }) {
  const qc = useQueryClient();
  const editando = Boolean(empresa);
  const [form, setForm] = useState({
    nombre: empresa?.nombre || '',
    rut: empresa?.rut || '',
    sitio: empresa?.sitio || '',
    notas: empresa?.notas || ''
  });
  const [enviando, setEnviando] = useState(false);
  const [duplicada, setDuplicada] = useState(null);
  const [error, setError] = useState('');
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return setError('El nombre es obligatorio');
    setEnviando(true);
    setError('');
    setDuplicada(null);
    const datos = {
      nombre: form.nombre.trim(),
      rut: vacioANull(form.rut),
      sitio: vacioANull(form.sitio),
      notas: vacioANull(form.notas)
    };
    try {
      const guardada = editando
        ? await crmApi.actualizarEmpresa(empresa.id, datos)
        : await crmApi.crearEmpresa(datos);
      qc.invalidateQueries({ queryKey: queryKeys.crm.todo });
      notify(editando ? 'Empresa actualizada' : 'Empresa creada', { tipo: 'ok' });
      onGuardada?.(guardada);
      onCerrar();
    } catch (err) {
      if (err.status === 409) {
        setDuplicada(err.data?.empresa_id ?? null);
        setError(err.message || 'Ya existe una empresa con ese nombre');
      } else {
        setError(mensajeError(err));
        notify(mensajeError(err), { tipo: 'error' });
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo titulo={editando ? 'Editar empresa' : 'Nueva empresa'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className='space-y-3'>
        <Campo etiqueta='Nombre'>
          <input data-autofocus className={claseInput} value={form.nombre} onChange={set('nombre')} />
        </Campo>
        <div className='grid grid-cols-2 gap-3'>
          <Campo etiqueta='RUT'>
            <input className={claseInput} value={form.rut} onChange={set('rut')} placeholder='76.123.456-7' />
          </Campo>
          <Campo etiqueta='Sitio web'>
            <input className={claseInput} value={form.sitio} onChange={set('sitio')} placeholder='empresa.cl' />
          </Campo>
        </div>
        <Campo etiqueta='Notas'>
          <textarea className={claseInput} rows={3} value={form.notas} onChange={set('notas')} />
        </Campo>
        {error && (
          <div role='alert' className='rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-950 dark:text-rose-100'>
            {error}
            {duplicada && onAbrirExistente && (
              <button
                type='button'
                onClick={() => {
                  onCerrar();
                  onAbrirExistente(duplicada);
                }}
                className='ml-2 font-semibold underline'
              >
                Abrir la existente
              </button>
            )}
          </div>
        )}
        <Acciones onCerrar={onCerrar} enviando={enviando} etiqueta={editando ? 'Guardar' : 'Crear empresa'} />
      </form>
    </Dialogo>
  );
}

/** Crear o editar contacto de una empresa. */
export function ContactoDialogo({ empresaId, contacto, onCerrar }) {
  const qc = useQueryClient();
  const editando = Boolean(contacto);
  const [form, setForm] = useState({
    nombre: contacto?.nombre || '',
    email: contacto?.email || '',
    telefono: contacto?.telefono || '',
    cargo: contacto?.cargo || '',
    notas: contacto?.notas || ''
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return setError('El nombre es obligatorio');
    setEnviando(true);
    setError('');
    const datos = {
      nombre: form.nombre.trim(),
      email: vacioANull(form.email),
      telefono: vacioANull(form.telefono),
      cargo: vacioANull(form.cargo),
      notas: vacioANull(form.notas)
    };
    try {
      if (editando) await crmApi.actualizarContacto(contacto.id, datos);
      else await crmApi.crearContacto({ empresa_id: empresaId, ...datos });
      qc.invalidateQueries({ queryKey: queryKeys.crm.todo });
      notify(editando ? 'Contacto actualizado' : 'Contacto agregado', { tipo: 'ok' });
      onCerrar();
    } catch (err) {
      setError(mensajeError(err));
      if (err.status !== 409) notify(mensajeError(err), { tipo: 'error' });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo titulo={editando ? 'Editar contacto' : 'Nuevo contacto'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className='space-y-3'>
        <Campo etiqueta='Nombre'>
          <input data-autofocus className={claseInput} value={form.nombre} onChange={set('nombre')} />
        </Campo>
        <div className='grid grid-cols-2 gap-3'>
          <Campo etiqueta='Email'>
            <input type='email' className={claseInput} value={form.email} onChange={set('email')} />
          </Campo>
          <Campo etiqueta='Teléfono'>
            <input className={claseInput} value={form.telefono} onChange={set('telefono')} />
          </Campo>
        </div>
        <Campo etiqueta='Cargo'>
          <input className={claseInput} value={form.cargo} onChange={set('cargo')} />
        </Campo>
        <Campo etiqueta='Notas'>
          <textarea className={claseInput} rows={2} value={form.notas} onChange={set('notas')} />
        </Campo>
        {error && <div role='alert' className='rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-950 dark:text-rose-100'>{error}</div>}
        <Acciones onCerrar={onCerrar} enviando={enviando} etiqueta={editando ? 'Guardar' : 'Agregar contacto'} />
      </form>
    </Dialogo>
  );
}

/**
 * Crear oportunidad. Con `empresaId` la empresa va fija (ficha); sin él se elige
 * de la lista (embudo).
 */
export function OportunidadDialogo({ empresaId: empresaFija, contactos: contactosFijos, onCerrar }) {
  const qc = useQueryClient();
  const [empresaId, setEmpresaId] = useState(empresaFija ?? '');
  const [form, setForm] = useState({
    titulo: '',
    contacto_id: '',
    etapa: 'nueva',
    marca: '',
    es_proyecto: false,
    monto_manual: null,
    fecha_cierre_estimada: ''
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const empresas = useQuery({
    queryKey: queryKeys.crm.empresas({ limite: 200, selector: true }),
    queryFn: () => crmApi.listarEmpresas({ limite: 200 }),
    enabled: !empresaFija
  });
  const ficha = useQuery({
    queryKey: queryKeys.crm.empresa(empresaId),
    queryFn: () => crmApi.obtenerEmpresa(empresaId),
    enabled: Boolean(empresaId) && !contactosFijos
  });
  const contactos = (contactosFijos || ficha.data?.contactos || []).filter((c) => !c.archivado);

  const guardar = async (e) => {
    e.preventDefault();
    if (!empresaId) return setError('Elige una empresa');
    if (!form.titulo.trim()) return setError('El título es obligatorio');
    setEnviando(true);
    setError('');
    try {
      await crmApi.crearOportunidad({
        empresa_id: Number(empresaId),
        titulo: form.titulo.trim(),
        etapa: form.etapa,
        es_proyecto: form.es_proyecto,
        ...(form.contacto_id ? { contacto_id: Number(form.contacto_id) } : {}),
        ...(form.marca ? { marca: form.marca } : {}),
        ...(form.monto_manual !== null ? { monto_manual: form.monto_manual } : {}),
        ...(form.fecha_cierre_estimada ? { fecha_cierre_estimada: form.fecha_cierre_estimada } : {})
      });
      qc.invalidateQueries({ queryKey: queryKeys.crm.todo });
      notify('Oportunidad creada', { tipo: 'ok' });
      onCerrar();
    } catch (err) {
      setError(mensajeError(err));
      notify(mensajeError(err), { tipo: 'error' });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialogo titulo='Nueva oportunidad' onCerrar={onCerrar} ancho='max-w-lg'>
      <form onSubmit={guardar} className='space-y-3'>
        {!empresaFija && (
          <Campo etiqueta='Empresa'>
            <select data-autofocus className={claseInput} value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setForm((f) => ({ ...f, contacto_id: '' })); }}>
              <option value=''>Elegir empresa…</option>
              {(empresas.data?.items || []).map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.nombre}</option>
              ))}
            </select>
          </Campo>
        )}
        <Campo etiqueta='Título'>
          <input data-autofocus={empresaFija ? true : undefined} className={claseInput} value={form.titulo} onChange={set('titulo')} placeholder='Ej. Renovación de cámaras sede norte' />
        </Campo>
        <div className='grid grid-cols-2 gap-3'>
          <Campo etiqueta='Contacto'>
            <select className={claseInput} value={form.contacto_id} onChange={set('contacto_id')}>
              <option value=''>Sin contacto</option>
              {contactos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta='Etapa'>
            <select className={claseInput} value={form.etapa} onChange={set('etapa')}>
              {ETAPAS.filter((et) => et.clave !== 'perdida').map((et) => <option key={et.clave} value={et.clave}>{et.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta='Marca'>
            <select className={claseInput} value={form.marca} onChange={set('marca')}>
              <option value=''>Sin marca</option>
              {MARCAS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Campo>
          <Campo etiqueta='Cierre estimado'>
            <input type='date' className={claseInput} value={form.fecha_cierre_estimada} onChange={set('fecha_cierre_estimada')} />
          </Campo>
        </div>
        <div className='grid grid-cols-2 items-end gap-3'>
          <Campo etiqueta='Monto manual (USD)' ayuda='Vacío: usa el total de la cotización vinculada'>
            <NumeroInput ariaLabel='Monto manual' value={form.monto_manual} permitirVacio onCommit={(v) => setForm((f) => ({ ...f, monto_manual: v }))} className='w-full py-2 text-left' />
          </Campo>
          <label className='flex items-center gap-2 pb-2 text-sm text-slate-700 dark:text-slate-200'>
            <input type='checkbox' checked={form.es_proyecto} onChange={(e) => setForm((f) => ({ ...f, es_proyecto: e.target.checked }))} />
            Proyecto / BID
          </label>
        </div>
        {error && <div role='alert' className='rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-950 dark:text-rose-100'>{error}</div>}
        <Acciones onCerrar={onCerrar} enviando={enviando} etiqueta='Crear oportunidad' />
      </form>
    </Dialogo>
  );
}

/** Pasar a "perdida" exige el motivo. */
export function PerdidaDialogo({ oportunidad, onCerrar, onConfirmar }) {
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const falta = motivo.trim() === '';

  const enviar = (e) => {
    e.preventDefault();
    setTocado(true);
    if (falta) return;
    onConfirmar(motivo.trim());
    onCerrar();
  };

  return (
    <Dialogo
      titulo='Marcar como perdida'
      descripcion={oportunidad.titulo}
      onCerrar={onCerrar}
    >
      <form onSubmit={enviar} className='space-y-3'>
        <Campo etiqueta='Motivo de la pérdida'>
          <textarea
            data-autofocus
            className={claseInput}
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            aria-invalid={tocado && falta}
            placeholder='Ej. Precio, eligió otra marca, proyecto cancelado'
          />
        </Campo>
        {tocado && falta && (
          <p role='alert' className='text-sm text-rose-700 dark:text-rose-300'>El motivo es obligatorio para marcarla como perdida.</p>
        )}
        <Acciones onCerrar={onCerrar} etiqueta='Marcar como perdida' />
      </form>
    </Dialogo>
  );
}
