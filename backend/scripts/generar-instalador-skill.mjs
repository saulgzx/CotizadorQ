#!/usr/bin/env node
// Genera el MD instalador de cada skill de preventa, para pegarlo en Claude Code
// (o en cualquier agente) y que cree los archivos en ~/.claude/skills/.
//
// La fuente de verdad son las skills del repo (backend/src/ia/skills/), que es lo
// que el backend inyecta en el prompt. Este script solo las empaqueta y les suma
// INSTRUCCIONES.md y MEMORIA.md, que viven en docs/skills/ porque el backend no los
// lee (solo lee SKILL.md y references/*.md).
//
//   node backend/scripts/generar-instalador-skill.mjs
//
// Salida: docs/skills/instalador-preventa-axis.md y docs/skills/instalador-preventa-qnap.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const SKILLS = path.join(RAIZ, 'backend', 'src', 'ia', 'skills');
const DOCS = path.join(RAIZ, 'docs', 'skills');

const MARCAS = [
  {
    skill: 'preventa-axis',
    nombre: 'Axis',
    dominio: 'https://www.axis.com/',
    sku: 'P1475-LE',
    prueba: 'Cotiza 2 AXIS P1475-LE para exterior en poste, cliente Andrea',
    espera: 'montaje y alimentación resueltos (o explicados en una línea)'
  },
  {
    skill: 'preventa-qnap',
    nombre: 'QNAP',
    dominio: 'https://www.qnap.com/es-la',
    sku: 'TS-464-8G',
    prueba: 'Cotiza un TS-873AeU-4G para rack, cliente Andrea',
    espera: 'el kit de rieles resuelto (o explicado en una línea)'
  }
];

const leer = (p) => fs.readFileSync(p, 'utf8').replace(/\s+$/, '');

/** El backend no usa INSTRUCCIONES.md ni MEMORIA.md; en Claude Code sí. */
const preambulo = (nombre) =>
  `
Antes de empezar, lee \`INSTRUCCIONES.md\` y \`MEMORIA.md\` (o la sección Preventa
${nombre} de CLAUDE.md). Las reglas de MEMORIA.md son correcciones reales de Alexis y
mandan sobre esta skill cuando haya conflicto.
`.trim();

const ANCLA =
  'Nunca envíes nada en su nombre: todo queda como borrador para que él lo revise y lo\nmande.';

const conPreambulo = (skillMd, nombre) => {
  if (!skillMd.includes(ANCLA)) {
    throw new Error(
      `No encontré el ancla del preámbulo en la skill de ${nombre}`
    );
  }
  return skillMd.replace(ANCLA, `${ANCLA}\n\n${preambulo(nombre)}`);
};

// El contenido trae bloques ```; el instalador los envuelve en ~~~~.
const archivo = (n, titulo, cuerpo) =>
  `## ARCHIVO ${n} — ${titulo}\n\n~~~~markdown\n${cuerpo}\n~~~~\n`;

