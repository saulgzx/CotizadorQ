// Montos leidos de un Excel (el export de un proyecto aprobado en el portal
// de partners de Axis) -> filas { sku, mpn, descripcion, monto }.
//
// En un Excel los numeros ya estan en celdas: no hay nada que interpretar,
// asi que se lee en el navegador, exacto e instantaneo. Lo unico incierto
// son los encabezados (no sabemos como viene el export), y ahi esta todo el
// trabajo de este modulo.
//
// Este modulo solo EXTRAE: el monto sale tal cual viene de la celda. Quien
// lo normaliza y lo calza con las lineas de la orden es pantallazoMontos.

// Nombres que se buscan por campo, ya normalizados (minusculas, sin tildes,
// sin puntuacion). Primero se prueba la coincidencia exacta y despues que el
// encabezado CONTENGA al candidato como palabra(s) completa(s).
export const CANDIDATOS = {
  sku: [
    'sku', 'central sku', 'codigo', 'cod', 'code', 'item', 'articulo', 'part', 'numero de parte',
    'codigo de producto', 'codigo producto', 'product code'
  ],
  mpn: ['mpn', 'part number', 'partnumber', 'pn', 'axis part', 'manufacturer part', 'referencia'],
  descripcion: ['descripcion', 'description', 'producto', 'product', 'detalle', 'nombre'],
  monto: [
    'precio', 'price', 'net price', 'unit price', 'precio unitario', 'precio neto', 'monto',
    'importe', 'valor', 'costo', 'cost', 'total', 'subtotal'
  ]
};

// Falsos amigos: una columna de cantidad nunca es monto (ni producto).
const PALABRAS_CANTIDAD = ['cantidad', 'cant', 'qty', 'quantity', 'unidades', 'units'];
// Un total de linea solo se usa si no hay ningun precio por unidad.
const PALABRAS_TOTAL = ['total', 'subtotal', 'extended', 'ext'];
// Precio de lista: no es el precio acordado si hay otro precio al lado.
const PALABRAS_LISTA = ['lista', 'list', 'msrp', 'pvp', 'sugerido'];
const PALABRAS_UNITARIO = ['unitario', 'unit', 'unidad', 'neto', 'net'];

const FILAS_A_REVISAR = 30;
const CAMPOS_PRODUCTO = ['sku', 'mpn', 'descripcion'];

