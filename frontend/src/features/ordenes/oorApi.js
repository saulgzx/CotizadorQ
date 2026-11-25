import { fetchWithAuth } from '../../api';

// Cliente de los cambios del OOR (contrato /api/oor/cambios, solo admin completo).
// Los errores traen `status` y `data`, igual que crmApi.

const pedir = async (endpoint, { method = 'GET', body, base = '/api/oor/cambios' } = {}) => {
  const response = await fetchWithAuth(`${base}${endpoint}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Error de los cambios del OOR (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

export const oorApi = {
  // { hay: false, motivo, revisar_en_seg? } o { hay: true, desde, hasta, resumen, grupos, sinBo, avisos }
  pendiente: () => pedir('/pendiente'),
  marcarVisto: (hastaId) => pedir('/visto', { method: 'POST', body: { hasta_id: hastaId } }),
  // Lee la pestaña OOR en ese momento y compara. Mismo contrato que pendiente, más `lineas`.
  actualizar: () => pedir('/actualizar', { method: 'POST', base: '/api/oor' }),
  historial: () => pedir('/historial'),
  revision: (id) => pedir(`/revisiones/${encodeURIComponent(id)}`)
};
