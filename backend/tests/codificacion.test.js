/**
 * legacyRoutes.js debe seguir siendo UTF-8 limpio: sin mojibake (Ã³, Ã±...), sin
 * caracteres de reemplazo y sin "?" donde iba una tilde o una eñe.
 */
const fs = require('fs');
const path = require('path');

const ruta = path.join(__dirname, '..', 'src', 'routes', 'legacyRoutes.js');
const bytes = fs.readFileSync(ruta);
const texto = bytes.toString('utf8');

describe('codificacion de legacyRoutes.js', () => {
  test('es UTF-8 valido y sin caracteres de reemplazo', () => {
    expect(texto.includes('�')).toBe(false);
    expect(Buffer.from(texto, 'utf8').equals(bytes)).toBe(true);
  });

  test('no contiene secuencias de mojibake', () => {
    expect(texto).not.toMatch(/Ã[\u0080-¿ƒŒœ‘-›]|Â[\u0080-¿]|ï¿½/);
  });

  test('no hay "?" pegado a letras donde iba una tilde o eñe', () => {
    // Palabras con ? entre letras (excluye ?. y ?? del lenguaje y parametros de URL como ?forzar=1).
    const sospechosas = texto.split('\n').filter((l) => /[A-Za-z]\?{1,2}[A-Za-z]/.test(l) && !/\?\.|\?\?=?\s|\?\)|\?[A-Za-z_]+=/.test(l));
    expect(sospechosas).toEqual([]);
  });
});
