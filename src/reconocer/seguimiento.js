// Seguimiento visual del elemento reconocido sin QR.
// Al reconocerlo se guarda una "plantilla" (cómo se ve dentro del recuadro, en gris y pequeña).
// En cada fotograma se busca esa plantilla alrededor de donde estaba, también algo más grande o
// más pequeña (al acercarse o alejarse). Así la "i" y el modelo 3D siguen encima del elemento.
// Método: correlación cruzada normalizada (ZNCC), que aguanta cambios de luz.

const ANCHO_TRABAJO = 160; // la imagen se reduce a este ancho para que vaya rápido
const T = 32;              // la plantilla se guarda a 32×32
const RADIO = 12;          // búsqueda: ±12 píxeles (de la imagen reducida) por fotograma
const ESCALAS = [0.93, 1, 1.075];
const UMBRAL_OK = 0.55;    // por debajo: se ha perdido de vista
const UMBRAL_APRENDER = 0.8; // por encima: la plantilla se actualiza un poco (cambios de ángulo)
const PARTE_CENTRAL = 0.5;  // se sigue la mitad central del recuadro (así no se sale de la imagen al moverse)

export function crearSeguidor() {
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  let ancho = 0, alto = 0, k = 1;     // tamaño de trabajo y escala vídeo -> trabajo
  let gris = null;
  let plantilla = null;               // Float32Array T×T, media 0 y norma 1
  let x = 0, y = 0, lado0 = 0, escala = 1;
  const muestra = new Float32Array(T * T);

  function leerGris(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    k = ANCHO_TRABAJO / vw;
    ancho = ANCHO_TRABAJO; alto = Math.round(vh * k);
    if (lienzo.width !== ancho) lienzo.width = ancho;
    if (lienzo.height !== alto) lienzo.height = alto;
    ctx.drawImage(video, 0, 0, ancho, alto);
    const d = ctx.getImageData(0, 0, ancho, alto).data;
    if (!gris || gris.length !== ancho * alto) gris = new Float32Array(ancho * alto);
    for (let i = 0, j = 0; i < gris.length; i++, j += 4) gris[i] = d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114;
  }

  // Toma un cuadrado de lado "l" centrado en (cx, cy), lo reduce a T×T y lo normaliza.
  // Si un trozo se sale de la imagen se usa el borde más cercano; solo falla si el centro está fuera.
  function tomar(cx, cy, l, destino) {
    if (cx < 0 || cy < 0 || cx >= ancho || cy >= alto) return false;
    const paso = l / T, x0 = cx - l / 2, y0 = cy - l / 2;
    let suma = 0;
    for (let j = 0; j < T; j++) {
      const fila = Math.min(alto - 1, Math.max(0, Math.floor(y0 + (j + 0.5) * paso))) * ancho;
      for (let i = 0; i < T; i++) {
        const v = gris[fila + Math.min(ancho - 1, Math.max(0, Math.floor(x0 + (i + 0.5) * paso)))];
        destino[j * T + i] = v; suma += v;
      }
    }
    const media = suma / (T * T);
    let norma = 0;
    for (let i = 0; i < T * T; i++) { destino[i] -= media; norma += destino[i] * destino[i]; }
    norma = Math.sqrt(norma) || 1;
    for (let i = 0; i < T * T; i++) destino[i] /= norma;
    return true;
  }

  function parecido(cx, cy, l) {
    if (!tomar(cx, cy, l, muestra)) return -1;
    let s = 0;
    for (let i = 0; i < T * T; i++) s += muestra[i] * plantilla[i];
    return s;
  }

  return {
    /** Empieza a seguir lo que hay en el cuadrado central (ladoVideo = lado del recuadro en píxeles del vídeo). */
    iniciar(video, ladoVideo) {
      if (!video.videoWidth) return false;
      leerGris(video);
      x = ancho / 2; y = alto / 2; lado0 = ladoVideo * k * PARTE_CENTRAL; escala = 1;
      plantilla = new Float32Array(T * T);
      return tomar(x, y, lado0, plantilla);
    },
    /** Busca el elemento en el fotograma actual. Devuelve { ok, u, v (píxeles del vídeo), escala, puntuacion }. */
    paso(video) {
      if (!plantilla || !video.videoWidth) return { ok: false };
      leerGris(video);
      let mejor = { s: -2, x, y, e: escala };
      // Búsqueda gruesa (de 2 en 2) y luego fina (de 1 en 1) alrededor de lo mejor
      for (const f of ESCALAS) {
        const l = lado0 * escala * f;
        for (let dy = -RADIO; dy <= RADIO; dy += 2) {
          for (let dx = -RADIO; dx <= RADIO; dx += 2) {
            const s = parecido(x + dx, y + dy, l);
            if (s > mejor.s) mejor = { s, x: x + dx, y: y + dy, e: escala * f };
          }
        }
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const s = parecido(mejor.x + dx, mejor.y + dy, lado0 * mejor.e);
          if (s > mejor.s) mejor = { ...mejor, s, x: mejor.x + dx, y: mejor.y + dy };
        }
      }
      const ok = mejor.s >= UMBRAL_OK;
      if (ok) {
        x = mejor.x; y = mejor.y; escala = Math.max(0.4, Math.min(2.5, mejor.e));
        // Aprender poco a poco cómo se ve ahora (por si cambia el ángulo)
        if (mejor.s >= UMBRAL_APRENDER && tomar(x, y, lado0 * escala, muestra)) {
          let norma = 0;
          for (let i = 0; i < T * T; i++) { plantilla[i] = plantilla[i] * 0.9 + muestra[i] * 0.1; norma += plantilla[i] ** 2; }
          norma = Math.sqrt(norma) || 1;
          for (let i = 0; i < T * T; i++) plantilla[i] /= norma;
        }
      }
      return { ok, u: x / k, v: y / k, escala, puntuacion: mejor.s };
    },
    detener() { plantilla = null; },
  };
}