// "Precio Unit." / "PRECIO  UNITARIO" / "Descripción" -> "precio unit" / ...
const normalizarEncabezado = (valor) => {
  if (typeof valor !== 'string') return '';
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

const tienePalabra = (encabezado, palabras) => {
  const partes = encabezado.split(' ');
  return palabras.some((palabra) => partes.includes(palabra));
};

// El candidato aparece como palabra(s) completa(s), tolerando el plural de
// la ultima ("precios", "costs"). Por palabra completa para que "pn" no
// pegue con "pnl" ni "cod" con "codificacion".
const contiene = (encabezado, candidato) => {
  const relleno = ` ${encabezado} `;
  return relleno.includes(` ${candidato} `) || relleno.includes(` ${candidato}s `);
};

// Que tan bien pega un encabezado con un campo: 0 = nada. La coincidencia
// exacta le gana a cualquier "contiene", y entre dos "contiene" gana el
// candidato mas largo ("part number" de mpn le gana a "part" de sku).
const puntaje = (encabezado, campo) => {
  let mejor = 0;
  for (const candidato of CANDIDATOS[campo]) {
    if (encabezado === candidato) mejor = Math.max(mejor, 1000 + candidato.length);
    else if (contiene(encabezado, candidato)) mejor = Math.max(mejor, candidato.length);
  }
  return mejor;
};

// Preferencia entre varias columnas de monto: unitario/neto > precio a secas
// > precio de lista > total.
const nivelMonto = (encabezado) => {
  if (tienePalabra(encabezado, PALABRAS_TOTAL)) return 0;
  if (tienePalabra(encabezado, PALABRAS_LISTA)) return 1;
  if (tienePalabra(encabezado, PALABRAS_UNITARIO)) return 3;
  return 2;
};

// Columnas de UNA fila candidata a encabezado. Devuelve, por campo, el indice
// de la columna elegida (o -1).
const analizarFila = (fila) => {
  const indices = { sku: -1, mpn: -1, descripcion: -1, monto: -1 };
  const mejores = { sku: 0, mpn: 0, descripcion: 0, monto: -1 };
  if (!Array.isArray(fila)) return indices;

  fila.forEach((celda, indice) => {
    const encabezado = normalizarEncabezado(celda);
    if (!encabezado || tienePalabra(encabezado, PALABRAS_CANTIDAD)) return;

    // El monto manda: "Precio producto" es un precio, no un producto.
    if (puntaje(encabezado, 'monto') > 0) {
      const nivel = nivelMonto(encabezado);
      if (nivel > mejores.monto) {
        mejores.monto = nivel;
        indices.monto = indice;
      }
      return;
    }

    // Cada columna va a UN solo campo de producto: el que mejor le pega.
    let campoElegido = null;
    let puntajeElegido = 0;
    for (const campo of CAMPOS_PRODUCTO) {
      const valor = puntaje(encabezado, campo);
      if (valor > puntajeElegido) {
        puntajeElegido = valor;
        campoElegido = campo;
      }
    }
    // Con empate entre columnas se queda la de mas a la izquierda.
    if (campoElegido && puntajeElegido > mejores[campoElegido]) {
      mejores[campoElegido] = puntajeElegido;
      indices[campoElegido] = indice;
    }
  });
  return indices;
};

const textoDeEncabezado = (celda) => String(celda).replace(/\s+/g, ' ').trim();

const encabezadosDe = (fila) =>
  (Array.isArray(fila) ? fila : [])
    .filter((celda) => celda !== null && celda !== undefined && String(celda).trim() !== '')
    .map(textoDeEncabezado);

// Busca la fila de encabezados en una matriz cruda (sheet_to_json con
// header: 1). No lanza: si no hay fila valida devuelve indiceFila -1 y en
// `falta` que fue lo que no encontro ('monto' | 'producto' | 'encabezados'),
// con los encabezados de la fila que mas se parecia a una cabecera.
//
// Fila valida = la primera, dentro de las 30 primeras, con una columna de
// sku o mpn Y una de monto. Si ninguna la tiene, se acepta la primera con
// descripcion y monto.
export const encontrarEncabezados = (filas) => {
  const lista = Array.isArray(filas) ? filas.slice(0, FILAS_A_REVISAR) : [];
  const analizadas = lista.map((fila) => analizarFila(fila));

  const tieneCodigo = (i) => i.sku >= 0 || i.mpn >= 0;
  const tieneProducto = (i) => tieneCodigo(i) || i.descripcion >= 0;

  let indiceFila = analizadas.findIndex((i) => tieneCodigo(i) && i.monto >= 0);
  if (indiceFila < 0) indiceFila = analizadas.findIndex((i) => tieneProducto(i) && i.monto >= 0);

  if (indiceFila < 0) {
    // Para el mensaje de error: la fila que mas parecia una cabecera.
    let parecida = analizadas.findIndex((i) => tieneCodigo(i));
    if (parecida < 0) parecida = analizadas.findIndex((i) => tieneProducto(i));
    const falta = parecida >= 0 ? 'monto' : 'producto';
    if (parecida < 0) parecida = analizadas.findIndex((i) => i.monto >= 0);
    if (parecida < 0) {
      return { indiceFila: -1, columnas: null, indices: null, encabezados: [], falta: 'encabezados', montoEsTotal: false };
    }
    return { indiceFila: -1, columnas: null, indices: null, encabezados: encabezadosDe(lista[parecida]), falta, montoEsTotal: false };
  }

  const indices = analizadas[indiceFila];
  const fila = lista[indiceFila];
  const columnas = {};
  for (const campo of Object.keys(indices)) {
    columnas[campo] = indices[campo] >= 0 ? textoDeEncabezado(fila[indices[campo]]) : null;
  }
  return {
    indiceFila,
    columnas,
    indices,
    encabezados: encabezadosDe(fila),
    falta: null,
    montoEsTotal: nivelMonto(normalizarEncabezado(fila[indices.monto])) === 0
  };
};

// Texto de una celda de producto. Excel guarda "100015418" como numero: tiene
// que volver como texto, sin notacion cientifica ni decimales inventados.
const aTexto = (valor) => {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return '';
    // BigInt escribe todos los digitos; String() pasa a "1e+21" en enteros enormes.
    if (Number.isInteger(valor)) return BigInt(valor).toString();
    const texto = String(valor);
    return texto.includes('e') ? valor.toFixed(20).replace(/\.?0+$/, '') : texto;
  }
  return String(valor).trim();
};

