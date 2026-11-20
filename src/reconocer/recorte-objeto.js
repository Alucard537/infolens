// Magic Touch localiza la pieza que está sobre el punto central del recuadro.
import { InteractiveSegmenterLegacy } from '@mediapipe/tasks-vision';

const base = import.meta.env.BASE_URL;
export const archivosVision = {
  wasmLoaderPath: base + 'mediapipe/vision_wasm_internal.js',
  wasmBinaryPath: base + 'mediapipe/vision_wasm_internal.wasm',
};
let promesa;

export function cargarSegmentador() {
  if (!promesa) {
    // Modelo oficial de MediaPipe, Magic Touch float32 v1.
    // https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite
    promesa = InteractiveSegmenterLegacy.createFromOptions(archivosVision, {
      baseOptions: { modelAssetPath: base + 'modelos/magic_touch.tflite', delegate: 'CPU' },
      outputConfidenceMasks: false,
      outputCategoryMask: true,
    });
    promesa.catch(() => { promesa = null; });
  }
  return promesa;
}

const mascara = document.createElement('canvas');
const aislada = document.createElement('canvas');
const salida = document.createElement('canvas');
const ctxMascara = mascara.getContext('2d');
const ctxAislada = aislada.getContext('2d');
const ctxSalida = salida.getContext('2d');
const CATEGORIA_OBJETO = 0; // Magic Touch asigna 255 al fondo.

/** Normaliza la escala de la pieza aislada y rellena el fondo con un gris uniforme. */
export function recortarObjeto(segmentador, imagen) {
  let recorte = null;
  segmentador.segment(imagen, { keypoint: { x: 0.5, y: 0.5 } }, ({ categoryMask }) => {
    if (!categoryMask) return;
    const { width, height } = categoryMask;
    const pixeles = categoryMask.getAsUint8Array();
    if (pixeles[Math.floor(height / 2) * width + Math.floor(width / 2)] !== CATEGORIA_OBJETO) return;
    if (mascara.width !== width || mascara.height !== height) {
      mascara.width = width;
      mascara.height = height;
    }
    const alfa = ctxMascara.createImageData(width, height);
    let izquierda = width, arriba = height, derecha = 0, abajo = 0, area = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (pixeles[i] !== CATEGORIA_OBJETO) continue;
        alfa.data[i * 4 + 3] = 255;
        izquierda = Math.min(izquierda, x);
        derecha = Math.max(derecha, x);
        arriba = Math.min(arriba, y);
        abajo = Math.max(abajo, y);
        area++;
      }
    }
    const proporcion = area / pixeles.length;
    if (proporcion < 0.025 || proporcion > 0.92) return;
    if ((izquierda <= 1 && derecha >= width - 2) || (arriba <= 1 && abajo >= height - 2)) return;
    ctxMascara.putImageData(alfa, 0, 0);
    const lado = imagen.width;
    if (aislada.width !== lado || aislada.height !== lado) {
      aislada.width = aislada.height = salida.width = salida.height = lado;
    }
    ctxAislada.clearRect(0, 0, lado, lado);
    ctxAislada.drawImage(imagen, 0, 0);
    ctxAislada.globalCompositeOperation = 'destination-in';
    ctxAislada.drawImage(mascara, 0, 0, lado, lado);
    ctxAislada.globalCompositeOperation = 'source-over';

    const x = izquierda * lado / width, y = arriba * lado / height;
    const w = (derecha - izquierda + 1) * lado / width, h = (abajo - arriba + 1) * lado / height;
    const escala = 0.86 * lado / Math.max(w, h);
    const ancho = w * escala, alto = h * escala;
    ctxSalida.fillStyle = '#808080';
    ctxSalida.fillRect(0, 0, lado, lado);
    ctxSalida.drawImage(aislada, x, y, w, h, (lado - ancho) / 2, (lado - alto) / 2, ancho, alto);
    recorte = salida;
  });
  return recorte;
}
