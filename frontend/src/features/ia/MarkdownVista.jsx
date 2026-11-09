import React from 'react';
import { parsearEnLinea, parsearMarkdown } from './markdown';

function EnLinea({ texto }) {
  return parsearEnLinea(texto).map((s, i) => {
    if (s.tipo === 'negrita') return <strong key={i}>{s.texto}</strong>;
    if (s.tipo === 'codigo')
      return (
        <code
          key={i}
          className="rounded bg-slate-100 px-1 font-mono text-[0.85em] dark:bg-slate-800"
        >
          {s.texto}
        </code>
      );
    return <React.Fragment key={i}>{s.texto}</React.Fragment>;
  });
}

/** Respuesta de la IA en Markdown, pintada sin HTML crudo. */
export default function MarkdownVista({ texto }) {
  const bloques = parsearMarkdown(texto);
  return (
    <div className="space-y-3 text-sm leading-6 text-slate-800 dark:text-slate-200">
      {bloques.map((b, i) => {
        if (b.tipo === 'parrafo')
          return (
            <p key={i} className="whitespace-pre-wrap">
              <EnLinea texto={b.texto} />
            </p>
          );
        if (b.tipo === 'titulo')
          return (
            <h4
              key={i}
              className={`font-semibold text-slate-900 dark:text-white ${b.nivel <= 2 ? 'pt-2 text-base' : 'text-sm'}`}
            >
              <EnLinea texto={b.texto} />
            </h4>
          );
        if (b.tipo === 'separador')
          return (
            <hr key={i} className="border-slate-200 dark:border-slate-700" />
          );
        if (b.tipo === 'codigo')
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-lg bg-slate-50 p-3 font-mono text-xs dark:bg-slate-950"
            >
              {b.lenguaje && (
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
                  {b.lenguaje}
                </div>
              )}
              {b.texto}
            </pre>
          );
        if (b.tipo === 'lista') {
          const Tag = b.ordenada ? 'ol' : 'ul';
          return (
            <Tag
              key={i}
              className={`space-y-1 pl-5 ${b.ordenada ? 'list-decimal' : 'list-disc'}`}
            >
              {b.items.map((item, j) => (
                <li key={j}>
                  <EnLinea texto={item} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <div
            key={i}
            className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700"
          >
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  {b.encabezado.map((c, j) => (
                    <th
                      key={j}
                      className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-slate-600 dark:text-slate-300"
                    >
                      <EnLinea texto={c} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.filas.map((f, j) => (
                  <tr
                    key={j}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    {f.map((c, k) => (
                      <td key={k} className="whitespace-nowrap px-2 py-1.5 align-top">
                        <EnLinea texto={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
