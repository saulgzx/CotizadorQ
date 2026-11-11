/**
 * CRM: funciones puras de normalizacion, mapeos y deteccion de duplicados.
 * No tocan la BD; todo lo de aca se prueba sin mocks.
 */

const ETAPAS = ['nueva', 'cotizada', 'negociacion', 'ganada', 'perdida'];
const ETAPAS_ABIERTAS = ['nueva', 'cotizada', 'negociacion'];
const ETAPAS_CERRADAS = ['ganada', 'perdida'];
const MARCAS = ['AXIS', 'QNAP', 'MIXTA'];

const MOTIVO_MIGRADO = 'Rechazada (migrado)';
const MOTIVO_COTIZADOR = 'Rechazada en el cotizador';

// Sufijos legales que se quitan al final del nombre (ya sin tildes ni puntuacion,
// como secuencias de palabras). "s p a" cubre "S.p.A.", que tras quitar los puntos
// queda en letras sueltas.
const SUFIJOS_LEGALES = [
  ['e', 'i', 'r', 'l'],
  ['s', 'a', 'c'],
  ['s', 'p', 'a'],
  ['s', 'a'],
  ['sa'],
  ['spa'],
  ['ltda'],
  ['limitada'],
  ['eirl'],
  ['inc'],
  ['llc'],
  ['y', 'cia'], // "Perez y Cia. Ltda." -> "perez"
  ['cia']
];

// Valores que la gente escribe cuando no hay dato: no son una empresa ni un contacto.
// Se comparan ya en texto plano (sin tildes ni puntuacion): 'N/A' -> 'n a'.
const VALORES_BASURA = new Set([
  'na',
  'n a',
  'no aplica',
  'sin empresa',
  'sin nombre',
  'sin dato',
  'sin datos',
  's n',
  'sn',
  'ninguna',
  'ninguno',
  'none',
  'null',
  'undefined',
  'nan',
  'x',
  'xx',
  'xxx',
  '0'
]);

const quitarTildes = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Minusculas, sin tildes, la puntuacion pasa a espacio y los espacios se colapsan. */
const textoPlano = (texto) =>
  quitarTildes(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** true si el valor no sirve como nombre (vacio, 'N/A', '-', solo puntuacion, etc.). */
const esValorBasura = (texto) => {
  if (texto === null || texto === undefined) return true;
  const plano = textoPlano(texto);
  return plano === '' || VALORES_BASURA.has(plano);
};

/**
 * Nombre normalizado de empresa (clave unica): minusculas, sin tildes ni puntuacion,
 * espacios colapsados y sin sufijos legales al final. Nunca deja el nombre vacio: si
 * todo el nombre es un sufijo ("S.A."), se conserva.
 */
const normalizarNombreEmpresa = (nombre) => {
  const palabras = textoPlano(nombre).split(' ').filter(Boolean);
  let quitado = true;
  while (quitado) {
    quitado = false;
    for (const sufijo of SUFIJOS_LEGALES) {
      if (palabras.length <= sufijo.length) continue;
      const cola = palabras.slice(palabras.length - sufijo.length);
      if (cola.every((p, i) => p === sufijo[i])) {
        palabras.length -= sufijo.length;
        quitado = true;
        break;
      }
    }
  }
  return palabras.join(' ');
};

/** Texto visible limpio: sin espacios de mas y recortado al largo de la columna. */
const limpiarTexto = (texto, max = 200) => {
  if (texto === null || texto === undefined) return null;
  const limpio = String(texto).replace(/\s+/g, ' ').trim();
  return limpio === '' ? null : limpio.slice(0, max);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Email en minusculas si parece un email; si no (vacio, 'N/A', 'PID-1'), null. */
const normalizarEmail = (email) => {
  const limpio = String(email ?? '')
    .trim()
    .toLowerCase();
  return EMAIL_RE.test(limpio) && limpio.length <= 200 ? limpio : null;
};

/** Marca de la oportunidad segun el origen de las lineas: AXIS, QNAP, MIXTA o null. */
const marcaDesdeOrigenes = (origenes) => {
  const marcas = new Set(
    (Array.isArray(origenes) ? origenes : [])
      .map((o) =>
        String(o ?? '')
          .trim()
          .toUpperCase()
      )
      .filter((o) => o === 'AXIS' || o === 'QNAP')
  );
  if (marcas.size === 0) return null;
  if (marcas.size > 1) return 'MIXTA';
  return [...marcas][0];
};

/** Combina la marca que ya tenia una oportunidad con la de una cotizacion nueva. */
const combinarMarcas = (actual, nueva) => {
  if (!actual) return nueva || null;
  if (!nueva || actual === nueva) return actual;
  return 'MIXTA';
};

/** Etapa que corresponde al estado de una cotizacion (migracion y enlace automatico). */
const etapaDesdeEstado = (estado) => {
  const valor = String(estado ?? '')
    .trim()
    .toLowerCase();
  if (valor === 'aprobada') return 'ganada';
  if (valor === 'rechazada') return 'perdida';
  return 'cotizada'; // revision, pendiente, enviada y cualquier otro
};

const esEtapaCerrada = (etapa) => ETAPAS_CERRADAS.includes(etapa);

/** Distancia de Levenshtein; corta en cuanto supera `maximo` (devuelve maximo + 1). */
const distanciaEdicion = (a, b, maximo = Infinity) => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maximo) return maximo + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const fila = [i];
    let minimoFila = i;
    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + costo);
      if (fila[j] < minimoFila) minimoFila = fila[j];
    }
    if (minimoFila > maximo) return maximo + 1;
    previa = fila;
  }
  return previa[b.length];
};

