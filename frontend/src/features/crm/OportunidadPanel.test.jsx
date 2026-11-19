import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import OportunidadPanel from './OportunidadPanel';
import { crmApi } from './crmApi';
import { notify } from '../ui/toast';
import { ARBOL, cotArbol, opArbol, renderConQuery } from './fixturesCrm';

vi.mock('./crmApi', () => ({ crmApi: { arbol: vi.fn(), actualizarOportunidad: vi.fn() } }));
vi.mock('../ui/toast', () => ({ notify: vi.fn() }));

// 2026-11-19 es jueves: "+3 días" cae en sábado y pasa al lunes 23.
const HOY = '2026-11-19';

const copia = () => JSON.parse(JSON.stringify(ARBOL));
const conSeguimiento = (extra = {}) => {
  const datos = copia();
  datos.oportunidades[0] = opArbol({ id: 1, proximo_seguimiento: '2026-11-17', seguimiento_nota: 'Llamar a Ana', ...extra });
  return datos;
};

const montar = async (datos = copia(), props = {}) => {
  // El "servidor" aplica los cambios a sus datos, así lo que se vuelve a pedir tras guardar es coherente.
  crmApi.arbol.mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(datos))));
  crmApi.actualizarOportunidad.mockImplementation(async (id, cambios) => {
    const o = datos.oportunidades.find((x) => x.id === id);
    Object.assign(o, cambios);
    if (['ganada', 'perdida'].includes(cambios.etapa)) Object.assign(o, { proximo_seguimiento: null, seguimiento_nota: null });
    return o;
  });
  const callbacks = { onCerrar: vi.fn(), onAbrirEmpresa: vi.fn(), onAbrirCotizacion: vi.fn() };
  const r = renderConQuery(<OportunidadPanel oportunidadId={1} hoy={HOY} {...callbacks} {...props} />);
  await screen.findByRole('dialog', { name: datos.oportunidades.find((o) => o.id === (props.oportunidadId ?? 1))?.titulo || 'Oportunidad' });
  if (datos.oportunidades.some((o) => o.id === (props.oportunidadId ?? 1))) await screen.findByRole('heading', { name: 'Seguimiento' });
  return { ...r, ...callbacks };
};

const fecha = () => screen.getByLabelText('Fecha del próximo seguimiento');
const nota = () => screen.getByLabelText('Nota del seguimiento');
const guardar = () => screen.getByRole('button', { name: 'Guardar seguimiento' });
const escribirFecha = (v) => fireEvent.change(fecha(), { target: { value: v } });
const escribirNota = (v) => fireEvent.change(nota(), { target: { value: v } });

