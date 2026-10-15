// Cálculos de las huellas visuales (sin dependencias, para poder probarlos aparte).
//
// Una huella guarda, para cada imagen: su vector (1024 números en 1 byte cada uno + una escala),
// una miniatura JPEG pequeña (para poder verla y borrarla) y de qué grabación viene.
// { elementoId, modelo, dim, n, vectores: Int8Array(n·dim), escalas: Float32Array(n),
//   miniaturas: Uint8Array (JPEG seguidos), tamMini: Uint32Array(n), grupo: Uint16Array(n),
//   grabaciones: [{ fecha, origen }], fecha }
export const MODELO = 'mobilenet_v3_small';
export const MAX_IMAGENES = 400;

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

function unir(Tipo, a, b) {
  const r = new Tipo(a.length + b.length);
  r.set(a); r.set(b, a.length);
  return r;
}

/** Completa huellas antiguas (sin miniaturas ni grabaciones). */
export function normalizarHuella(h) {
  if (!h) return null;
  return {
    ...h,
    miniaturas: h.miniaturas || new Uint8Array(0),
    tamMini: h.tamMini || new Uint32Array(h.n),
    grupo: h.grupo || new Uint16Array(h.n),
    grabaciones: h.grabaciones && h.grabaciones.length ? h.grabaciones : [{ fecha: h.fecha || Date.now(), origen: 'anterior' }],
  };
}

/**
 * Añade imágenes nuevas a la huella (o la crea).
 * lista: [{ v: Float32Array, mini: Uint8Array }]; origen: 'cámara' | 'vídeo' | 'fotos'.
 */
export function anadirAHuella(huella, elementoId, lista, origen) {
  if (!lista.length) throw new Error('No hay imágenes nuevas.');
  const nuevo = empaquetar(lista.map((x) => x.v));
  const b = normalizarHuella(huella) || {
    elementoId, dim: nuevo.dim, n: 0, vectores: new Int8Array(0), escalas: new Float32Array(0),
    miniaturas: new Uint8Array(0), tamMini: new Uint32Array(0), grupo: new Uint16Array(0), grabaciones: [],
  };
  if (b.n && b.dim !== nuevo.dim) throw new Error('La huella guardada es de otra versión del reconocimiento. Bórrala y vuelve a grabar.');
  const g = b.grabaciones.length;
  const minis = lista.map((x) => x.mini || new Uint8Array(0));
  const todas = new Uint8Array(minis.reduce((s, m) => s + m.length, 0));
  let p = 0;
  for (const m of minis) { todas.set(m, p); p += m.length; }
  return {
    elementoId, modelo: MODELO, dim: nuevo.dim, n: b.n + nuevo.n,
    vectores: unir(Int8Array, b.vectores, nuevo.vectores),
    escalas: unir(Float32Array, b.escalas, nuevo.escalas),
    miniaturas: unir(Uint8Array, b.miniaturas, todas),
    tamMini: unir(Uint32Array, b.tamMini, Uint32Array.from(minis.map((m) => m.length))),
    grupo: unir(Uint16Array, b.grupo, new Uint16Array(nuevo.n).fill(g)),
    grabaciones: [...b.grabaciones, { fecha: Date.now(), origen }],
    fecha: Date.now(),
  };
}

/** Posición de cada miniatura dentro de "miniaturas". */
export function posicionesMini(h) {
  const pos = new Uint32Array(h.n);
  let p = 0;
  for (let i = 0; i < h.n; i++) { pos[i] = p; p += h.tamMini[i]; }
  return pos;
}

/** Quita las imágenes indicadas (Set de índices). Devuelve la huella nueva, o null si se queda vacía. */
export function quitarDeHuella(huella, indices) {
  const h = normalizarHuella(huella);
  const quedan = [];
  for (let i = 0; i < h.n; i++) if (!indices.has(i)) quedan.push(i);
  if (!quedan.length) return null;
  const pos = posicionesMini(h);
  const vectores = new Int8Array(quedan.length * h.dim);
  const escalas = new Float32Array(quedan.length);
  const tamMini = new Uint32Array(quedan.length);
  const grupo = new Uint16Array(quedan.length);
  const miniaturas = new Uint8Array(quedan.reduce((s, i) => s + h.tamMini[i], 0));
  // Renumerar las grabaciones que siguen teniendo imágenes
  const usados = [...new Set(quedan.map((i) => h.grupo[i]))].sort((a, b) => a - b);
  const nuevoGrupo = new Map(usados.map((g, k) => [g, k]));
  let p = 0;
  quedan.forEach((i, k) => {
    vectores.set(h.vectores.subarray(i * h.dim, (i + 1) * h.dim), k * h.dim);
    escalas[k] = h.escalas[i];
    tamMini[k] = h.tamMini[i];
    miniaturas.set(h.miniaturas.subarray(pos[i], pos[i] + h.tamMini[i]), p);
    p += h.tamMini[i];
    grupo[k] = nuevoGrupo.get(h.grupo[i]);
  });
  return {
    ...h, n: quedan.length, vectores, escalas, miniaturas, tamMini, grupo,
    grabaciones: usados.map((g) => h.grabaciones[g] || { fecha: Date.now(), origen: 'anterior' }),
    fecha: Date.now(),
  };
}

// ---------- para la copia .zip ----------

/** Partes binarias (en este orden) y datos para el índice. */
export function serializarHuella(huella) {
  const h = normalizarHuella(huella);
  return {
    partes: [h.vectores, h.escalas, h.tamMini, h.grupo, h.miniaturas],
    meta: { v: 2, modelo: h.modelo, dim: h.dim, n: h.n, fecha: h.fecha, grabaciones: h.grabaciones },
  };
}

export function deserializarHuella(buf, meta, elementoId) {
  const { n, dim } = meta;
  const tv = n * dim;
  if (!meta.v || meta.v < 2) {                     // formato antiguo: solo vectores y escalas
    if (buf.byteLength !== tv + n * 4) return null;
    return normalizarHuella({
      elementoId, modelo: meta.modelo, dim, n, fecha: meta.fecha,
      vectores: new Int8Array(buf.slice(0, tv)), escalas: new Float32Array(buf.slice(tv)),
    });
  }
  let p = 0;
  const tomar = (bytes) => { const r = buf.slice(p, p + bytes); p += bytes; return r; };
  if (buf.byteLength < tv + n * 10) return null;
  const vectores = new Int8Array(tomar(tv));
  const escalas = new Float32Array(tomar(n * 4));
  const tamMini = new Uint32Array(tomar(n * 4));
  const grupo = new Uint16Array(tomar(n * 2));
  const total = tamMini.reduce((s, x) => s + x, 0);
  if (buf.byteLength - p !== total) return null;
  const miniaturas = new Uint8Array(tomar(total));
  return {
    elementoId, modelo: meta.modelo, dim, n, fecha: meta.fecha, grabaciones: meta.grabaciones || [],
    vectores, escalas, miniaturas, tamMini, grupo,
  };
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
