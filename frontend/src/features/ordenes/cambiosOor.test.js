import { describe, it, expect } from 'vitest';
import {
  mesLargo, mesCorto, fechaCorta, titularDeBo, textoDias, textoFacturacion,
  NOMBRE_TIPO, TONO_TIPO, filtrarGrupos, conteosDeFiltros, resumenEnTexto, textoCantidad, textoDespacho
} from './cambiosOor';
import { crearCambios } from './cambiosOor.testdata';

describe('formato de fechas', () => {
  it('mesLargo', () => {
    expect(mesLargo('2026-06')).toBe('junio de 2026');
    expect(mesLargo('2027-01')).toBe('enero de 2027');
    expect(mesLargo(null)).toBe('');
    expect(mesLargo('basura')).toBe('');
  });
  it('mesCorto omite el año si es el de referencia', () => {
    expect(mesCorto('2026-06', 2026)).toBe('junio');
    expect(mesCorto('2026-06', '2026')).toBe('junio');
    expect(mesCorto('2027-06', 2026)).toBe('junio de 2027');
    expect(mesCorto('2026-06')).toBe('junio de 2026');
    expect(mesCorto(null, 2026)).toBe('');
  });
  it('fechaCorta', () => {
    expect(fechaCorta('2026-06-10')).toBe('10-jun-2026');
    expect(fechaCorta('2026-12-01')).toBe('01-dic-2026');
    expect(fechaCorta(null)).toBe('');
    expect(fechaCorta('2026-13-01')).toBe('');
  });
});

describe('titularDeBo', () => {
  const g = (antes, ahora) => ({ mes: { antes, ahora } });
  it('el ejemplo del dueño: de enero a junio de 2026', () => {
    expect(titularDeBo(crearCambios().grupos[0])).toBe('De enero a junio de 2026');
  });
  it('cambio de año', () => {
    expect(titularDeBo(g('2026-12', '2027-03'))).toBe('De diciembre de 2026 a marzo de 2027');
  });
  it('sigue en el mismo mes', () => {
    expect(titularDeBo(g('2026-06', '2026-06'))).toBe('Sigue en junio de 2026');
  });
  it('sin fecha de entrega', () => {
    expect(titularDeBo(g('2026-06', null))).toBe('Sin fecha de entrega');
    expect(titularDeBo(g(null, null))).toBe('Sin fecha de entrega');
  });
  it('antes no tenía fecha', () => {
    expect(titularDeBo(g(null, '2026-06'))).toBe('Ahora en junio de 2026');
  });
  it('no revienta con datos incompletos', () => {
    expect(titularDeBo(undefined)).toBe('Sin fecha de entrega');
    expect(titularDeBo({})).toBe('Sin fecha de entrega');
  });
});

describe('textoDias', () => {
  it('signos y singular', () => {
    expect(textoDias(146)).toBe('+146 días');
    expect(textoDias(-9)).toBe('−9 días');
    expect(textoDias(1)).toBe('+1 día');
    expect(textoDias(-1)).toBe('−1 día');
    expect(textoDias(0)).toBe('');
    expect(textoDias(null)).toBe('');
    expect(textoDias(undefined)).toBe('');
  });
});

describe('textoFacturacion', () => {
  it('con semana', () => {
    expect(textoFacturacion({ mes: '2026-02', semana: 2 })).toBe('Facturación configurada: febrero de 2026, semana 2');
  });
  it('sin semana', () => {
    expect(textoFacturacion({ mes: '2026-02', semana: null })).toBe('Facturación configurada: febrero de 2026');
  });
  it('sin mes', () => {
    expect(textoFacturacion({ mes: null })).toBe('Sin mes de facturación configurado');
    expect(textoFacturacion(undefined)).toBe('Sin mes de facturación configurado');
  });
});

describe('tipos', () => {
  it('nombres y tonos', () => {
    expect(NOMBRE_TIPO.atraso).toBe('Atraso');
    expect(NOMBRE_TIPO.sin_fecha).toBe('Quedó sin fecha');
    expect(NOMBRE_TIPO.desaparecida).toBe('Ya no viene en el OOR');
    expect(TONO_TIPO).toMatchObject({
      atraso: 'critico', sin_fecha: 'critico', adelanto: 'ok', cerrada: 'ok',
      cantidad: 'aviso', desaparecida: 'aviso', nueva: 'info', fecha_nueva: 'info'
    });
    expect(Object.keys(TONO_TIPO).sort()).toEqual(Object.keys(NOMBRE_TIPO).sort());
  });
});

