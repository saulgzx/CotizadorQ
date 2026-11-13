import { etiquetaCompraOrigen } from './compraOrigen';

describe('etiquetaCompraOrigen', () => {
  test('sin quotes sigue la regla de siempre: Axis si alguna línea lo menciona, si no QNAP', () => {
    expect(etiquetaCompraOrigen([{ marca: 'AXIS', origen: 'AXIS' }])).toBe('Axis');
    expect(etiquetaCompraOrigen([{ marca: 'QNAP', origen: 'QNAP' }])).toBe('QNAP');
    expect(etiquetaCompraOrigen([])).toBe('QNAP');
    expect(etiquetaCompraOrigen(undefined)).toBe('QNAP');
  });

  test('una cotización solo de quotes dice el nombre del fabricante', () => {
    expect(etiquetaCompraOrigen([{ origen: 'ISS', marca: 'ISS' }, { origen: 'ISS', marca: 'ISS' }])).toBe('ISS');
    expect(etiquetaCompraOrigen([{ origen: 'NEURAL', marca: 'Neural Labs' }])).toBe('Neural Labs');
    // licencias y servidores de Milestone son el mismo fabricante
    expect(etiquetaCompraOrigen([{ origen: 'MILESTONE' }, { origen: 'MILESTONE_HW' }])).toBe('Milestone');
  });

  test('Velasea se nombra como fabricante, sola o en una mixta', () => {
    expect(etiquetaCompraOrigen([{ origen: 'VELASEA', marca: 'Velasea' }])).toBe('Velasea');
    expect(etiquetaCompraOrigen([{ origen: 'VAIDIO', marca: 'Vaidio' }])).toBe('Vaidio');
    expect(etiquetaCompraOrigen([{ origen: 'QNAP' }, { origen: 'velasea' }])).toBe('QNAP / Velasea');
  });

  test('varios fabricantes de quote se listan todos', () => {
    expect(etiquetaCompraOrigen([{ origen: 'ISS' }, { origen: 'MILESTONE' }])).toBe('ISS / Milestone');
  });

  test('una descripción de quote que menciona Axis no lo rotula como Axis', () => {
    expect(etiquetaCompraOrigen([{ origen: 'ISS', descripcion: 'Licencia para cámaras Axis' }])).toBe('ISS');
  });

  test('una cotización mixta nombra la marca de lista y además al fabricante del quote', () => {
    expect(etiquetaCompraOrigen([{ origen: 'QNAP', marca: 'QNAP' }, { origen: 'ISS', marca: 'ISS' }])).toBe('QNAP / ISS');
    expect(etiquetaCompraOrigen([{ origen: 'AXIS', marca: 'AXIS' }, { origen: 'ISS', marca: 'ISS' }])).toBe('Axis / ISS');
    expect(
      etiquetaCompraOrigen([{ origen: 'QNAP' }, { origen: 'MILESTONE' }, { origen: 'MILESTONE_HW' }, { origen: 'neural' }])
    ).toBe('QNAP / Milestone / Neural Labs');
  });

  test('en una mixta, la palabra Axis en una línea de quote no convierte la compra en Axis', () => {
    expect(
      etiquetaCompraOrigen([{ origen: 'QNAP', marca: 'QNAP' }, { origen: 'MILESTONE', descripcion: 'Device license for Axis cameras' }])
    ).toBe('QNAP / Milestone');
  });
});