const generar = (m) => {
  const dir = path.join(SKILLS, m.skill);
  const refsDir = path.join(dir, 'references');
  const refs = fs
    .readdirSync(refsDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const partes = [
    `Vas a instalar en este servidor la skill completa "Preventa ${m.nombre}" de Alexis González (Product Manager Value, Intcomex Chile). Abajo van TODO el contenido y la estructura. Crea los archivos con el texto EXACTO que viene en cada bloque: no resumas, no reescribas, no "mejores" nada. Cuando termines, haz la verificación del final y repórtame el resultado.`,
    '',
    '## PASO 0 — Dónde guardar',
    '',
    '- Si eres Claude Code (o un agente basado en el Agent SDK que lee `~/.claude/`):',
    `  - Skill → \`~/.claude/skills/${m.skill}/\` (con su subcarpeta \`references/\`)`,
    `  - Instrucciones permanentes y memoria → \`~/.claude/CLAUDE.md\` (si ya existe, AGREGA al final una sección \`# Preventa ${m.nombre}\` con el contenido indicado; no borres lo que ya tenga)`,
    `- Si no eres Claude Code: crea \`./${m.skill}/\` en tu directorio de trabajo con la misma estructura, y configura tu system prompt para que cargue \`INSTRUCCIONES.md\` y \`MEMORIA.md\` al inicio de cada sesión.`,
    '',
    '**MEMORIA.md es la misma para Preventa Axis y Preventa QNAP.** Si ya instalaste la otra skill, MEMORIA.md ya está en tu CLAUDE.md: no la dupliques, solo verifica que esté y pasa al resto.',
    '',
    'Estructura final:',
    '',
    '```',
    `${m.skill}/`,
    '├── SKILL.md',
    '├── INSTRUCCIONES.md          (en Claude Code: va dentro de CLAUDE.md)',
    '├── MEMORIA.md                (en Claude Code: va dentro de CLAUDE.md)',
    '└── references/',
    ...refs.map((f, i) => `    ${i === refs.length - 1 ? '└──' : '├──'} ${f}`),
    '```',
    '',
    '---',
    ''
  ];

  let n = 1;
  partes.push(
    archivo(
      n++,
      'SKILL.md',
      conPreambulo(leer(path.join(dir, 'SKILL.md')), m.nombre)
    )
  );
  partes.push('---\n');
  for (const f of refs) {
    partes.push(archivo(n++, `references/${f}`, leer(path.join(refsDir, f))));
    partes.push('---\n');
  }
  partes.push(
    archivo(
      n++,
      'INSTRUCCIONES.md (rol y reglas de ingeniería)',
      leer(path.join(DOCS, `${m.skill}-INSTRUCCIONES.md`))
    )
  );
  partes.push('---\n');
  partes.push(
    archivo(
      n++,
      'MEMORIA.md (contexto y correcciones de Alexis — mandan sobre todo lo demás)',
      leer(path.join(DOCS, 'MEMORIA.md'))
    )
  );
  partes.push('---\n');

  partes.push(
    [
      '## VERIFICACIÓN (obligatoria)',
      '',
      '1. Lista la estructura creada y el tamaño de cada archivo. Ninguno puede estar vacío;',
      '   SKILL.md debe empezar con el bloque `---` del frontmatter.',
      '2. Confirma que tienes acceso al conector MyQuote: lista sus herramientas y ejecuta',
      `   \`consultar_producto({sku:"${m.sku}"})\`. Si no aparece, dime exactamente qué falta`,
      '   configurar (servidor MCP de MyQuote en tu config de MCP).',
      `3. Confirma que puedes abrir páginas de ${m.dominio} (WebFetch o equivalente).`,
      '   Si no puedes, dilo: sin eso no hay verificación técnica posible.',
      `4. Prueba en seco, sin enviar nada: "${m.prueba}". Debe salir: el preview con la tabla`,
      `   de 8 columnas encuadrada, ${m.espera}, y el bloque de control interno separado.`,
      '5. Comprueba que el preview NO trae párrafo técnico con specs, ni garantía, fichas o',
      '   links que nadie pidió, ni una fila de gama superior que no se pidió.',
      '6. Repórtame qué quedó OK y qué falló.',
      ''
    ].join('\n')
  );

  return partes.join('\n').replace(/\n{3,}/g, '\n\n');
};

/**
 * Vuelve a leer los bloques del instalador y los compara con su fuente. Si el
 * empaquetado alteró aunque sea un espacio, revienta acá y no en el agente.
 */
const verificar = (m, texto) => {
  const bloques = [
    ...texto.matchAll(
      /## ARCHIVO \d+ — (.+?)\n\n~~~~markdown\n([\s\S]*?)\n~~~~\n/g
    )
  ];
  const dir = path.join(SKILLS, m.skill);
  const esperados = new Map();
  esperados.set(
    'SKILL.md',
    conPreambulo(leer(path.join(dir, 'SKILL.md')), m.nombre)
  );
  for (const f of fs
    .readdirSync(path.join(dir, 'references'))
    .filter((f) => f.endsWith('.md'))) {
    esperados.set(`references/${f}`, leer(path.join(dir, 'references', f)));
  }
  esperados.set(
    'INSTRUCCIONES.md',
    leer(path.join(DOCS, `${m.skill}-INSTRUCCIONES.md`))
  );
  esperados.set('MEMORIA.md', leer(path.join(DOCS, 'MEMORIA.md')));

  if (bloques.length !== esperados.size) {
    throw new Error(
      `${m.skill}: ${bloques.length} bloques en el MD, ${esperados.size} archivos fuente`
    );
  }
  for (const [titulo, cuerpo] of bloques.map((b) => [b[1].trim(), b[2]])) {
    const clave = [...esperados.keys()].find((k) => titulo.startsWith(k));
    if (!clave) throw new Error(`${m.skill}: bloque inesperado "${titulo}"`);
    if (cuerpo !== esperados.get(clave)) {
      throw new Error(
        `${m.skill}: el bloque "${clave}" no coincide con su fuente`
      );
    }
    esperados.delete(clave);
  }
  if (esperados.size) {
    throw new Error(
      `${m.skill}: faltan bloques: ${[...esperados.keys()].join(', ')}`
    );
  }
};

fs.mkdirSync(DOCS, { recursive: true });
for (const m of MARCAS) {
  const destino = path.join(DOCS, `instalador-${m.skill}.md`);
  const texto = generar(m);
  verificar(m, texto);
  fs.writeFileSync(destino, texto);
  console.log(
    `${path.relative(RAIZ, destino)} — ${texto.split('\n').length} líneas, contenido verificado`
  );
}
