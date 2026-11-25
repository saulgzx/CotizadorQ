// Datos de ejemplo con la forma del contrato /api/oor/cambios (para los tests del pop-up).
const linea = (extra = {}) => ({
  clave: 'k1', orden: 'SO1', linea: 1, po: '575740', parte: '02317-004', descripcion: 'AXIS Q6225-LE',
  cantidad: 60, estado: 'Open', despacho: '2026-06-10', entregaPlan: null, eta: '2026-06-25', ...extra
});

export const crearCambios = () => ({
  hay: true,
  desde: { id: 10, tomado_en: '2026-11-20T12:00:00.000Z' },
  hasta: { id: 11, tomado_en: '2026-11-25T12:00:00.000Z' },
  resumen: {
    cambios: 6, atraso: 1, adelanto: 1, sin_fecha: 0, fecha_nueva: 0, cerrada: 1, cantidad: 1, nueva: 1,
    desaparecida: 1, bos: 3, bosAtrasadas: 1, bosConFacturacionAfectada: 1, lineasSinBo: 1
  },
  grupos: [
    {
      bo: '4978126', cliente: 'SICE', proyecto: 'Túnel Norte', poAxis: '575740', poCliente: 'OC-1', compartida: false,
      ultimoDespacho: { antes: '2026-01-15', ahora: '2026-06-10' },
      eta: { antes: '2026-01-30', ahora: '2026-06-25' },
      mes: { antes: '2026-01', ahora: '2026-06' },
      dias: 146,
      facturacion: { mes: '2026-02', semana: 2, afectada: true },
      lineas: [
        {
          tipo: 'atraso', dias: 146, cantidadAntes: null,
          linea: linea(),
          antes: linea({ despacho: '2026-01-15', eta: '2026-01-30' })
        },
        {
          tipo: 'cantidad', dias: null, cantidadAntes: 10,
          linea: linea({ clave: 'k2', parte: 'P-2', descripcion: 'Soporte pared', cantidad: 4 }),
          antes: linea({ clave: 'k2', parte: 'P-2', descripcion: 'Soporte pared', cantidad: 10 })
        }
      ]
    },
    {
      bo: '5000001', cliente: 'Metro', proyecto: '', poAxis: '600100', poCliente: null, compartida: true,
      ultimoDespacho: { antes: '2026-08-10', ahora: '2026-07-20' },
      eta: { antes: '2026-08-25', ahora: '2026-08-04' },
      mes: { antes: '2026-08', ahora: '2026-08' },
      dias: -9,
      facturacion: { mes: '2026-09', semana: null, afectada: false },
      lineas: [
        {
          tipo: 'adelanto', dias: -9, cantidadAntes: null,
          linea: linea({ clave: 'a1', parte: 'A-1', descripcion: 'Switch', cantidad: 2, despacho: '2026-07-20', eta: '2026-08-04' }),
          antes: linea({ clave: 'a1', parte: 'A-1', descripcion: 'Switch', cantidad: 2, despacho: '2026-07-29' })
        },
        {
          tipo: 'nueva', dias: null, cantidadAntes: null,
          linea: linea({ clave: 'n1', parte: 'N-1', descripcion: 'Cable', cantidad: 5, despacho: '2026-07-20', eta: '2026-08-04' }),
          antes: null
        }
      ]
    },
    {
      bo: '5000002', cliente: 'Aeropuerto', proyecto: 'T2', poAxis: '600200', poCliente: null, compartida: false,
      ultimoDespacho: { antes: '2026-12-01', ahora: null },
      eta: { antes: '2026-12-16', ahora: null },
      mes: { antes: '2026-12', ahora: null },
      dias: null,
      facturacion: { mes: null, semana: null, afectada: null },
      lineas: [
        {
          tipo: 'cerrada', dias: null, cantidadAntes: null,
          linea: linea({ clave: 'c1', parte: 'C-1', descripcion: 'Cámara', cantidad: 1, estado: 'Closed', despacho: null, eta: null }),
          antes: linea({ clave: 'c1', parte: 'C-1', descripcion: 'Cámara', cantidad: 1, despacho: '2026-12-01' })
        },
        {
          tipo: 'desaparecida', dias: null, cantidadAntes: null,
          linea: linea({ clave: 'd1', parte: 'D-1', descripcion: 'Licencia', cantidad: 3, despacho: '2026-12-01', eta: null }),
          antes: null
        }
      ]
    }
  ],
  sinBo: [
    {
      po: '999999',
      lineas: [
        {
          tipo: 'atraso', dias: 30, cantidadAntes: null,
          linea: linea({ clave: 's1', po: '999999', parte: 'S-1', descripcion: 'Midspan', cantidad: 8, despacho: '2026-09-30', eta: '2026-10-15' }),
          antes: linea({ clave: 's1', po: '999999', parte: 'S-1', descripcion: 'Midspan', cantidad: 8, despacho: '2026-08-31' })
        }
      ]
    }
  ],
  avisos: ['3 líneas del OOR traen una fecha que no se pudo leer.']
});
