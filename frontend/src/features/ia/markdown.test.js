import {
  markdownAHtml,
  markdownATexto,
  parsearMarkdown,
  separarPreview
} from './markdown';

const respuesta = [
  '## A — Preview para pegar',
  '',
  'Andrea.',
  '                Buen día, adjunto cotización solicitada.',
  '',
  '| Marca | Cant. | SKU |',
  '|---|---|---|',
  '| Axis | 2 | **100010879** |',
  '',
  'Quedo atento',
  '',
  '---',
  '## B — Control interno',
  '- Supuesto <script>',
  '',
  'LISTA COTIZADORQ',
  '```',
  '100010879\t2',
  '```'
].join('\n');

describe('markdown de la IA', () => {
  test('reconoce titulos, tablas, listas y bloques de codigo', () => {
    expect(parsearMarkdown(respuesta).map((b) => b.tipo)).toEqual([
      'titulo',
      'parrafo',
      'tabla',
      'parrafo',
      'separador',
      'titulo',
      'lista',
      'parrafo',
      'codigo'
    ]);
  });

  test('separa el preview del control interno', () => {
    const { preview, resto } = separarPreview(respuesta);
    expect(preview.startsWith('Andrea.')).toBe(true);
    expect(preview.endsWith('Quedo atento')).toBe(true);
    expect(resto.startsWith('## B')).toBe(true);
    expect(separarPreview('solo texto')).toEqual({
      preview: 'solo texto',
      resto: ''
    });
  });

  test('el HTML para Outlook escapa el contenido y conserva la tabla', () => {
    const html = markdownAHtml(respuesta);
    expect(html).toContain('<table');
    expect(html).toContain('<b>100010879</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(markdownATexto('| A | B |\n|---|---|\n| 1 | **2** |')).toBe(
      'A\tB\n1\t2'
    );
  });
});
