// Seguimiento con el entorno en segundo plano (Web Worker), para no frenar la cámara.
import { crearSeguidorEntorno } from './entorno.js';

const seguidor = crearSeguidorEntorno();

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.tipo === 'fotograma') {
      const r = seguidor.fotograma({ ...m, rgba: new Uint8ClampedArray(m.buffer) });
      self.postMessage({ tipo: 'pose', t: m.t, ...r });
    } else if (m.tipo === 'qr') {
      seguidor.poseQR(m.t, m.R, m.tv);
    } else if (m.tipo === 'reiniciar') {
      seguidor.reiniciar();
    }
  } catch (err) {
    self.postMessage({ tipo: 'pose', t: m.t, pose: null, puntos: 0, encajan: 0, error: String(err) });
  }
};
