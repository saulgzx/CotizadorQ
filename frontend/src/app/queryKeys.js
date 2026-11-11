export const queryKeys = {
  productos: ['productos'],
  cotizaciones: ['cotizaciones'],
  usuarios: ['usuarios'],
  stock: ['stock'],
  stockCatalog: ['stock', 'catalog'],
  ordenes: ['ordenes'],
  crm: {
    todo: ['crm'],
    embudo: ['crm', 'embudo'],
    oportunidades: ['crm', 'oportunidades'],
    empresas: (params) => ['crm', 'empresas', params],
    empresa: (id) => ['crm', 'empresa', id],
    duplicados: ['crm', 'duplicados']
  }
};
