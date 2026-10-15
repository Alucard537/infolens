// Lector de QR en segundo plano (Web Worker) para no frenar la imagen de la cámara.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// Cargar el .wasm desde la propia app (no desde internet)
prepareZXingModule({
  overrides: {
    locateFile: (ruta, prefijo) => (ruta.endsWith('.wasm') ? wasmUrl : prefijo + ruta),
  },
});

const opciones = {
  formats: ['QRCode'],
  tryHarder: true,
  tryInvert: false,
  maxNumberOfSymbols: 8,
};

self.onmessage = async (e) => {
  const { id, ancho, alto, buffer } = e.data;
  try {
    const imagen = new ImageData(new Uint8ClampedArray(buffer), ancho, alto);
    const resultados = await readBarcodes(imagen, opciones);
    const qrs = resultados
      .filter((r) => r.isValid)
      .map((r) => {
        const p = r.position;
        return {
          texto: r.text,
          esquinas: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((q) => [q.x, q.y]),
        };
      });
    self.postMessage({ id, qrs });
  } catch (err) {
    self.postMessage({ id, qrs: [], error: String(err) });
  }
};
