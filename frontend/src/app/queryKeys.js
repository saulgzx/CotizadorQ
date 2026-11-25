export const queryKeys = {
  productos: ['productos'],
  cotizaciones: ['cotizaciones'],
  usuarios: ['usuarios'],
  stock: ['stock'],
  stockCatalog: ['stock', 'catalog'],
  ordenes: ['ordenes'],
  oor: {
    todo: ['oor'],
    pendiente: ['oor', 'pendiente'],
    historial: ['oor', 'historial'],
    revision: (id) => ['oor', 'revision', id]
  },
  crm: {
    todo: ['crm'],
    embudo: ['crm', 'embudo'],
    arbol: ['crm', 'arbol'],
    oportunidades: ['crm', 'oportunidades'],
    empresas: (params) => ['crm', 'empresas', params],
    empresa: (id) => ['crm', 'empresa', id],
    duplicados: ['crm', 'duplicados'],
    seguimiento: ['crm', 'seguimiento'],
    seguimientoValor: ['crm', 'seguimiento', 'valor']
  }
};
