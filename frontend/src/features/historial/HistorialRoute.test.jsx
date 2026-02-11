import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../cotizador/CotizadorPage', () => ({
  default: ({ routeView }) => <div data-testid='cotizador-page'>{routeView}</div>
}));

import HistorialRoute from './HistorialRoute';

describe('HistorialRoute', () => {
  it('renderiza vista historial', () => {
    render(<HistorialRoute />);
    expect(screen.getByTestId('cotizador-page')).toHaveTextContent('historial');
  });
});
