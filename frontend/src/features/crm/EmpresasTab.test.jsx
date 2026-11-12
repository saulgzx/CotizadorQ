import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import EmpresasTab from './EmpresasTab';
import FusionDuplicados from './FusionDuplicados';
import { EmpresaDialogo } from './DialogosCrm';
import { crmApi } from './crmApi';
import { renderConQuery } from './fixturesCrm';

vi.mock('./crmApi', () => ({
  crmApi: {
    listarEmpresas: vi.fn(),
    duplicadosEmpresas: vi.fn(),
    crearEmpresa: vi.fn(),
    actualizarEmpresa: vi.fn(),
    fusionarEmpresas: vi.fn()
  }
}));

const EMPRESAS = {
  items: [
    { id: 10, nombre: 'Sonda S.A.', rut: '83.628.100-4', contactos: 2, oportunidades_abiertas: 1, monto_abierto: 1500.5, ultima_cotizacion_en: '2026-11-01T10:00:00Z' }
  ],
  total: 1
};

describe('EmpresasTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crmApi.listarEmpresas.mockResolvedValue(EMPRESAS);
    crmApi.duplicadosEmpresas.mockResolvedValue({ grupos: [] });
  });

  test('lista las empresas con las columnas del contrato', async () => {
    renderConQuery(<EmpresasTab onAbrirEmpresa={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Sonda S.A.' })).toBeInTheDocument();
    expect(screen.getByText('83.628.100-4')).toBeInTheDocument();
    expect(screen.getByText('$1,500.50')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-11-01T10:00:00Z').toLocaleDateString('es-CL'))).toBeInTheDocument();
  });

  test('la búsqueda espera a que termines de escribir (debounce)', async () => {
    renderConQuery(<EmpresasTab onAbrirEmpresa={() => {}} />);
    await screen.findByRole('button', { name: 'Sonda S.A.' });
    crmApi.listarEmpresas.mockClear();

    const campo = screen.getByLabelText('Buscar empresas');
    fireEvent.change(campo, { target: { value: 's' } });
    fireEvent.change(campo, { target: { value: 'son' } });
    fireEvent.change(campo, { target: { value: 'sonda' } });
    expect(crmApi.listarEmpresas).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(crmApi.listarEmpresas).toHaveBeenCalledWith(expect.objectContaining({ q: 'sonda', offset: 0 }))
    );
    expect(crmApi.listarEmpresas).toHaveBeenCalledTimes(1);
  });

  test('avisa de posibles duplicados y lleva a revisarlos', async () => {
    crmApi.duplicadosEmpresas.mockResolvedValue({ grupos: [{ empresas: [{ id: 1, nombre: 'Sonda', cotizaciones: 2 }, { id: 2, nombre: 'Sonda SA', cotizaciones: 1 }], motivo: 'Nombres parecidos' }] });
    const onRevisar = vi.fn();
    renderConQuery(<EmpresasTab onAbrirEmpresa={() => {}} onRevisarDuplicados={onRevisar} />);
    expect(await screen.findByText(/posibles duplicados/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar duplicados' }));
    expect(onRevisar).toHaveBeenCalled();
  });

  test('muestra la paginación cuando hay más de una página', async () => {
    crmApi.listarEmpresas.mockResolvedValue({ ...EMPRESAS, total: 60 });
    renderConQuery(<EmpresasTab onAbrirEmpresa={() => {}} />);
    await screen.findByRole('button', { name: 'Sonda S.A.' });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(crmApi.listarEmpresas).toHaveBeenCalledWith(expect.objectContaining({ offset: 25 })));
  });
});

describe('EmpresaDialogo', () => {
  beforeEach(() => vi.clearAllMocks());

  test('al recibir 409 ofrece abrir la empresa existente', async () => {
    const error = Object.assign(new Error('Ya existe una empresa con ese nombre'), { status: 409, data: { empresa_id: 42 } });
    crmApi.crearEmpresa.mockRejectedValue(error);
    const onAbrir = vi.fn();
    const onCerrar = vi.fn();
    renderConQuery(<EmpresaDialogo onCerrar={onCerrar} onAbrirExistente={onAbrir} />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Sonda SA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una empresa con ese nombre');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir la existente' }));
    expect(onAbrir).toHaveBeenCalledWith(42);
    expect(crmApi.crearEmpresa).toHaveBeenCalledWith({ nombre: 'Sonda SA', rut: null, sitio: null, notas: null });
  });

  test('exige nombre y crea la empresa', async () => {
    crmApi.crearEmpresa.mockResolvedValue({ id: 9, nombre: 'Nueva' });
    const onGuardada = vi.fn();
    renderConQuery(<EmpresaDialogo onCerrar={() => {}} onGuardada={onGuardada} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El nombre es obligatorio');
    expect(crmApi.crearEmpresa).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));
    await waitFor(() => expect(onGuardada).toHaveBeenCalledWith({ id: 9, nombre: 'Nueva' }));
  });

  test('el foco queda dentro del diálogo y vuelve al botón que lo abrió', async () => {
    function Prueba() {
      const [abierto, setAbierto] = React.useState(false);
      return (
        <>
          <button onClick={() => setAbierto(true)}>Abrir</button>
          {abierto && <EmpresaDialogo onCerrar={() => setAbierto(false)} />}
        </>
      );
    }
    renderConQuery(<Prueba />);
    const boton = screen.getByRole('button', { name: 'Abrir' });
    boton.focus();
    fireEvent.click(boton);
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialogo, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(boton);
  });
});

describe('FusionDuplicados', () => {
  test('pide confirmación mostrando qué se mueve y luego fusiona', async () => {
    crmApi.duplicadosEmpresas.mockResolvedValue({
      grupos: [{ empresas: [{ id: 1, nombre: 'Sonda', cotizaciones: 5 }, { id: 2, nombre: 'Sonda SA', cotizaciones: 1 }], motivo: 'Nombres parecidos' }]
    });
    crmApi.fusionarEmpresas.mockResolvedValue({ empresa: { id: 1 }, movidos: { contactos: 2, oportunidades: 1, cotizaciones: 1 } });
    renderConQuery(<FusionDuplicados onVolver={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Fusionar «Sonda SA» en «Sonda»/ }));
    const dialogo = await screen.findByRole('dialog', { name: 'Confirmar fusión' });
    expect(dialogo).toHaveTextContent('contactos');
    expect(dialogo).toHaveTextContent('no se puede deshacer');
    expect(crmApi.fusionarEmpresas).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Fusionar empresas' }));
    await waitFor(() => expect(crmApi.fusionarEmpresas).toHaveBeenCalledWith(1, 2));
  });
});
