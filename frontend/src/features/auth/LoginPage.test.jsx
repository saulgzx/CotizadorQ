import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../cotizador/CotizadorPage', () => ({
  default: ({ routeView }) => <div data-testid="cotizador-page">{routeView}</div>
}));

import LoginPage from './LoginPage';

describe('LoginPage', () => {
  it('renderiza vista login', () => {
    render(<LoginPage />);
    expect(screen.getByTestId('cotizador-page')).toHaveTextContent('login');
  });
});
