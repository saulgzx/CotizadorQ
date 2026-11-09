// Markdown minimo para las respuestas de la IA: parrafos, titulos, listas,
// tablas, bloques de codigo, negrita y codigo en linea. Nunca se inyecta HTML
// de la respuesta: se arma un arbol que React pinta, o HTML escapado para
// copiar a Outlook.

const esFilaTabla = (l) => /^\s*\|.*\|\s*$/.test(l);
const esSeparador = (l) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const celdas = (l) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export const parsearMarkdown = (texto) => {
  const lineas = String(texto || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const bloques = [];
  let parrafo = [];
  const cerrarParrafo = () => {
    if (parrafo.length)
      bloques.push({ tipo: 'parrafo', texto: parrafo.join('\n') });
    parrafo = [];
  };

  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i];
    const fence = linea.match(/^\s*```(.*)$/);
    if (fence) {
      cerrarParrafo();
      const codigo = [];
      i += 1;
      while (i < lineas.length && !/^\s*```/.test(lineas[i]))
        codigo.push(lineas[i++]);
      bloques.push({
        tipo: 'codigo',
        lenguaje: fence[1].trim(),
        texto: codigo.join('\n')
      });
      continue;
    }
    if (
      esFilaTabla(linea) &&
      i + 1 < lineas.length &&
      esSeparador(lineas[i + 1])
    ) {
      cerrarParrafo();
      const encabezado = celdas(linea);
      const filas = [];
      i += 2;
      while (i < lineas.length && esFilaTabla(lineas[i]))
        filas.push(celdas(lineas[i++]));
      i -= 1;
      bloques.push({ tipo: 'tabla', encabezado, filas });
      continue;
    }
    const titulo = linea.match(/^\s*(#{1,6})\s+(.*)$/);
    if (titulo) {
      cerrarParrafo();
      bloques.push({
        tipo: 'titulo',
        nivel: titulo[1].length,
        texto: titulo[2].replace(/\s*#+\s*$/, '')
      });
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(linea)) {
      cerrarParrafo();
      bloques.push({ tipo: 'separador' });
      continue;
    }
    const item = linea.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      cerrarParrafo();
      const ordenada = /\d/.test(item[1]);
      const ultimo = bloques[bloques.length - 1];
      if (ultimo?.tipo === 'lista' && ultimo.ordenada === ordenada)
        ultimo.items.push(item[2]);
      else bloques.push({ tipo: 'lista', ordenada, items: [item[2]] });
      continue;
    }
    if (!linea.trim()) {
      cerrarParrafo();
      continue;
    }
    parrafo.push(linea);
  }
  cerrarParrafo();
  return bloques;
};

// Segmentos en linea: **negrita**, `codigo` y texto.
export const parsearEnLinea = (texto) => {
  const segmentos = [];
  const patron = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let ultimo = 0;
  let m;
  while ((m = patron.exec(texto))) {
    if (m.index > ultimo)
      segmentos.push({ tipo: 'texto', texto: texto.slice(ultimo, m.index) });
    segmentos.push(
      m[1] !== undefined
        ? { tipo: 'negrita', texto: m[1] }
        : { tipo: 'codigo', texto: m[2] }
    );
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length)
    segmentos.push({ tipo: 'texto', texto: texto.slice(ultimo) });
  return segmentos;
};

const escapar = (t) =>
  String(t).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]
  );

const enLineaHtml = (texto) =>
  parsearEnLinea(texto)
    .map((s) =>
      s.tipo === 'negrita'
        ? `<b>${escapar(s.texto)}</b>`
        : s.tipo === 'codigo'
          ? `<code>${escapar(s.texto)}</code>`
          : escapar(s.texto)
    )
    .join('')
    .replace(/\n/g, '<br>')
    .replace(/ {2}/g, '&nbsp; ');

const CELDA = 'border:1px solid #9ca3af;padding:4px 8px;vertical-align:top;';

/** HTML para pegar en Outlook: tablas con borde, sin clases ni scripts. */
export const markdownAHtml = (texto) =>
  parsearMarkdown(texto)
    .map((b) => {
      if (b.tipo === 'parrafo') return `<p>${enLineaHtml(b.texto)}</p>`;
      if (b.tipo === 'titulo') return `<p><b>${enLineaHtml(b.texto)}</b></p>`;
      if (b.tipo === 'separador') return '<hr>';
      if (b.tipo === 'codigo') return `<pre>${escapar(b.texto)}</pre>`;
      if (b.tipo === 'lista') {
        const tag = b.ordenada ? 'ol' : 'ul';
        return `<${tag}>${b.items.map((i) => `<li>${enLineaHtml(i)}</li>`).join('')}</${tag}>`;
      }
      const cab = b.encabezado
        .map(
          (c) =>
            `<th style="${CELDA}background:#f3f4f6;text-align:left;">${enLineaHtml(c)}</th>`
        )
        .join('');
      const filas = b.filas
        .map(
          (f) =>
            `<tr>${f.map((c) => `<td style="${CELDA}">${enLineaHtml(c)}</td>`).join('')}</tr>`
        )
        .join('');
      return `<table style="border-collapse:collapse;font-size:10pt;"><thead><tr>${cab}</tr></thead><tbody>${filas}</tbody></table>`;
    })
    .join('\n');

/** Texto plano equivalente (para el portapapeles cuando no se acepta HTML). */
export const markdownATexto = (texto) =>
  parsearMarkdown(texto)
    .map((b) => {
      const plano = (t) =>
        parsearEnLinea(t)
          .map((s) => s.texto)
          .join('');
      if (b.tipo === 'parrafo' || b.tipo === 'titulo') return plano(b.texto);
      if (b.tipo === 'separador') return '';
      if (b.tipo === 'codigo') return b.texto;
      if (b.tipo === 'lista')
        return b.items
          .map((i, n) => `${b.ordenada ? `${n + 1}.` : '-'} ${plano(i)}`)
          .join('\n');
      return [b.encabezado, ...b.filas]
        .map((f) => f.map(plano).join('\t'))
        .join('\n');
    })
    .join('\n\n');

/**
 * Separa la respuesta de la skill en el preview para pegar (A) y el resto
 * (control interno, lista). Si no encuentra las marcas, todo es preview.
 */
export const separarPreview = (texto) => {
  const t = String(texto || '');
  const lineas = t.split('\n');
  const esMarcaA = (l) => /^\s*(#+\s*|\*\*)?\s*A\s*[—–-]\s*Preview/i.test(l);
  const esMarcaB = (l) => /^\s*(#+\s*|\*\*)?\s*B\s*[—–-]\s*Control/i.test(l);
  const inicioA = lineas.findIndex(esMarcaA);
  const inicioB = lineas.findIndex(esMarcaB);
  if (inicioA < 0 && inicioB < 0) return { preview: t.trim(), resto: '' };
  const desde = inicioA >= 0 ? inicioA + 1 : 0;
  const hasta = inicioB > desde ? inicioB : lineas.length;
  const preview = lineas
    .slice(desde, hasta)
    .join('\n')
    .replace(/\n\s*(-{3,}|\*{3,})\s*$/, '')
    .trim();
  return { preview, resto: lineas.slice(hasta).join('\n').trim() };
};