describe('filtros', () => {
  const datos = crearCambios();
  it('filtra por facturación, atraso y otros', () => {
    expect(filtrarGrupos(datos, '').map((g) => g.bo)).toEqual(['4978126', '5000001', '5000002']);
    expect(filtrarGrupos(datos, 'facturacion').map((g) => g.bo)).toEqual(['4978126']);
    expect(filtrarGrupos(datos, 'atraso').map((g) => g.bo)).toEqual(['4978126']);
    expect(filtrarGrupos(datos, 'otros').map((g) => g.bo)).toEqual(['5000001', '5000002']);
  });
  it('sin_fecha cuenta como atraso', () => {
    const d = { grupos: [{ bo: '1', lineas: [{ tipo: 'sin_fecha' }] }, { bo: '2', lineas: [{ tipo: 'adelanto' }] }] };
    expect(filtrarGrupos(d, 'atraso').map((g) => g.bo)).toEqual(['1']);
  });
  it('conteos', () => {
    expect(conteosDeFiltros(datos)).toEqual({ todo: 3, facturacion: 1, atraso: 1, otros: 2 });
  });
  it('tolera datos sin grupos', () => {
    expect(filtrarGrupos({}, 'atraso')).toEqual([]);
    expect(filtrarGrupos(null, '')).toEqual([]);
    expect(conteosDeFiltros(undefined)).toEqual({ todo: 0, facturacion: 0, atraso: 0, otros: 0 });
  });
});

describe('líneas', () => {
  it('textoCantidad', () => {
    expect(textoCantidad({ linea: { cantidad: 4 }, cantidadAntes: 10 })).toBe('10 → 4');
    expect(textoCantidad({ linea: { cantidad: 4 }, cantidadAntes: null })).toBe('4');
    expect(textoCantidad({ linea: { cantidad: 4 }, cantidadAntes: 4 })).toBe('4');
    expect(textoCantidad({})).toBe('');
  });
  it('textoDespacho', () => {
    const [atraso] = crearCambios().grupos[0].lineas;
    expect(textoDespacho(atraso)).toBe('15-ene-2026 → 10-jun-2026');
    expect(textoDespacho({ tipo: 'nueva', linea: { despacho: '2026-07-20' }, antes: null })).toBe('20-jul-2026');
    expect(textoDespacho({ tipo: 'sin_fecha', linea: { despacho: null }, antes: { despacho: '2026-07-20' } })).toBe('20-jul-2026 → Sin fecha');
  });
});

describe('resumenEnTexto', () => {
  it('arma el resumen completo', () => {
    const texto = resumenEnTexto(crearCambios());
    expect(texto).toBe([
      'Cambios del OOR (25-11-2026)',
      '3 BO con cambios · 1 atrasada · 1 con facturación afectada',
      '',
      'BO 4978126 · SICE · Túnel Norte (PO Axis 575740)',
      'De enero a junio de 2026 (+146 días). Llegada estimada: 25-jun-2026',
      'Facturación configurada: febrero de 2026, semana 2 — queda antes de la nueva llegada',
      '- 02317-004 AXIS Q6225-LE x60: 15-ene-2026 → 10-jun-2026 (+146 días)',
      '- P-2 Soporte pared x4: cantidad 10 → 4',
      '',
      'BO 5000001 · Metro (PO Axis 600100)',
      `Sigue en agosto de 2026 (−9 días). Llegada estimada: 04-ago-2026`,
      'Facturación configurada: septiembre de 2026 — sigue calzando',
      `- A-1 Switch x2: 29-jul-2026 → 20-jul-2026 (−9 días)`,
      '- N-1 Cable x5: línea nueva, despacho 20-jul-2026',
      '',
      'BO 5000002 · Aeropuerto · T2 (PO Axis 600200)',
      'Sin fecha de entrega',
      'Sin mes de facturación configurado',
      '- C-1 Cámara x1: facturada o cerrada',
      '- D-1 Licencia x3: ya no viene en el OOR',
      '',
      'Cambios de PO sin BO asociada',
      'PO Axis 999999',
      '- S-1 Midspan x8: 31-ago-2026 → 30-sep-2026 (+30 días)'
    ].join('\n'));
  });
  it('no revienta con datos incompletos', () => {
    expect(() => resumenEnTexto({})).not.toThrow();
    expect(() => resumenEnTexto(null)).not.toThrow();
    expect(() => resumenEnTexto({ grupos: [{ bo: '1' }], sinBo: [{ po: '2' }] })).not.toThrow();
    expect(resumenEnTexto({ grupos: [{ bo: '1' }] })).toContain('BO 1');
  });
});
