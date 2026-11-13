// Para qué existe OrdenesComprasView: que escribir en una orden no vuelva a ejecutar
// CotizadorPage (miles de líneas, casi cien useState). Este test lo mide y queda de
// guardia: si alguien vuelve a subir el estado de órdenes al padre, falla.
import React from 'react';
import { screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', async () => (await import('./arnesOrdenes.testutil.jsx')).crearApiMock());

// Sonda: canManageCotizadorStock se llama en el cuerpo de CotizadorPage en cada render
// (para calcular isAdmin) y en ningún otro componente. Contar sus llamadas es contar
// renders de la página.
const sonda = vi.hoisted(() => ({ renders: 0 }));
vi.mock('../cotizador/cotizadorHelpers', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    canManageCotizadorStock: (...args) => {
      sonda.renders += 1;
      return real.canManageCotizadorStock(...args);
    }
  };
});

import {
  precalentar,
  prepararApi,
  renderApp,
  abrirDetalle,
  inputsDeLinea,
  escribir,
  botonBo
} from './arnesOrdenes.testutil.jsx';

beforeAll(precalentar, 30000);
beforeEach(() => {
  prepararApi();
});

describe('Órdenes: el estado de la vista no re-ejecuta la página', () => {
  it('escribir montos y datos del BO no vuelve a renderizar CotizadorPage', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'BO BO-1001' });
    abrirDetalle(0);
    await screen.findAllByText('MPN-A1');
    expect(sonda.renders).toBeGreaterThan(0); // la sonda funciona: la página se renderizó

    const antes = sonda.renders;
    escribir(inputsDeLinea('MPN-A1').intcomex, '1');
    escribir(inputsDeLinea('MPN-A1').intcomex, '12');
    escribir(inputsDeLinea('MPN-A1').intcomex, '123');
    escribir(inputsDeLinea('MPN-A1').axis, '99');
    escribir(screen.getAllByPlaceholderText('Nombre del proyecto')[0], 'Proyecto nuevo');
    expect(inputsDeLinea('MPN-A1').intcomex).toHaveValue(123);

    expect(sonda.renders).toBe(antes);
  });

  it('control: la búsqueda global sí vive en la página y sí la re-renderiza', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'BO BO-1001' });
    const antes = sonda.renders;
    escribir(screen.getByRole('textbox', { name: 'Buscar' }), 'acme');
    expect(botonBo('BO-1001')).toBeInTheDocument();
    // Si este control dejara de cumplirse, la sonda ya no mide lo que dice medir.
    expect(sonda.renders).toBeGreaterThan(antes);
  });
});
