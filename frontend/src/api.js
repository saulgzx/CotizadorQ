// URL del backend - usa proxy en prod; en local configura VITE_API_URL si aplica
const API_URL = import.meta.env.VITE_API_URL || '';

// Función helper para hacer peticiones autenticadas
const fetchWithAuth = async (endpoint, options = {}) => {
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
  
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.reload();
    throw new Error('Sesión expirada');
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
export const cotizacionesAPI = {
  getAll: async ({ includeItems } = {}) => {
    const query = includeItems ? '?includeItems=1' : '';
    const response = await fetchWithAuth(`/api/cotizaciones${query}`);
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
  updateEstado: async (id, estado) => {
    const response = await fetchWithAuth(`/api/cotizaciones/${encodeURIComponent(id)}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado }),
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
      throw new Error(`Error actualizando estado (${response.status})${detail ? `: ${detail}` : ''}`);
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
      throw new Error(`Error actualizando cotización (${response.status})${detail ? `: ${detail}` : ''}`);
    }
    return response.json();
  },
  getFunnel: async ({ days = 30, empresa = '', from = '', to = '' } = {}) => {
    const params = new URLSearchParams();
    if (days) params.set('days', String(days));
    if (empresa) params.set('empresa', empresa);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    const response = await fetchWithAuth(`/api/cotizaciones/funnel${query ? `?${query}` : ''}`);
    if (!response.ok) throw new Error('Error obteniendo funnel');
    return response.json();
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
  updateOwnPassword: async (password) => {
    const response = await fetchWithAuth('/api/usuarios/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error actualizando contraseña');
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
