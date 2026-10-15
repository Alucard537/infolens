// Conversión de archivos CAD (STEP / IGES) a .glb en segundo plano, con OpenCascade (occt-import-js).
import occtimportjs from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import { crearGlb } from './glb.js';

let occt = null;
const MAX_TRIANGULOS = 150_000; // por encima, el móvil iría lento: se simplifica la malla

self.onmessage = async (e) => {
  const { formato, buffer, nombre } = e.data;
  try {
    if (!occt) {
      // Descargamos nosotros el .wasm (con fetch) y se lo pasamos ya cargado
      const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
      occt = await occtimportjs({ wasmBinary, locateFile: (r) => (r.endsWith('.wasm') ? wasmUrl : r) });
    }
    const datos = new Uint8Array(buffer);
    // Probar con calidad alta y, si sale demasiado pesado, con menos detalle
    let ultimo = null;
    for (const desviacion of [0.002, 0.005, 0.01, 0.02, 0.04]) {
      const r = occt.ReadFile(formato, datos, {
        linearUnit: 'millimeter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: desviacion,
        angularDeflection: 0.5,
      });
      if (!r || !r.success) throw new Error('No se pudo leer el archivo (puede estar dañado o no ser ' + formato.toUpperCase() + ').');
      const salida = crearGlb(r, nombre);
      ultimo = salida;
      if (salida.triangulos <= MAX_TRIANGULOS) break;
    }
    self.postMessage({ ok: true, glb: ultimo.glb, triangulos: ultimo.triangulos }, [ultimo.glb]);
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
