import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ThemeToggle from '../theme/ThemeToggle';

// La página se vuelve a montar al cambiar de ruta, así que lo que debe
// sobrevivir al cambio de sección (dónde estaba el subrayado, hacia qué lado
// entra la vista, si hay cortina pendiente) vive a nivel de módulo.
const memoria = { barra: null, clave: null, indice: -1, previo: -1, cortina: 0 };

/**
 * Dirección de entrada de la vista: 1 si se avanza en el menú, -1 si se
 * retrocede, 0 la primera vez. Da el mismo resultado en cada render de una
 * misma sección.
 */
export function direccionDeVista(claves, actual) {
  if (memoria.clave !== actual) {
    memoria.previo = memoria.indice;
    memoria.indice = claves.indexOf(actual);
    memoria.clave = actual;
  }
  if (memoria.previo < 0 || memoria.indice < 0) return 0;
  return Math.sign(memoria.indice - memoria.previo);
}

const Flecha = () => (
  <svg viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' className='mq-top-flecha h-3 w-3' aria-hidden='true'>
    <path d='m3 4.5 3 3 3-3' />
  </svg>
);

const Insignia = ({ item }) => (item.badge
  ? <span className={`mq-insignia ${item.badgeTone === 'amber' ? 'mq-insignia-aviso' : ''}`}>{item.badge}</span>
  : null);

/**
 * Barra superior de escritorio: el primer grupo va como pestañas, el resto como
 * menús. El subrayado se desliza desde la sección anterior.
 */
