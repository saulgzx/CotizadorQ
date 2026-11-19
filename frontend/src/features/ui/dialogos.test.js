import { hayDialogoAbierto } from './dialogos';

describe('hayDialogoAbierto', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('sin diálogos no hay nada abierto', () => {
    expect(hayDialogoAbierto()).toBe(false);
  });

  test('un diálogo cerrado que sigue en la página (aria-hidden o inert) no cuenta', () => {
    document.body.innerHTML =
      '<div role="dialog" aria-hidden="true" inert="">índice</div><div role="dialog" inert="">otro</div>';
    expect(hayDialogoAbierto()).toBe(false);
  });

  test('un diálogo visible sí cuenta, aunque haya otro cerrado', () => {
    document.body.innerHTML = '<div role="dialog" aria-hidden="true" inert="">índice</div><div role="dialog">modal</div>';
    expect(hayDialogoAbierto()).toBe(true);
  });
});