/** Distancia tolerada segun el largo del nombre mas corto (tope 2: con mas, nombres
 * largos distintos como "constructora alfa" y "constructora delta" se parecerian). */
const toleranciaPara = (largo) => {
  if (largo < 5) return 0;
  if (largo <= 10) return 1;
  return 2;
};

const numerosDe = (texto) => (texto.match(/\d+/g) || []).join(' ');

/** true si las palabras de `corto` aparecen seguidas dentro de `largo`. */
const contienePalabras = (largo, corto) => ` ${largo} `.includes(` ${corto} `);

/**
 * Compara dos nombres normalizados. Devuelve el motivo si parecen la misma empresa
 * ('igual', 'contiene' o 'parecido'), o null. Exige al menos 4 letras al nombre corto
 * para no agrupar siglas sueltas.
 */
const compararNombres = (a, b) => {
  if (!a || !b) return null;
  if (a === b) return 'igual';
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.replace(/ /g, '').length < 4) return null;
  if (contienePalabras(largo, corto)) return 'contiene';
  // Sin espacios: "inter sistemas" e "intersistemas" son el mismo nombre.
  if (corto.replace(/ /g, '') === largo.replace(/ /g, '')) return 'parecido';
  // Distinto numero = distinta empresa ("Colegio 1" / "Colegio 2", "Sucursal 75" / "76").
  if (numerosDe(corto) !== numerosDe(largo)) return null;
  const tolerancia = toleranciaPara(corto.length);
  if (tolerancia > 0 && distanciaEdicion(a, b, tolerancia) <= tolerancia)
    return 'parecido';
  return null;
};

const TEXTO_MOTIVO = {
  igual: 'Mismo nombre normalizado',
  contiene: 'Un nombre contiene al otro',
  parecido: 'Nombres casi iguales'
};

/**
 * Agrupa empresas que parecen la misma. Recibe [{ id, nombre, nombre_normalizado, ... }]
 * y devuelve [{ empresas: [...], motivo }] (solo grupos de 2 o mas). Cada grupo es una
 * empresa "semilla" (la primera en el orden recibido) con las que se le parecen
 * directamente: NO une en cadena (A~B y B~C no juntan A con C), para que una serie de
 * nombres parecidos no termine en un unico grupo gigante. El motivo es el del primer par.
 */
const agruparDuplicados = (empresas) => {
  const lista = Array.isArray(empresas) ? empresas : [];
  const claves = lista.map(
    (e) => e.nombre_normalizado || normalizarNombreEmpresa(e.nombre)
  );
  const asignada = new Array(lista.length).fill(false);
  const resultado = [];
  for (let i = 0; i < lista.length; i += 1) {
    if (asignada[i]) continue;
    const miembros = [lista[i]];
    let motivo = null;
    for (let j = i + 1; j < lista.length; j += 1) {
      if (asignada[j]) continue;
      const parecido = compararNombres(claves[i], claves[j]);
      if (!parecido) continue;
      asignada[j] = true;
      miembros.push(lista[j]);
      motivo = motivo || parecido;
    }
    if (miembros.length > 1) {
      asignada[i] = true;
      resultado.push({
        empresas: miembros,
        motivo: TEXTO_MOTIVO[motivo] || TEXTO_MOTIVO.parecido
      });
    }
  }
  return resultado;
};

module.exports = {
  ETAPAS,
  ETAPAS_ABIERTAS,
  ETAPAS_CERRADAS,
  MARCAS,
  MOTIVO_MIGRADO,
  MOTIVO_COTIZADOR,
  quitarTildes,
  textoPlano,
  esValorBasura,
  normalizarNombreEmpresa,
  limpiarTexto,
  normalizarEmail,
  marcaDesdeOrigenes,
  combinarMarcas,
  etapaDesdeEstado,
  esEtapaCerrada,
  distanciaEdicion,
  compararNombres,
  agruparDuplicados
};
