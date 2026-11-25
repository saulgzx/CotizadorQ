import React, { useEffect, useState } from 'react';
import { useCambiosOor } from './useCambiosOor';
import CambiosOorDialogo from './CambiosOorDialogo';
import { EVENTO_ABRIR_CAMBIOS_OOR } from './BotonActualizarOor';
import { hayDialogoAbierto } from '../ui/dialogos';
import './cambiosOor.css';

const CLAVE_POSPUESTO = 'oorPospuesto';

const leerPospuesto = () => {
  try {
    return sessionStorage.getItem(CLAVE_POSPUESTO);
  } catch {
    return null;
  }
};
const guardarPospuesto = (id) => {
  try {
    sessionStorage.setItem(CLAVE_POSPUESTO, String(id));
  } catch {
    /* sin sessionStorage: solo vale mientras la página siga montada */
  }
};

// Revisa en segundo plano si cambió el OOR y, si hay cambios sin revisar, abre solo el
// pop-up. «Más tarde» lo pospone para esa versión durante la sesión y deja un aviso chico.
export default function AvisoCambiosOor({ activo, onAbrirOrden }) {
  const { datos, hay, marcarVisto, marcando } = useCambiosOor({ activo });
  const hastaId = hay ? String(datos.hasta?.id ?? '') : '';
  const [pospuesto, setPospuesto] = useState(leerPospuesto);
  const [vistoLocal, setVistoLocal] = useState(null);
  // Se abre solo una vez por versión, y nunca encima de otro diálogo.
  const [abierto, setAbierto] = useState(false);
  const [intento, setIntento] = useState(0);
  // «Actualizar OOR» lo pidió a propósito: se abre aunque haya otro diálogo o estuviera pospuesto.
  const [forzar, setForzar] = useState(false);

  // «Actualizar OOR» encontró cambios: se abre aunque estuviera pospuesto.
  useEffect(() => {
    const abrir = () => {
      setPospuesto(null);
      setVistoLocal(null);
      setForzar(true);
    };
    window.addEventListener(EVENTO_ABRIR_CAMBIOS_OOR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_CAMBIOS_OOR, abrir);
  }, []);

  const hayVersionPendiente = hay && hastaId !== vistoLocal;
  const quiereAbrir = hayVersionPendiente && pospuesto !== hastaId;

  useEffect(() => {
    if (!quiereAbrir) {
      if (!forzar) setAbierto(false);
      return undefined;
    }
    if (abierto) {
      if (forzar) setForzar(false);
      return undefined;
    }
    if (forzar || !hayDialogoAbierto()) {
      setForzar(false);
      setAbierto(true);
      return undefined;
    }
    // Hay otro diálogo abierto: se vuelve a mirar en un rato.
    const t = setTimeout(() => setIntento((n) => n + 1), 1500);
    return () => clearTimeout(t);
  }, [quiereAbrir, abierto, hastaId, intento, forzar]);

  if (!activo || !hayVersionPendiente) return null;

  const posponer = () => {
    guardarPospuesto(hastaId);
    setPospuesto(hastaId);
    setAbierto(false);
  };

  const alMarcar = async () => {
    const ok = await marcarVisto();
    if (ok) {
      setVistoLocal(hastaId);
      setAbierto(false);
    }
  };

  const reabrir = () => {
    setPospuesto(null);
    try {
      sessionStorage.removeItem(CLAVE_POSPUESTO);
    } catch {
      /* nada */
    }
    setAbierto(true);
  };

  return (
    <>
      {abierto && quiereAbrir && (
        <CambiosOorDialogo
          datos={datos}
          onCerrar={posponer}
          onMarcarVisto={alMarcar}
          marcando={marcando}
          onAbrirOrden={onAbrirOrden ? (bo) => { posponer(); onAbrirOrden(bo); } : undefined}
        />
      )}
      {pospuesto === hastaId && !abierto && (
        <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario mq-oor-recordatorio' onClick={reabrir}>
          Cambios del OOR sin revisar ({datos?.resumen?.bos ?? datos?.grupos?.length ?? 0} BO)
        </button>
      )}
    </>
  );
}
