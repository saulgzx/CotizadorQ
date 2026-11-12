import { fetchWithAuth } from '../../api';

// Cliente del CRM (contrato /api/crm). Los errores traen `status` y `data`
// (p. ej. un 409 de empresa duplicada trae data.empresa_id).

const pedir = async (endpoint, { method = 'GET', body, base = '/api/crm' } = {}) => {
  const response = await fetchWithAuth(`${base}${endpoint}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Error del CRM (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

const consulta = (params = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const texto = qs.toString();
  return texto ? `?${texto}` : '';
};

const id_ = encodeURIComponent;

export const crmApi = {
  // Empresas
  listarEmpresas: (params) => pedir(`/empresas${consulta(params)}`),
  crearEmpresa: (datos) => pedir('/empresas', { method: 'POST', body: datos }),
  obtenerEmpresa: (id) => pedir(`/empresas/${id_(id)}`),
  actualizarEmpresa: (id, datos) => pedir(`/empresas/${id_(id)}`, { method: 'PATCH', body: datos }),
  duplicadosEmpresas: () => pedir('/empresas/duplicados'),
  fusionarEmpresas: (id, origenId) =>
    pedir(`/empresas/${id_(id)}/fusionar`, { method: 'POST', body: { origen_id: origenId } }),
  // Contactos
  crearContacto: (datos) => pedir('/contactos', { method: 'POST', body: datos }),
  actualizarContacto: (id, datos) => pedir(`/contactos/${id_(id)}`, { method: 'PATCH', body: datos }),
  // Oportunidades
  listarOportunidades: (params) => pedir(`/oportunidades${consulta(params)}`),
  embudo: () => pedir('/embudo'),
  // Refleja las órdenes vigentes como oportunidades ganadas. Idempotente.
  sincronizarOrdenes: () => pedir('/oportunidades/sincronizar-ordenes', { method: 'POST' }),
  crearOportunidad: (datos) => pedir('/oportunidades', { method: 'POST', body: datos }),
  actualizarOportunidad: (id, datos) => pedir(`/oportunidades/${id_(id)}`, { method: 'PATCH', body: datos }),
  vincularCotizacion: (id, cotizacionId) =>
    pedir(`/oportunidades/${id_(id)}/cotizaciones`, { method: 'POST', body: { cotizacion_id: cotizacionId } })
};

// Seguimiento automático de cotizaciones (contrato /api/seguimiento, solo admin).
const seg = (endpoint, opciones) => pedir(endpoint, { ...opciones, base: '/api/seguimiento' });

export const seguimientoApi = {
  lista: () => seg('/lista'),
  valor: () => seg('/valor'),
  pausar: (oportunidadId) => seg(`/oportunidad/${id_(oportunidadId)}/pausar`, { method: 'POST' }),
  reanudar: (oportunidadId) => seg(`/oportunidad/${id_(oportunidadId)}/reanudar`, { method: 'POST' })
};