const estaVacio = (valor) => valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');

const extraerFilas = (matriz, { indiceFila, indices }) => {
  const filas = [];
  let filasVacias = 0;
  const celda = (fila, campo) => (indices[campo] >= 0 ? fila[indices[campo]] : undefined);

  for (const fila of matriz.slice(indiceFila + 1)) {
    const cruda = Array.isArray(fila) ? fila : [];
    const sku = aTexto(celda(cruda, 'sku'));
    const mpn = aTexto(celda(cruda, 'mpn'));
    const descripcion = aTexto(celda(cruda, 'descripcion'));
    const monto = celda(cruda, 'monto');
    if ((!sku && !mpn && !descripcion) || estaVacio(monto)) {
      filasVacias += 1;
      continue;
    }
    // El monto va tal cual viene de la celda: numero o texto.
    filas.push({ sku, mpn, descripcion, monto: typeof monto === 'string' ? monto.trim() : monto });
  }
  return { filas, filasVacias };
};

const mensajeDeError = (hoja, { falta, encabezados }) => {
  const leidos = encabezados.length ? ` Encabezados leídos: ${encabezados.join(', ')}.` : '';
  if (falta === 'monto') {
    return `No encontré una columna de precio en la hoja "${hoja}".${leidos} Revisa que el Excel traiga una columna de precio (por ejemplo "Precio unitario", "Unit Price" o "Net Price").`;
  }
  if (falta === 'producto') {
    return `No encontré una columna de producto en la hoja "${hoja}".${leidos} Revisa que el Excel traiga una columna con el SKU, el MPN (Part Number) o la descripción.`;
  }
  return `No encontré los encabezados en la hoja "${hoja}": ninguna de las primeras ${FILAS_A_REVISAR} filas tiene una columna de producto (SKU, MPN o descripción) y una de precio. Revisa que sea el Excel del proyecto.`;
};

// Cuando ninguna hoja sirve se muestra el error mas util: el de la hoja que
// mas cerca estuvo de tener una tabla.
const PESO_FALTA = { monto: 2, producto: 1, encabezados: 0 };

// Lee los montos de un Excel. `file` es un File del navegador.
// Devuelve { filas, columnas, hoja, filasVacias, montoEsTotal }.
// Lanza un Error con un mensaje para mostrar tal cual si no hay tabla legible.
export const leerMontosDeExcel = async (file) => {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('No hay archivo Excel para leer.');

  // Carga diferida, igual que en CotizadorPage: SheetJS pesa y solo hace
  // falta cuando alguien sube un Excel.
  const XLSX = await import('xlsx');
  let libro;
  try {
    libro = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  } catch {
    throw new Error('No pude abrir el archivo. Revisa que sea un Excel (.xlsx o .xls) y que no esté dañado.');
  }
  const nombres = libro?.SheetNames || [];
  if (!nombres.length) throw new Error('El Excel no tiene ninguna hoja.');

  let mejorFallo = null;
  for (const hoja of nombres) {
    const matriz = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, defval: null, blankrows: true });
    const cabecera = encontrarEncabezados(matriz);
    if (cabecera.indiceFila >= 0) {
      const { filas, filasVacias } = extraerFilas(matriz, cabecera);
      return { filas, columnas: cabecera.columnas, hoja, filasVacias, montoEsTotal: cabecera.montoEsTotal };
    }
    if (!mejorFallo || PESO_FALTA[cabecera.falta] > PESO_FALTA[mejorFallo.cabecera.falta]) {
      mejorFallo = { hoja, cabecera };
    }
  }
  throw new Error(mensajeDeError(mejorFallo.hoja, mejorFallo.cabecera));
};
