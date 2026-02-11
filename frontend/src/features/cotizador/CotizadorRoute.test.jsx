import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('./CotizadorPage', () => ({
  default: ({ routeView }) => <div data-testid="cotizador-page">{routeView}</div>
}));

import CotizadorRoute from './CotizadorRoute';

describe('CotizadorRoute', () => {
  it('renderiza vista cotizador', () => {
    render(<CotizadorRoute />);
    expect(screen.getByTestId('cotizador-page')).toHaveTextContent('cotizador');
  });
});