export function BarraSuperior({ grupos, actual, onIr, onIndice, onBuscar, theme, onTema, user, onSalir }) {
  const navRef = useRef(null);
  const [barra, setBarra] = useState(memoria.barra);
  const [animar, setAnimar] = useState(false);
  // Un grupo con una sola sección no necesita menú: va como pestaña directa.
  const pestanas = [...(grupos[0]?.items || []), ...grupos.slice(1).filter((g) => g.items.length === 1).flatMap((g) => g.items)];
  const resto = grupos.slice(1).filter((g) => g.items.length > 1);

  useLayoutEffect(() => {
    const medir = () => {
      const nav = navRef.current;
      const el = nav?.querySelector('[data-activo="1"]');
      if (!nav || !el || !el.offsetWidth) return;
      const base = nav.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const siguiente = { left: r.left - base.left + 12, width: r.width - 24 };
      memoria.barra = siguiente;
      setBarra(siguiente);
    };
    // Primero se pinta donde estaba; en el cuadro siguiente viaja a su lugar.
    const id = requestAnimationFrame(() => { setAnimar(true); medir(); });
    window.addEventListener('resize', medir);
    document.fonts?.ready?.then(medir).catch(() => {});
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', medir); };
  }, [actual, grupos.length]);

  return (
    <header className='mq-top hidden lg:flex' aria-label='Navegación principal'>
      <button type='button' className='mq-top-marca' onClick={onIndice} aria-label='Abrir índice de secciones' title='Índice de secciones'>
        <img src='/brand/myquote-horizontal-web.svg' alt='MyQuote' className='h-7 w-auto dark:invert' />
        <Flecha />
      </button>
      <nav ref={navRef} className='mq-top-nav' aria-label='Secciones'>
        {pestanas.map(item => (
          <button
            key={item.key}
            type='button'
            className='mq-top-item'
            data-activo={actual === item.key ? '1' : undefined}
            aria-current={actual === item.key ? 'page' : undefined}
            onClick={() => onIr(item.key)}
          >
            {item.label}
            <Insignia item={item} />
          </button>
        ))}
        {resto.length > 0 && <span className='mq-top-sep hidden xl:block' aria-hidden='true' />}
        {resto.map(grupo => {
          const activo = grupo.items.some(item => item.key === actual);
          return (
            <div key={grupo.clave} className='mq-top-grupo hidden xl:flex'>
              <button type='button' className='mq-top-item' data-activo={activo ? '1' : undefined} aria-haspopup='menu'>
                {grupo.titulo}
                <Flecha />
              </button>
              <div className='mq-top-menu' role='menu'>
                {grupo.items.map(item => (
                  <button
                    key={item.key}
                    type='button'
                    role='menuitem'
                    className='mq-top-opcion'
                    aria-current={actual === item.key ? 'page' : undefined}
                    onClick={() => onIr(item.key)}
                  >
                    {item.label}
                    <Insignia item={item} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {resto.length > 0 && (
          <button type='button' className='mq-top-item xl:hidden' onClick={onIndice} data-activo={resto.some(g => g.items.some(i => i.key === actual)) ? '1' : undefined}>
            Más
            <Flecha />
          </button>
        )}
        {barra && (
          <span
            className='mq-top-barra'
            style={{ left: barra.left, width: barra.width, transition: animar ? undefined : 'none' }}
            aria-hidden='true'
          />
        )}
      </nav>
      <div className='flex items-center gap-1.5'>
        <button type='button' className='mq-top-buscar' onClick={onBuscar} aria-label='Buscar (Ctrl+K)'>
          <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' className='h-4 w-4' aria-hidden='true'>
            <path d='M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z' />
          </svg>
          <span className='hidden xl:inline'>Buscar</span>
          <kbd className='hidden xl:inline'>Ctrl K</kbd>
        </button>
        <ThemeToggle theme={theme} onToggle={onTema} />
        <div className='mq-top-grupo'>
          <button type='button' className='mq-top-usuario' aria-haspopup='menu' aria-label='Cuenta'>
            {user?.logo_url
              ? <img src={user.logo_url} alt='' className='h-full w-full rounded-[5px] object-contain bg-white' />
              : (user?.nombre || user?.usuario || '?').slice(0, 1)}
          </button>
          <div className='mq-top-menu mq-top-menu-der' role='menu'>
            <div className='px-2.5 pb-2 pt-1.5'>
              <div className='truncate text-sm font-semibold text-slate-900'>{user?.nombre || user?.usuario}</div>
              <div className='truncate text-xs text-slate-500'>{user?.empresa || ''}</div>
            </div>
            <button type='button' role='menuitem' className='mq-top-opcion mq-top-opcion-salir' onClick={onSalir}>Cerrar sesión</button>
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Índice a pantalla completa: todas las secciones en tipografía grande.
 * Se abre desde la marca (escritorio) o desde el botón de menú (móvil).
 */
export function Indice({ abierto, grupos, actual, onIr, onCerrar, onBuscar, theme, onTema, user, onSalir }) {
  const ref = useRef(null);

  // Escape y el bloqueo de scroll los maneja la página; aquí solo el foco.
  useEffect(() => {
    if (!abierto) return undefined;
    const id = setTimeout(() => {
      (ref.current?.querySelector('[aria-current="page"]') || ref.current?.querySelector('.mq-indice-item'))?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(id);
  }, [abierto]);

  const ir = clave => {
    if (clave !== actual) memoria.cortina = Date.now();
    onIr(clave);
    onCerrar();
  };

  let orden = 0;
  return (
    <div
      ref={ref}
      className={`mq-indice ${abierto ? 'mq-indice-abierto' : ''}`}
      role='dialog'
      aria-modal='true'
      aria-label='Índice de secciones'
      aria-hidden={abierto ? undefined : 'true'}
      inert={abierto ? undefined : ''}
    >
      <div className='mq-indice-cabecera'>
        <img src='/brand/myquote-horizontal-web.svg' alt='MyQuote' className='h-7 w-auto dark:invert' />
        <button type='button' className='mq-btn mq-btn-sm mq-btn-secundario' onClick={onCerrar}>
          Cerrar <kbd className='hidden sm:inline'>Esc</kbd>
        </button>
      </div>
      <div className='mq-indice-cuerpo'>
        {grupos.map((grupo, g) => (
          <section key={grupo.clave} className={g === 0 ? 'mq-indice-principal' : ''}>
            <h2 className='mq-sobre mq-indice-titulo'>{grupo.titulo}</h2>
            {grupo.items.map(item => {
              orden += 1;
              return (
                <button
                  key={item.key}
                  type='button'
                  className='mq-indice-item'
                  style={{ '--i': orden }}
                  aria-current={actual === item.key ? 'page' : undefined}
                  onClick={() => ir(item.key)}
                >
                  <span className='mq-indice-num'>{String(orden).padStart(2, '0')}</span>
                  <span className='mq-indice-texto'>{item.label}</span>
                  <Insignia item={item} />
                </button>
              );
            })}
          </section>
        ))}
        <section>
          <h2 className='mq-sobre mq-indice-titulo'>Sesión</h2>
          <div className='mq-indice-item mq-indice-fijo' style={{ '--i': orden + 1 }}>
            <span className='min-w-0'>
              <span className='block truncate text-base font-semibold text-slate-900'>{user?.nombre || user?.usuario}</span>
              <span className='block truncate text-sm font-normal text-slate-500'>{user?.empresa || ''}</span>
            </span>
            <ThemeToggle theme={theme} onToggle={onTema} />
          </div>
          <button type='button' className='mq-indice-item mq-indice-menor' style={{ '--i': orden + 2 }} onClick={() => { onCerrar(); onBuscar(); }}>
            <span className='mq-indice-texto'>Buscar</span>
            <kbd className='hidden sm:inline'>Ctrl K</kbd>
          </button>
          <button type='button' className='mq-indice-item mq-indice-menor' style={{ '--i': orden + 3 }} onClick={() => { onCerrar(); onSalir(); }}>
            <span className='mq-indice-texto'>Cerrar sesión</span>
          </button>
        </section>
      </div>
    </div>
  );
}

/**
 * Cortina: cuando se elige una sección desde el índice, un panel del color del
 * papel se retira hacia arriba y descubre la vista nueva. Además, en cada
 * cambio de sección una línea recorre el borde superior.
 */
export function Cortina({ vista }) {
  // La petición vale unos instantes: si la página se remonta al cambiar de
  // ruta, la cortina vuelve a salir desde arriba en el árbol nuevo.
  const pendiente = () => Date.now() - memoria.cortina < 600;
  const [activa, setActiva] = useState(pendiente);

  useEffect(() => {
    if (pendiente()) setActiva(true);
  }, [vista]);

  return (
    <>
      <span key={vista} className='mq-barrido' aria-hidden='true' />
      {activa && <div className='mq-cortina' aria-hidden='true' onAnimationEnd={() => setActiva(false)} />}
    </>
  );
}
