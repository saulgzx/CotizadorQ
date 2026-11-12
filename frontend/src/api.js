// URL del backend - usa proxy en prod; en local configura VITE_API_URL si aplica
const API_URL = import.meta.env.VITE_API_URL || '';

const clearSessionAndRedirectToLogin = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.assign('/');
};

// Función helper para hacer peticiones autenticadas
export const fetchWithAuth = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  
  const sessionId = localStorage.getItem('sessionId');
  const deviceId = localStorage.getItem('deviceId');

  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  if (sessionId) {
    config.headers['X-Session-Id'] = sessionId;
  }
  if (deviceId) {
    config.headers['X-Device-Id'] = deviceId;
  }

  const response = await fetch(`${API_URL}${endpoint}`, config);
  
  if (response.status === 401) {
    clearSessionAndRedirectToLogin();
    throw new Error('Sesion expirada');
  }
  if (response.status === 403) {
    throw new Error('No tienes permisos para realizar esta accion');
  }

  return response;
};

// API de Autenticación
export const authAPI = {
  login: async (usuario, password) => {
    const sessionId = localStorage.getItem('sessionId');
    const deviceId = localStorage.getItem('deviceId');
    const response = await fetch(`${API_URL}/api/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
        ...(deviceId ? { 'X-Device-Id': deviceId } : {})
      },
      body: JSON.stringify({ usuario, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error de autenticaci??n');
    return data;
  },
  logout: async () => {
    const response = await fetchWithAuth('/api/logout', {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error cerrando sesion');
    }
    return response.json().catch(() => ({}));
  },
};

// API de Productos
export const productosAPI = {
  getAll: async () => {
    const response = await fetchWithAuth('/api/productos');
    if (!response.ok) throw new Error('Error obteniendo productos');
    return response.json();
  },

  create: async (producto) => {
    const response = await fetchWithAuth('/api/productos', {
      method: 'POST',
      body: JSON.stringify(producto),
    });
    if (!response.ok) throw new Error('Error creando producto');
    return response.json();
  },

  bulkCreate: async (productos, origen) => {
    const response = await fetchWithAuth('/api/productos/bulk', {
      method: 'POST',
      body: JSON.stringify({ productos, origen }),
    });
    if (!response.ok) throw new Error('Error importando productos');
    return response.json();
  },

  getSyncStatus: async () => {
    const response = await fetchWithAuth('/api/sync/status');
    if (!response.ok) throw new Error('Error obteniendo estado de sincronización');
    return response.json();
  },

  sync: async (origen) => {
    const query = origen ? `?origen=${encodeURIComponent(origen)}` : '';
    const response = await fetchWithAuth(`/api/productos/sync${query}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.detail || parsed?.message || text;
        } catch {
          detail = text;
        }
      }
      throw new Error(`Error sincronizando productos (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    return response.json();
  },

  update: async (id, producto) => {
    const response = await fetchWithAuth(`/api/productos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(producto),
    });
    if (!response.ok) throw new Error('Error actualizando producto');
    return response.json();
  },

  delete: async (id) => {
    const response = await fetchWithAuth(`/api/productos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.message || text;
        } catch {
          detail = text;
        }
      }
      throw new Error(`Error eliminando producto (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
};

// API de Cotizaciones
// Respuesta JSON o error con el mensaje del servidor (y `status`).
const leerJsonOError = async (response, porDefecto) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // "Payload invalido" solo no dice nada: se agrega el detalle que manda el servidor.
    const detalle = Array.isArray(data?.details) && data.details.length ? `: ${data.details.join('; ')}` : '';
    const base = data?.error || data?.message;
    const error = new Error(base ? `${base}${detalle}` : `${porDefecto} (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

export const LOTE_IDS_COTIZACIONES = 500;

// Envia ids enteros, sin repetir, en lotes de 500 y suma { cotizaciones, oportunidades }.
const enLotesDeIds = async (ids, endpoint, porDefecto) => {
  const limpios = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const total = { cotizaciones: 0, oportunidades: 0 };
  for (let i = 0; i < limpios.length; i += LOTE_IDS_COTIZACIONES) {
    const response = await fetchWithAuth(endpoint, {
      method: 'POST',
      body: JSON.stringify({ ids: limpios.slice(i, i + LOTE_IDS_COTIZACIONES) }),
    });
    const parte = await leerJsonOError(response, porDefecto);
    total.cotizaciones += Number(parte?.cotizaciones) || 0;
    total.oportunidades += Number(parte?.oportunidades) || 0;
  }
  return total;
};

export const cotizacionesAPI = {
  // Por defecto el backend excluye las archivadas; con `archivadas` trae SOLO las archivadas.
  getAll: async ({ includeItems, archivadas } = {}) => {
    const params = new URLSearchParams();
    if (includeItems) params.set('includeItems', '1');
    if (archivadas) params.set('archivadas', '1');
    const query = params.toString();
    const response = await fetchWithAuth(`/api/cotizaciones${query ? `?${query}` : ''}`);
    if (!response.ok) throw new Error('Error obteniendo cotizaciones');
    return response.json();
  },

  getOne: async (id) => {
    const response = await fetchWithAuth(`/api/cotizaciones/${id}`);
    if (!response.ok) throw new Error('Error obteniendo cotización');
    return response.json();
  },

  create: async (cotizacion) => {
    const response = await fetchWithAuth('/api/cotizaciones', {
      method: 'POST',
      body: JSON.stringify(cotizacion),
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.message || text;
        } catch {
          detail = text;
        }
      }
      throw new Error(`Error guardando cotizaci?n (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    return response.json();
  },
  delete: async (id) => {
    const response = await fetchWithAuth(`/api/cotizaciones/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.message || text;
        } catch {
          detail = text;
        }
      }
      throw new Error(`Error eliminando cotización (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
  // Cambia la etapa (nueva, cotizada, negociacion, ganada, perdida). "perdida" exige motivo.
  updateEstado: async (id, { etapa, motivo_perdida: motivo } = {}) => {
    const response = await fetchWithAuth(`/api/cotizaciones/${encodeURIComponent(id)}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ etapa, ...(etapa === 'perdida' ? { motivo_perdida: motivo } : {}) }),
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.message || text;
        } catch {
          detail = text;
        }
      }
      throw new Error(detail || `Error actualizando la etapa (${response.status})`);
    }
    return response.json();
  },
  update: async (id, payload) => {
    const response = await fetchWithAuth(`/api/cotizaciones/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.message || text;
        } catch {
          detail = text;
        }
      }
      const error = new Error(
        response.status === 409 && detail
          ? detail
          : `Error actualizando cotización (${response.status})${detail ? `: ${detail}` : ''}`
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  },
  getVersiones: async (id) => {
    const response = await fetchWithAuth(`/api/cotizaciones/${encodeURIComponent(id)}/versiones`);
    if (!response.ok) throw new Error('Error obteniendo versiones');
    return response.json();
  },
  getVersion: async (id, version) => {
    const response = await fetchWithAuth(
      `/api/cotizaciones/${encodeURIComponent(id)}/versiones/${encodeURIComponent(version)}`
    );
    if (!response.ok) throw new Error('Error obteniendo la versión');
    return response.json();
  },
  // Archiva (no borra) por ids o todo lo anterior a una fecha (YYYY-MM-DD).
  // Por ids se envia en lotes: el servidor acepta hasta 500 por llamada y "seleccionar
  // todo" puede traer miles. Se suman los conteos de cada lote.
  archivar: async ({ ids, antesDe } = {}) => {
    if (Array.isArray(ids)) return enLotesDeIds(ids, '/api/cotizaciones/archivar', 'Error archivando cotizaciones');
    const response = await fetchWithAuth('/api/cotizaciones/archivar', {
      method: 'POST',
      body: JSON.stringify({ antes_de: antesDe }),
    });
    return leerJsonOError(response, 'Error archivando cotizaciones');
  },
  previaArchivar: async (antesDe) => {
    const response = await fetchWithAuth(
      `/api/cotizaciones/archivar/previa?antes_de=${encodeURIComponent(antesDe)}`
    );
    return leerJsonOError(response, 'Error consultando qué se archivaría');
  },
  restaurar: async (ids) => enLotesDeIds(ids, '/api/cotizaciones/restaurar', 'Error restaurando cotizaciones'),
  downloadPdf: async (payload, filenameBase = 'cotizacion') => {
    const response = await fetchWithAuth('/api/cotizaciones/pdf', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.message || text;
        } catch {
          detail = text;
        }
      }
      throw new Error(`Error exportando PDF (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filenameBase}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
  openPdfPreview: async (payload, filenameBase = 'cotizacion') => {
    const win = window.open('about:blank', '_blank');
    const popupBlocked = !win;
    if (!popupBlocked) {
      win.document.title = 'Generando PDF...';
      win.document.body.style.fontFamily = 'Segoe UI, Arial, sans-serif';
      win.document.body.style.padding = '16px';
      win.document.body.textContent = 'Generando PDF...';
    }

    const response = await fetchWithAuth('/api/cotizaciones/pdf?disposition=inline', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
    if (!response.ok) {
      const text = await response.text();
      let detail = '';
      if (text) {
        try {
          const parsed = JSON.parse(text);
          detail = parsed?.error || parsed?.message || parsed?.detail || text;
        } catch {
          detail = text;
        }
      }
      if (!popupBlocked) win.close();
      throw new Error(`Error exportando PDF (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    if (popupBlocked) {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filenameBase}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      win.location.href = url;
      // Some browsers keep the transient about:blank tab. Close it and fallback to download.
      setTimeout(() => {
        try {
          if (win.closed) return;
          if (win.location.href === 'about:blank') {
            win.close();
            const link = document.createElement('a');
            link.href = url;
            link.download = `${filenameBase}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
          }
        } catch {
          // Ignore cross-origin access errors if the tab already navigated.
        }
      }, 1200);
    }
    // Keep blob URL alive briefly so the new tab can load it reliably.
    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  },
};

// API de Usuarios
export const usuariosAPI = {
  getAll: async () => {
    const response = await fetchWithAuth('/api/usuarios');
    if (!response.ok) throw new Error('Error obteniendo usuarios');
    return response.json();
  },

  create: async (payload) => {
    const response = await fetchWithAuth('/api/usuarios', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error creando usuario');
    }
    return response.json();
  },

  update: async (id, payload) => {
    const response = await fetchWithAuth(`/api/usuarios/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error actualizando usuario');
    }
    return response.json();
  },

  updatePassword: async (id, password) => {
    const response = await fetchWithAuth(`/api/usuarios/${encodeURIComponent(id)}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error actualizando contraseña');
    }
    return response.json();
  },
  updateOwnPassword: async (passwordActual, password) => {
    const response = await fetchWithAuth('/api/usuarios/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ password_actual: passwordActual, password }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error actualizando contraseña');
    }
    return response.json();
  },
  updateOwnPartnerCategory: async (partnerCategory) => {
    const response = await fetchWithAuth('/api/usuarios/me/partner-category', {
      method: 'PATCH',
      body: JSON.stringify({ partner_category: partnerCategory }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error actualizando categoria de partner');
    }
    return response.json();
  },

  setActivo: async (id, activo) => {
    const response = await fetchWithAuth(`/api/usuarios/${encodeURIComponent(id)}/activo`, {
      method: 'PATCH',
      body: JSON.stringify({ activo }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error cambiando el estado del usuario');
    }
    return response.json();
  },
  delete: async (id) => {
    const response = await fetchWithAuth(`/api/usuarios/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error eliminando usuario');
    }
    return response.json();
  },
};



// API de Sesiones
export const sesionesAPI = {
  getActive: async () => {
    const response = await fetchWithAuth('/api/sessions');
    if (!response.ok) throw new Error('Error obteniendo sesiones activas');
    return response.json();
  },
  getByUser: async (userId) => {
    const response = await fetchWithAuth(`/api/usuarios/${encodeURIComponent(userId)}/sessions`);
    if (!response.ok) throw new Error('Error obteniendo sesiones del usuario');
    return response.json();
  },
  getUserLogs: async (userId, limit = 100) => {
    const response = await fetchWithAuth(`/api/usuarios/${encodeURIComponent(userId)}/login-logs?limit=${limit}`);
    if (!response.ok) throw new Error('Error obteniendo logs del usuario');
    return response.json();
  },
  revoke: async (sessionId) => {
    const response = await fetchWithAuth(`/api/sessions/${encodeURIComponent(sessionId)}/revoke`, {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error revocando sesion');
    }
    return response.json().catch(() => ({}));
  },
  getConnections: async () => {
    const response = await fetchWithAuth('/api/security/connections');
    if (!response.ok) throw new Error('Error obteniendo mapa de conexiones');
    return response.json();
  }
};


// API de OSO
export const osoAPI = {
  getOrders: async () => {
    const response = await fetchWithAuth('/api/oso/orders');
    if (!response.ok) throw new Error('Error obteniendo ordenes OSO');
    return response.json();
  }
};

// API de BO Meta
export const boMetaAPI = {
  getAll: async () => {
    const response = await fetchWithAuth('/api/bo-meta');
    if (!response.ok) throw new Error('Error obteniendo BO meta');
    return response.json();
  },
  save: async (bo, payload) => {
    const response = await fetchWithAuth(`/api/bo-meta/${encodeURIComponent(bo)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error guardando BO meta');
    }
    return response.json();
  },
  remove: async (bo, comment) => {
    const response = await fetchWithAuth(`/api/bo-meta/${encodeURIComponent(bo)}/delete`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error eliminando BO');
    }
    return response.json();
  },
};

// API de BO Line Meta
export const boLineMetaAPI = {
  save: async (bo, payload) => {
    const response = await fetchWithAuth(`/api/bo-lines/${encodeURIComponent(bo)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error guardando montos Axis');
    }
    return response.json();
  },
};

// API de Stock
export const stockAPI = {
  getAll: async () => {
    const response = await fetchWithAuth('/api/stock');
    if (!response.ok) throw new Error('Error obteniendo stock');
    return response.json();
  },
  getCatalog: async () => {
    const response = await fetchWithAuth('/api/stock/catalog');
    if (!response.ok) throw new Error('Error obteniendo catálogo de stock');
    return response.json();
  },
};


// API del Asistente IA (solo admin). Las consultas corren en el backend y se
// consulta su avance hasta que terminan.
const leerError = async (response, porDefecto) => {
  const data = await response.json().catch(() => ({}));
  return new Error(data.error || porDefecto);
};

export const iaAPI = {
  estado: async () => {
    const response = await fetchWithAuth('/api/ia/estado');
    if (!response.ok) throw await leerError(response, 'Error consultando el asistente IA');
    return response.json();
  },
  iniciar: async ({ marca, mensajes }) => {
    const response = await fetchWithAuth('/api/ia/consultas', {
      method: 'POST',
      body: JSON.stringify({ marca, mensajes })
    });
    if (!response.ok) throw await leerError(response, 'No se pudo iniciar la consulta');
    return response.json();
  },
  obtener: async (id) => {
    const response = await fetchWithAuth(`/api/ia/consultas/${encodeURIComponent(id)}`);
    if (!response.ok) throw await leerError(response, 'No se pudo leer la consulta');
    return response.json();
  },
  cancelar: async (id) => {
    await fetchWithAuth(`/api/ia/consultas/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
};
