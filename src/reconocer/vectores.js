// Cálculos de las huellas visuales (sin dependencias, para poder probarlos aparte).
export const MODELO = 'mobilenet_v3_small';

// Para ocupar poco: cada número se guarda en 1 byte (con una escala por imagen)
export function empaquetar(lista) {
  const dim = lista[0].length;
  const vectores = new Int8Array(lista.length * dim);
  const escalas = new Float32Array(lista.length);
  lista.forEach((v, i) => {
    let max = 1e-9;
    for (const x of v) max = Math.max(max, Math.abs(x));
    const k = 127 / max;
    escalas[i] = max / 127;
    for (let j = 0; j < dim; j++) vectores[i * dim + j] = Math.round(v[j] * k);
  });
  return { modelo: MODELO, dim, n: lista.length, vectores, escalas };
}

/**
 * Compara una huella con las guardadas de cada elemento.
 * Devuelve [{ elementoId, parecido (0-1) }] de mayor a menor. Parecido = media de las 3 mejores imágenes.
 */
export function comparar(huella, guardadas) {
  const res = [];
  for (const h of guardadas) {
    if (h.dim !== huella.length) continue;
    const mejores = [-1, -1, -1];
    for (let i = 0; i < h.n; i++) {
      let s = 0;
      const o = i * h.dim;
      for (let j = 0; j < h.dim; j++) s += huella[j] * h.vectores[o + j];
      s *= h.escalas[i];
      if (s > mejores[2]) { mejores[2] = s; mejores.sort((a, b) => b - a); }
    }
    const validos = mejores.filter((x) => x > -1);
    res.push({ elementoId: h.elementoId, parecido: validos.reduce((a, b) => a + b, 0) / (validos.length || 1) });
  }
  return res.sort((a, b) => b.parecido - a.parecido);
}
