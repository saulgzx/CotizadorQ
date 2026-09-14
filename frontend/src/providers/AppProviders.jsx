import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { queryClient } from '../app/queryClient';
import { Toaster } from '../features/ui/toast';

export default function AppProviders({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {children}
        {/* Avisos globales: se ven en cualquier vista, incluidas login y vista cliente. */}
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
