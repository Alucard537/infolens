// Magic Touch localiza la pieza que está sobre el punto central del recuadro.
import { InteractiveSegmenterLegacy } from '@mediapipe/tasks-vision';
import { crearTareaVision, modeloVision } from './motor-vision.js';
import { aislarMascara } from './mascara-objeto.js';

let promesa;

export function cargarSegmentador() {
  if (!promesa) {
    // Modelo oficial de MediaPipe, Magic Touch float32 v1.
    // https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite
    promesa = crearTareaVision('el recorte de la pieza', (archivos) =>
      InteractiveSegmenterLegacy.createFromOptions(archivos, {
        baseOptions: { modelAssetPath: modeloVision('magic_touch'), delegate: 'CPU' },
        canvas: document.createElement('canvas'),
        outputConfidenceMasks: false,
        outputCategoryMask: true,
      }));
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
let cola = new Int32Array(0);
const APUNTA = 'Pon el punto central sobre la pieza';

/** Aísla la pieza y normaliza su escala con un fondo transparente para medir su calidad. */
export function recortarObjeto(segmentador, imagen) {
  let resultado = { motivo: APUNTA };
  segmentador.segment(imagen, { keypoint: { x: 0.5, y: 0.5 } }, ({ categoryMask }) => {
    if (!categoryMask) return;
    const { width, height } = categoryMask;
    const pixeles = categoryMask.getAsUint8Array();
    if (mascara.width !== width || mascara.height !== height) {
      mascara.width = width;
      mascara.height = height;
    }
    const alfa = ctxMascara.createImageData(width, height);
    if (cola.length < pixeles.length) cola = new Int32Array(pixeles.length);
    const componente = aislarMascara(pixeles, width, height, alfa.data, cola);
    if (!componente) return;
    const { izquierda, arriba, derecha, abajo, area } = componente;
    const alcance = Math.max((derecha - izquierda + 1) / width, (abajo - arriba + 1) / height);
    if (area < 0.012 * pixeles.length || alcance < 0.20) {
      resultado = { motivo: 'La pieza se ve pequeña. Acércate un poco' };
      return;
    }
    if (area > 0.92 * pixeles.length || izquierda <= 1 || derecha >= width - 2 || arriba <= 1 || abajo >= height - 2) {
      resultado = { motivo: 'Deja todos los bordes de la pieza dentro del recuadro' };
      return;
    }
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
    ctxSalida.clearRect(0, 0, lado, lado);
    ctxSalida.drawImage(aislada, x, y, w, h, (lado - ancho) / 2, (lado - alto) / 2, ancho, alto);
    resultado = { imagen: salida };
  });
  return resultado;
}
