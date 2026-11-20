// Reconocimiento sin QR (prueba): "huellas visuales" de imágenes con MediaPipe (MobileNet V3).
// Cada imagen se convierte en una lista de 1024 números que resume cómo es. Dos fotos del mismo
// sitio dan listas parecidas. Para reconocer, se compara lo que ve la cámara con las huellas guardadas.
import { ImageEmbedder } from '@mediapipe/tasks-vision';

import { MODELO } from './vectores.js';
import { archivosVision, recortarObjeto } from './recorte-objeto.js';

const base = import.meta.env.BASE_URL;
let promesa = null;

/** Carga el modelo (la primera vez se descarga, unos 18 MB; después funciona sin internet). */
export function cargarReconocedor() {
  if (!promesa) {
    promesa = (async () => {
      const opciones = (delegate) => ({
        baseOptions: { modelAssetPath: base + 'modelos/' + MODELO + '.tflite', delegate },
        runningMode: 'IMAGE',
        l2Normalize: true,
        quantize: false,
      });
      try {
        return await ImageEmbedder.createFromOptions(archivosVision, opciones('GPU'));
      } catch {
        return ImageEmbedder.createFromOptions(archivosVision, opciones('CPU'));
      }
    })();
    promesa.catch(() => { promesa = null; }); // si falla (p. ej. sin internet la 1ª vez), se reintenta
  }
  return promesa;
}

// Recorte cuadrado del centro de la imagen (lo que hay dentro del recuadro guía), a 256×256
const lienzo = document.createElement('canvas');
lienzo.width = lienzo.height = 256;
const ctx = lienzo.getContext('2d');
const LADO_MINI = 96;
const muestra = document.createElement('canvas');
muestra.width = muestra.height = LADO_MINI;
const ctxMuestra = muestra.getContext('2d', { willReadFrequently: true });
const grises = new Float32Array(LADO_MINI * LADO_MINI);
export const PROPORCION_RECORTE = 0.7; // el recuadro ocupa el 70 % del lado corto

export function recortarCentro(fuente, ancho, alto) {
  const lado = Math.min(ancho, alto) * PROPORCION_RECORTE;
  ctx.clearRect(0, 0, 256, 256);
  ctx.drawImage(fuente, (ancho - lado) / 2, (alto - lado) / 2, lado, lado, 0, 0, 256, 256);
  return lienzo;
}

/** Coloca el recuadro guía en pantalla justo sobre la zona que se recorta del vídeo. */
export function ajustarGuia(guia, video) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) { guia.hidden = true; return; }
  const W = window.innerWidth, H = window.innerHeight;
  const s = Math.max(W / vw, H / vh);   // el vídeo se ve recortado para llenar la pantalla
  const lado = Math.min(vw, vh) * PROPORCION_RECORTE * s;
  Object.assign(guia.style, {
    width: lado + 'px', height: lado + 'px', left: (W - lado) / 2 + 'px', top: (H - lado) / 2 + 'px',
  });
  guia.hidden = false;
}

function calidadDelRecorte(recorte) {
  ctxMuestra.clearRect(0, 0, LADO_MINI, LADO_MINI);
  ctxMuestra.drawImage(recorte, 0, 0, LADO_MINI, LADO_MINI);
  const { data } = ctxMuestra.getImageData(0, 0, LADO_MINI, LADO_MINI);
  let oscura = 0, clara = 0;
  for (let i = 0; i < grises.length; i++) {
    const j = i * 4;
    const luz = 0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2];
    grises[i] = luz;
    if (luz < 20) oscura++;
    if (luz > 247) clara++;
  }
  if (oscura / grises.length > 0.9) return 'Falta luz';
  if (clara / grises.length > 0.94) return 'Hay demasiado reflejo o luz';
  let detalle = 0;
  for (let y = 1; y < LADO_MINI - 1; y++) {
    for (let x = 1; x < LADO_MINI - 1; x++) {
      const i = y * LADO_MINI + x;
      const cambio = 4 * grises[i] - grises[i - 1] - grises[i + 1] - grises[i - LADO_MINI] - grises[i + LADO_MINI];
      detalle += cambio * cambio;
    }
  }
  return detalle / ((LADO_MINI - 2) ** 2) < 16 ? 'Imagen borrosa o con poco detalle' : '';
}

/** Evalúa el mismo encuadre para entrenar y para reconocer. */
export function huellaDe(embedder, fuente, ancho, alto, { segmentador, conRecuadro }) {
  const recorte = recortarCentro(fuente, ancho, alto);
  const motivo = calidadDelRecorte(recorte);
  if (motivo) return { motivo };
  const imagen = segmentador ? recortarObjeto(segmentador, recorte) : null;
  if (segmentador && !imagen) return { motivo: 'Pon el punto central sobre la pieza y deja visibles sus bordes' };
  const vector = (lienzo) => Float32Array.from(embedder.embed(lienzo).embeddings[0].floatEmbedding);
  return { imagen, objeto: imagen ? vector(imagen) : null, recuadro: conRecuadro ? vector(recorte) : null };
}

/** Añade una miniatura del encuadre aceptado para revisarlo en la galería. */
export function capturarImagen(embedder, segmentador, fuente, ancho, alto) {
  const { objeto: v, imagen, motivo } = huellaDe(embedder, fuente, ancho, alto, { segmentador, conRecuadro: false });
  if (motivo) return { motivo };
  ctxMuestra.drawImage(imagen, 0, 0, LADO_MINI, LADO_MINI);
  const mini = new Promise((ok) => muestra.toBlob(ok, 'image/jpeg', 0.6))
    .then(async (b) => b ? new Uint8Array(await b.arrayBuffer()) : new Uint8Array(0));
  return { v, mini };
}

/** Saca imágenes repartidas de un vídeo (para crear la huella desde un vídeo grabado). */
export async function fotogramasDeVideo(archivo, cuantos, alFotograma, signal) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const url = URL.createObjectURL(archivo);
  v.src = url;
  const esperar = (ev, iniciar) => new Promise((ok, mal) => {
    if (signal?.aborted) { mal(signal.reason); return; }
    const cerrar = () => {
      clearTimeout(limite);
      v.removeEventListener(ev, fin);
      v.removeEventListener('error', err);
      signal?.removeEventListener('abort', cancelar);
    };
    const fin = () => { cerrar(); ok(); };
    const err = () => { cerrar(); mal(new Error('No se puede leer este vídeo en este dispositivo.')); };
    const cancelar = () => { cerrar(); mal(signal.reason); };
    const limite = setTimeout(err, 8000);
    v.addEventListener(ev, fin);
    v.addEventListener('error', err);
    signal?.addEventListener('abort', cancelar, { once: true });
    try { iniciar(); } catch (e) { cerrar(); mal(e); }
  });
  try {
    await esperar('loadeddata', () => {
      v.load();
      v.play().then(() => v.pause()).catch(() => {});
    });
    const dur = v.duration;
    if (!Number.isFinite(dur) || dur <= 0) throw new Error('El vídeo no tiene duración válida.');
    const muestras = Math.min(cuantos, Math.max(1, Math.ceil(dur * 6)));
    for (let i = 0; i < muestras; i++) {
      if (signal?.aborted) throw signal.reason;
      const tiempo = dur * (i + 0.5) / muestras;
      if (v.currentTime !== tiempo) await esperar('seeked', () => { v.currentTime = tiempo; });
      await alFotograma(v, v.videoWidth, v.videoHeight, i, muestras);
    }
  } finally {
    v.pause();
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
