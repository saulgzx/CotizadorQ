// Asistente IA: arma el prompt de un requerimiento y lo abre en la sesion
// personal del usuario (Claude, ChatGPT, Gemini...). CotizadorQ no llama a
// ninguna API de IA: el modelo corre en la cuenta del usuario, con sus tokens,
// sus proyectos, sus skills (preventa-axis / preventa-qnap) y su conector MyQuote.

export const MARCAS = {
  AXIS: {
    clave: 'AXIS',
    nombre: 'Axis',
    skill: 'preventa-axis',
    descripcion: 'Cámaras, analítica, audio, control de acceso y accesorios.'
  },
  QNAP: {
    clave: 'QNAP',
    nombre: 'QNAP',
    skill: 'preventa-qnap',
    descripcion: 'NAS, almacenamiento, backup, vigilancia y rackeo.'
  }
};

// `prefill`: el proveedor acepta el prompt en la URL (?q=). Los demas reciben
// el prompt por portapapeles.
export const PROVEEDORES = {
  claude: {
    clave: 'claude',
    nombre: 'Claude',
    urlNueva: 'https://claude.ai/new',
    prefill: (url) => /^https:\/\/claude\.ai\/new\/?(\?|$)/.test(url),
    ayudaProyecto:
      'Abre tu proyecto en claude.ai y copia la URL (claude.ai/project/…).',
    patronProyecto: /^https:\/\/claude\.ai\//
  },
  chatgpt: {
    clave: 'chatgpt',
    nombre: 'ChatGPT',
    urlNueva: 'https://chatgpt.com/',
    prefill: (url) =>
      /^https:\/\/chatgpt\.com\//.test(url) && !/\/c\/[^/?]+/.test(url),
    ayudaProyecto:
      'URL de tu GPT o proyecto (chatgpt.com/g/… o chatgpt.com/g/…/project).',
    patronProyecto: /^https:\/\/chatgpt\.com\//
  },
  gemini: {
    clave: 'gemini',
    nombre: 'Gemini',
    urlNueva: 'https://gemini.google.com/app',
    prefill: () => false,
    ayudaProyecto: 'URL de tu Gem (gemini.google.com/gem/…).',
    patronProyecto: /^https:\/\/gemini\.google\.com\//
  },
  otra: {
    clave: 'otra',
    nombre: 'Otra',
    urlNueva: '',
    prefill: () => false,
    ayudaProyecto: 'URL https de la IA que uses.',
    patronProyecto: /^https:\/\//
  }
};

// Mas alla de esto la URL se corta en algunos navegadores/proxies: se usa solo
// el portapapeles.
const MAX_LARGO_URL = 7000;

export const MARCADOR_LISTA = 'LISTA COTIZADORQ';

export const configVacia = () => ({
  proveedor: 'claude',
  proyectos: {
    claude: { AXIS: '', QNAP: '' },
    chatgpt: { AXIS: '', QNAP: '' },
    gemini: { AXIS: '', QNAP: '' },
    otra: { AXIS: '', QNAP: '' }
  },
  pedirLista: true
});

const claveStorage = (usuario) =>
  `mq.ia.config.${String(usuario || 'anon').toLowerCase()}`;

export const normalizarConfig = (cruda) => {
  const base = configVacia();
  if (!cruda || typeof cruda !== 'object') return base;
  const proveedor = PROVEEDORES[cruda.proveedor]
    ? cruda.proveedor
    : base.proveedor;
  const proyectos = { ...base.proyectos };
  for (const p of Object.keys(PROVEEDORES)) {
    for (const m of Object.keys(MARCAS)) {
      const url = cruda.proyectos?.[p]?.[m];
      proyectos[p] = {
        ...proyectos[p],
        [m]: typeof url === 'string' ? url.trim() : ''
      };
    }
  }
  return { proveedor, proyectos, pedirLista: cruda.pedirLista !== false };
};

export const cargarConfig = (usuario) => {
  try {
    return normalizarConfig(
      JSON.parse(localStorage.getItem(claveStorage(usuario)) || 'null')
    );
  } catch {
    return configVacia();
  }
};

export const guardarConfig = (usuario, config) => {
  try {
    localStorage.setItem(
      claveStorage(usuario),
      JSON.stringify(normalizarConfig(config))
    );
    return true;
  } catch {
    return false;
  }
};

// Solo https y del dominio del proveedor: la URL se abre en una pestaña nueva.
export const urlProyectoValida = (proveedor, url) => {
  const p = PROVEEDORES[proveedor];
  if (!p || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && p.patronProyecto.test(u.href);
  } catch {
    return false;
  }
};

