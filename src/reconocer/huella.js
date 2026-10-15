// Reconocimiento sin QR (prueba): "huellas visuales" de imágenes con MediaPipe (MobileNet V3).
// Cada imagen se convierte en una lista de 1024 números que resume cómo es. Dos fotos del mismo
// sitio dan listas parecidas. Para reconocer, se compara lo que ve la cámara con las huellas guardadas.
import { ImageEmbedder } from '@mediapipe/tasks-vision';

import { MODELO, empaquetar, comparar } from './vectores.js';

export { MODELO, empaquetar, comparar };
const base = import.meta.env.BASE_URL;
let promesa = null;

/** Carga el modelo (la primera vez se descarga, unos 18 MB; después funciona sin internet). */
export function cargarReconocedor() {
  if (!promesa) {
    promesa = (async () => {
      const fileset = {
        wasmLoaderPath: base + 'mediapipe/vision_wasm_internal.js',
        wasmBinaryPath: base + 'mediapipe/vision_wasm_internal.wasm',
      };
      const opciones = (delegate) => ({
        baseOptions: { modelAssetPath: base + 'modelos/' + MODELO + '.tflite', delegate },
        runningMode: 'IMAGE',
        l2Normalize: true,
        quantize: false,
      });
      try {
        return await ImageEmbedder.createFromOptions(fileset, opciones('GPU'));
      } catch {
        return ImageEmbedder.createFromOptions(fileset, opciones('CPU'));
      }
    })();
    promesa.catch(() => { promesa = null; }); // si falla (p. ej. sin internet la 1ª vez), se reintenta
  }
  return promesa;
}

// Recorte cuadrado del centro de la imagen (lo que hay dentro del recuadro guía), a 256×256
const lienzo = document.createElement('canvas');
lienzo.width = lienzo.height = 256;
const ctx = lienzo.getContext('2d', { willReadFrequently: true });
export const PROPORCION_RECORTE = 0.7; // el recuadro ocupa el 70 % del lado corto

export function recortarCentro(fuente, ancho, alto) {
  const lado = Math.min(ancho, alto) * PROPORCION_RECORTE;
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

/** Huella de una imagen: Float32Array de longitud 1024, normalizada. */
export function huellaDe(embedder, fuente, ancho, alto) {
  const r = embedder.embed(recortarCentro(fuente, ancho, alto));
  return Float32Array.from(r.embeddings[0].floatEmbedding);
}

/** Saca imágenes repartidas de un vídeo (para crear la huella desde un vídeo grabado). */
export async function fotogramasDeVideo(archivo, cuantos, alFotograma) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const url = URL.createObjectURL(archivo);
  v.src = url;
  const esperar = (ev) => new Promise((ok, mal) => {
    const fin = () => { v.removeEventListener(ev, fin); v.removeEventListener('error', err); ok(); };
    const err = () => { v.removeEventListener(ev, fin); mal(new Error('No se puede leer este vídeo en este dispositivo.')); };
    v.addEventListener(ev, fin); v.addEventListener('error', err);
  });
  try {
    const cargado = esperar('loadeddata');
    v.load();
    try { await v.play(); v.pause(); } catch {}   // Safari solo carga el vídeo si se "reproduce"
    await cargado;
    const dur = v.duration;
    if (!Number.isFinite(dur) || dur <= 0) throw new Error('El vídeo no tiene duración válida.');
    for (let i = 0; i < cuantos; i++) {
      const visto = esperar('seeked');
      v.currentTime = Math.min(dur - 0.05, (dur * (i + 0.5)) / cuantos);
      await visto;
      await alFotograma(v, v.videoWidth, v.videoHeight, i);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