describe('OportunidadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('muestra los datos de la oportunidad', async () => {
    await montar(copia());
    const dialogo = screen.getByRole('dialog', { name: 'NAS sucursal Norte' });
    expect(within(dialogo).getByRole('button', { name: 'Acme SA' })).toBeInTheDocument();
    expect(within(dialogo).getByText('Ana Pérez')).toBeInTheDocument();
    const datos = within(dialogo.querySelector('dl'));
    expect(datos.getByText('$12,400.00')).toBeInTheDocument();
    expect(within(dialogo).getByText('QNAP')).toBeInTheDocument();
    expect(within(dialogo).getByText('6 días')).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Etapa de NAS sucursal Norte')).toHaveValue('negociacion');
    expect(within(dialogo).queryByText('Proyecto / BID')).not.toBeInTheDocument();
    expect(within(dialogo).queryByText('Cierre estimado')).not.toBeInTheDocument();
  });

  test('muestra chips de proyecto y BO, cierre estimado y motivo de pérdida', async () => {
    const datos = copia();
    datos.oportunidades[0] = opArbol({
      id: 1, es_proyecto: true, bo: 'BO-1001', etapa: 'perdida', motivo_perdida: 'Precio', fecha_cierre_estimada: '2026-12-15'
    });
    await montar(datos);
    expect(screen.getByText('Proyecto / BID')).toBeInTheDocument();
    expect(screen.getByText('BO-1001')).toBeInTheDocument();
    expect(screen.getByText('15-12-2026')).toBeInTheDocument();
    expect(screen.getByText('Precio')).toBeInTheDocument();
  });

  test('lista las cotizaciones de la oportunidad con versión, vigente, fecha y total', async () => {
    await montar();
    const lista = screen.getByRole('list');
    const items = within(lista).getAllByRole('listitem');
    expect(items).toHaveLength(2); // las de otras oportunidades no aparecen
    expect(within(items[0]).getByRole('button', { name: 'Abrir cotización 1041' })).toHaveTextContent('#1041');
    expect(within(items[0]).getByText('v2')).toBeInTheDocument();
    expect(within(items[0]).getByText('vigente')).toBeInTheDocument();
    expect(within(items[0]).getByText('$12,400.00')).toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: 'Abrir cotización 1038' })).toBeInTheDocument();
    expect(within(items[1]).queryByText('vigente')).not.toBeInTheDocument();
    expect(within(items[1]).queryByText(/^v\d/)).not.toBeInTheDocument();
    expect(within(items[1]).getByText('$11,900.00')).toBeInTheDocument();
  });

  test('una sola cotización no lleva "vigente"; sin cotizaciones lo dice', async () => {
    await montar(copia(), { oportunidadId: 2 });
    expect(screen.queryByText('vigente')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir cotización 1050' })).toBeInTheDocument();
  });

  test('sin cotizaciones: "Sin cotizaciones vinculadas."', async () => {
    await montar(copia(), { oportunidadId: 5 });
    expect(screen.getByText('Sin cotizaciones vinculadas.')).toBeInTheDocument();
  });

  test('abrir la empresa llama a su callback y cierra el panel', async () => {
    const { onAbrirEmpresa, onCerrar } = await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Acme SA' }));
    expect(onAbrirEmpresa).toHaveBeenCalledWith(10);
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  test('abrir una cotización llama a su callback y cierra el panel', async () => {
    const { onAbrirCotizacion, onCerrar } = await montar();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cotización 1038' }));
    expect(onAbrirCotizacion).toHaveBeenCalledWith(502);
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  test('Escape y el botón de cerrar llaman a onCerrar', async () => {
    const { onCerrar } = await montar();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar diálogo' }));
    expect(onCerrar).toHaveBeenCalledTimes(2);
  });

  test('una oportunidad que no está avisa y ofrece cerrar, sin reventar', async () => {
    const { onCerrar } = await montar(copia(), { oportunidadId: 999 });
    expect(await screen.findByText('Esta oportunidad ya no está disponible')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha del próximo seguimiento')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' }).find((b) => b.textContent === 'Cerrar'));
    expect(onCerrar).toHaveBeenCalled();
  });

  describe('seguimiento', () => {
    test('sin seguimiento: estado "Sin seguimiento" y el botón de guardar deshabilitado', async () => {
      await montar();
      expect(screen.getByText('Sin seguimiento')).toBeInTheDocument();
      expect(fecha()).toHaveValue('');
      expect(nota()).toHaveValue('');
      expect(guardar()).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Hecho' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Quitar seguimiento' })).not.toBeInTheDocument();
    });

    test('con seguimiento muestra el estado, su punto de urgencia, la nota y el formulario lleno', async () => {
      await montar(conSeguimiento());
      expect(screen.getByText('Vencido hace 2 días')).toBeInTheDocument();
      expect(document.querySelector('.mq-punto-critico')).toBeInTheDocument();
      expect(screen.getByText('Nota: Llamar a Ana')).toBeInTheDocument();
      expect(fecha()).toHaveValue('2026-11-17');
      expect(nota()).toHaveValue('Llamar a Ana');
      expect(guardar()).toBeDisabled(); // nada cambió
      expect(screen.getByRole('button', { name: 'Hecho' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Quitar seguimiento' })).toBeInTheDocument();
    });

    test.each([
      ['Hoy', '2026-11-19'],
      ['Mañana', '2026-11-20'],
      ['+3 días', '2026-11-23'], // sábado 22 -> lunes 23
      ['+1 semana', '2026-11-26']
    ])('el atajo "%s" pone %s en el campo sin guardar', async (nombre, esperado) => {
      await montar();
      fireEvent.click(screen.getByRole('button', { name: nombre }));
      expect(fecha()).toHaveValue(esperado);
      expect(guardar()).toBeEnabled();
      expect(crmApi.actualizarOportunidad).not.toHaveBeenCalled();
    });

    test('guarda fecha y nota recortada y deja el panel abierto con el estado nuevo', async () => {
      const { onCerrar } = await montar();
      fireEvent.click(screen.getByRole('button', { name: 'Mañana' }));
      escribirNota('  Llamar a Ana por el descuento  ');
      expect(screen.getByText('33/300')).toBeInTheDocument();
      fireEvent.click(guardar());
      await waitFor(() =>
        expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, {
          proximo_seguimiento: '2026-11-20',
          seguimiento_nota: 'Llamar a Ana por el descuento'
        })
      );
      expect(await screen.findByText('Mañana', { selector: 'span.font-medium' })).toBeInTheDocument();
      expect(screen.getByText('Nota: Llamar a Ana por el descuento')).toBeInTheDocument();
      expect(nota()).toHaveValue('Llamar a Ana por el descuento');
      expect(screen.getByRole('button', { name: 'Quitar seguimiento' })).toBeInTheDocument();
      expect(onCerrar).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith('Seguimiento guardado', { tipo: 'ok' });
    });

    test('una nota vacía o de espacios se guarda como null', async () => {
      await montar();
      fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
      escribirNota('   ');
      fireEvent.click(guardar());
      await waitFor(() =>
        expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { proximo_seguimiento: '2026-11-19', seguimiento_nota: null })
      );
    });

    test('una nota sin fecha no se puede guardar y lo explica', async () => {
      await montar();
      escribirNota('Llamar a Ana');
      expect(guardar()).toBeDisabled();
      expect(screen.getByText('Pon una fecha para guardar la nota')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
      expect(screen.queryByText('Pon una fecha para guardar la nota')).not.toBeInTheDocument();
      expect(guardar()).toBeEnabled();
    });

    test('el campo de nota limita el largo a 300', async () => {
      await montar();
      expect(nota()).toHaveAttribute('maxlength', '300');
      expect(screen.getByText('0/300')).toBeInTheDocument();
    });

    test('"Hecho" vacía el formulario, ayuda a elegir y enfoca el primer atajo; guardar sin fecha deja null/null', async () => {
      await montar(conSeguimiento());
      fireEvent.click(screen.getByRole('button', { name: 'Hecho' }));
      expect(fecha()).toHaveValue('');
      expect(nota()).toHaveValue('');
      expect(screen.getByText('Elige cuándo es el próximo seguimiento, o guarda sin fecha para dejarla sin seguimiento.')).toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hoy' }));
      expect(guardar()).toBeEnabled();
      fireEvent.click(guardar());
      await waitFor(() =>
        expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { proximo_seguimiento: null, seguimiento_nota: null })
      );
      expect(notify).toHaveBeenCalledWith('Seguimiento quitado', { tipo: 'ok' });
      expect(await screen.findByText('Sin seguimiento')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Hecho' })).not.toBeInTheDocument();
    });

    test('"Hecho" y luego un atajo guarda el siguiente seguimiento', async () => {
      await montar(conSeguimiento());
      fireEvent.click(screen.getByRole('button', { name: 'Hecho' }));
      fireEvent.click(screen.getByRole('button', { name: '+1 semana' }));
      expect(screen.queryByText(/Elige cuándo es el próximo/)).not.toBeInTheDocument();
      fireEvent.click(guardar());
      await waitFor(() =>
        expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { proximo_seguimiento: '2026-11-26', seguimiento_nota: null })
      );
    });

    test('"Quitar seguimiento" guarda null/null de inmediato', async () => {
      await montar(conSeguimiento());
      fireEvent.click(screen.getByRole('button', { name: 'Quitar seguimiento' }));
      await waitFor(() =>
        expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { proximo_seguimiento: null, seguimiento_nota: null })
      );
      expect(await screen.findByText('Sin seguimiento')).toBeInTheDocument();
      expect(fecha()).toHaveValue('');
      expect(nota()).toHaveValue('');
    });

    test('mientras guarda, los botones quedan deshabilitados', async () => {
      await montar(conSeguimiento());
      let resolver;
      crmApi.actualizarOportunidad.mockReturnValue(new Promise((r) => { resolver = r; }));
      fireEvent.click(screen.getByRole('button', { name: 'Mañana' }));
      fireEvent.click(guardar());
      await waitFor(() => expect(guardar()).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Hecho' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Quitar seguimiento' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Hoy' })).toBeDisabled();
      resolver({});
      await waitFor(() => expect(screen.getByRole('button', { name: 'Hecho' })).toBeEnabled());
    });

    test('si el servidor falla, avisa y el formulario conserva lo escrito', async () => {
      await montar(conSeguimiento());
      crmApi.actualizarOportunidad.mockRejectedValue(new Error('Sin permiso'));
      fireEvent.click(screen.getByRole('button', { name: 'Mañana' }));
      escribirNota('Otra nota');
      fireEvent.click(guardar());
      await waitFor(() => expect(notify).toHaveBeenCalledWith('No se pudo guardar el seguimiento: Sin permiso', { tipo: 'error' }));
      await waitFor(() => expect(guardar()).toBeEnabled());
      expect(fecha()).toHaveValue('2026-11-20');
      expect(nota()).toHaveValue('Otra nota');
      // Lo guardado sigue siendo lo de antes.
      expect(screen.getByText('Nota: Llamar a Ana')).toBeInTheDocument();
      expect(screen.getByText('Vencido hace 2 días')).toBeInTheDocument();
    });

    test('una oportunidad cerrada no muestra el formulario', async () => {
      await montar(copia(), { oportunidadId: 3 });
      expect(screen.getByText('Una oportunidad cerrada no lleva seguimiento.')).toBeInTheDocument();
      expect(screen.queryByLabelText('Fecha del próximo seguimiento')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Guardar seguimiento' })).not.toBeInTheDocument();
    });

    test('los campos ausentes (undefined) se tratan como sin seguimiento', async () => {
      const datos = copia();
      delete datos.oportunidades[0].proximo_seguimiento;
      delete datos.oportunidades[0].seguimiento_nota;
      await montar(datos);
      expect(screen.getByText('Sin seguimiento')).toBeInTheDocument();
      expect(guardar()).toBeDisabled();
    });
  });

  describe('etapa', () => {
    test('cambiar a otra etapa abierta mueve la oportunidad sin cerrar el panel', async () => {
      const { onCerrar } = await montar();
      fireEvent.change(screen.getByLabelText('Etapa de NAS sucursal Norte'), { target: { value: 'cotizada' } });
      await waitFor(() => expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'cotizada' }));
      expect(onCerrar).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'NAS sucursal Norte' })).toBeInTheDocument();
    });

    test('cambiar a Perdida pide el motivo en un diálogo encima y el panel sigue abierto', async () => {
      const { onCerrar } = await montar();
      fireEvent.change(screen.getByLabelText('Etapa de NAS sucursal Norte'), { target: { value: 'perdida' } });
      const perdida = await screen.findByRole('dialog', { name: 'Marcar como perdida' });
      expect(crmApi.actualizarOportunidad).not.toHaveBeenCalled();
      // Escape cierra solo el diálogo de pérdida.
      fireEvent.keyDown(perdida, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Marcar como perdida' })).not.toBeInTheDocument();
      expect(onCerrar).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'NAS sucursal Norte' })).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Etapa de NAS sucursal Norte'), { target: { value: 'perdida' } });
      const dialogoPerdida = await screen.findByRole('dialog', { name: 'Marcar como perdida' });
      fireEvent.change(within(dialogoPerdida).getByLabelText('Motivo de la pérdida'), { target: { value: 'Precio' } });
      fireEvent.click(within(dialogoPerdida).getByRole('button', { name: 'Marcar como perdida' }));
      await waitFor(() =>
        expect(crmApi.actualizarOportunidad).toHaveBeenCalledWith(1, { etapa: 'perdida', motivo_perdida: 'Precio' })
      );
      expect(onCerrar).not.toHaveBeenCalled();
    });

    test('al perder, el panel deja de ofrecer el seguimiento al instante', async () => {
      await montar(conSeguimiento());
      fireEvent.change(screen.getByLabelText('Etapa de NAS sucursal Norte'), { target: { value: 'ganada' } });
      expect(await screen.findByText('Una oportunidad cerrada no lleva seguimiento.')).toBeInTheDocument();
    });
  });

  test('las cotizaciones del fixture de otra oportunidad no se mezclan', async () => {
    const datos = copia();
    datos.cotizaciones.push(cotArbol({ id: 900, numero: 9999, oportunidad_id: 3 }));
    await montar(datos);
    expect(screen.queryByRole('button', { name: 'Abrir cotización 9999' })).not.toBeInTheDocument();
  });
});
