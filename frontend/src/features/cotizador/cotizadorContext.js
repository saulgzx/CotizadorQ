import { createContext, useContext } from 'react';

// Context que expone el estado/handlers del Cotizador a las vistas extraídas,
// para poder cargarlas como chunks lazy sin prop-drilling masivo.
export const CotizadorContext = createContext(null);

export const useCotizador = () => {
  const ctx = useContext(CotizadorContext);
  if (!ctx) {
    throw new Error('useCotizador debe usarse dentro de <CotizadorContext.Provider>');
  }
  return ctx;
};