export const construirPrompt = ({
  marca,
  requerimiento,
  cliente = '',
  contacto = '',
  notas = '',
  pedirLista = true
}) => {
  const m = MARCAS[marca] || MARCAS.AXIS;
  const lineas = [
    `Usa la skill ${m.skill} para responder este requerimiento ${m.nombre}.`,
    'Consulta precios, stock y plazos con el conector MyQuote (no uses precios de memoria).'
  ];
  const datos = [
    cliente && `Cliente: ${cliente.trim()}`,
    contacto && `Contacto: ${contacto.trim()}`
  ].filter(Boolean);
  if (datos.length) lineas.push('', ...datos);
  if (notas.trim())
    lineas.push('', 'Notas internas (no van en el correo):', notas.trim());
  lineas.push(
    '',
    'Requerimiento:',
    '"""',
    String(requerimiento || '').trim(),
    '"""'
  );
  if (pedirLista) {
    lineas.push(
      '',
      `Al final, después del bloque interno, agrega un bloque de código titulado ${MARCADOR_LISTA} con una línea por producto cotizado: SKU de Intcomex (o el MPN si el SKU es "To Create"), un tab y la cantidad. Sin encabezados ni precios.`
    );
  }
  return lineas.join('\n');
};

/**
 * Destino a abrir: el proyecto configurado para la marca o un chat nuevo.
 * Si el proveedor acepta prefill y el prompt cabe, va en ?q=.
 */
export const construirDestino = ({ proveedor, marca, config, prompt }) => {
  const p = PROVEEDORES[proveedor] || PROVEEDORES.claude;
  const proyecto = config?.proyectos?.[p.clave]?.[marca] || '';
  const usaProyecto = urlProyectoValida(p.clave, proyecto);
  const base = usaProyecto ? proyecto : p.urlNueva;
  if (!base) return { url: '', usaProyecto: false, prefill: false };
  if (p.prefill(base) && prompt) {
    const u = new URL(base);
    u.searchParams.set('q', prompt);
    if (u.href.length <= MAX_LARGO_URL)
      return { url: u.href, usaProyecto, prefill: true };
  }
  return { url: base, usaProyecto, prefill: false };
};

// ---------------------------------------------------------------------------
// Respuesta de la IA -> lista "codigo<TAB>cantidad" para PegarListaModal.

const limpiarCelda = (c) =>
  String(c ?? '')
    .replace(/\*\*|__|`/g, '')
    .trim();
const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const filasDeTabla = (texto) => {
  const filas = [];
  for (const cruda of String(texto || '').split(/\r?\n/)) {
    const linea = cruda.trim();
    if (linea.includes('|')) {
      const celdas = linea
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(limpiarCelda);
      if (celdas.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // separador markdown
      filas.push(celdas);
    } else if (linea.includes('\t')) {
      filas.push(linea.split('\t').map(limpiarCelda));
    } else {
      filas.push(null); // corta la tabla actual
    }
  }
  return filas;
};

const indiceColumna = (encabezado, patrones) =>
  encabezado.findIndex((c) => patrones.some((p) => p.test(sinAcentos(c))));

// Busca tablas con columnas de cantidad y SKU/MPN (el formato de las skills de preventa).
const listaDesdeTablas = (texto) => {
  const salida = [];
  let columnas = null;
  for (const fila of filasDeTabla(texto)) {
    if (!fila) {
      columnas = null;
      continue;
    }
    const cant = indiceColumna(fila, [
      /^cant\.?$/,
      /^cantidad$/,
      /^qty$/,
      /^unidades$/
    ]);
    const sku = indiceColumna(fila, [/^sku$/, /^codigo$/]);
    const mpn = indiceColumna(fila, [/^mpn$/, /^part ?number$/, /^p\/?n$/]);
    if (cant >= 0 && (sku >= 0 || mpn >= 0)) {
      columnas = { cant, sku, mpn };
      continue;
    }
    if (!columnas) continue;
    const cantidad = Number(
      String(fila[columnas.cant] || '').replace(/[^\d]/g, '')
    );
    const valorSku = columnas.sku >= 0 ? fila[columnas.sku] : '';
    const valorMpn = columnas.mpn >= 0 ? fila[columnas.mpn] : '';
    const codigo =
      valorSku && !/^to ?create$/i.test(valorSku) ? valorSku : valorMpn;
    if (!codigo || !cantidad) continue;
    salida.push(`${codigo}\t${cantidad}`);
  }
  return salida;
};

// Bloque explicito pedido en el prompt.
const listaDesdeBloque = (texto) => {
  const t = String(texto || '');
  const i = t.toUpperCase().indexOf(MARCADOR_LISTA);
  if (i < 0) return [];
  const resto = t.slice(i + MARCADOR_LISTA.length);
  const fence = resto.match(/```[^\n]*\n([\s\S]*?)```/);
  const cuerpo = fence
    ? fence[1]
    : resto
        .split(/\n\s*\n/)
        .slice(0, 2)
        .join('\n');
  return cuerpo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) => l && !/^```/.test(l) && !l.toUpperCase().includes(MARCADOR_LISTA)
    );
};

/**
 * Extrae los productos de la respuesta de la IA. Prioriza el bloque
 * LISTA COTIZADORQ, luego la tabla del preview y, si no hay ninguno,
 * devuelve el texto tal cual para que el parser de listas lo intente.
 */
export const extraerListaDeRespuesta = (texto) => {
  const bloque = listaDesdeBloque(texto);
  if (bloque.length) return { origen: 'bloque', texto: bloque.join('\n') };
  const tabla = listaDesdeTablas(texto);
  if (tabla.length) return { origen: 'tabla', texto: tabla.join('\n') };
  return { origen: 'texto', texto: String(texto || '').trim() };
};
