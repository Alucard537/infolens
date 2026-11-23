import { FilesetResolver } from '@mediapipe/tasks-vision';

const base = new URL(import.meta.env.BASE_URL, document.baseURI);
const carpetaVision = new URL('mediapipe', base).href;
let archivosVision;

export const modeloVision = (nombre) => new URL(`modelos/${nombre}.tflite`, base).href;

export async function crearTareaVision(nombre, iniciar) {
  try {
    archivosVision ??= FilesetResolver.forVisionTasks(carpetaVision);
    const archivos = await archivosVision;
    try {
      return await iniciar(archivos);
    } catch (error) {
      // MediaPipe comunica los fallos de <script> como Event. Vuelve a leer el
      // cargador local y conserva la URL absoluta del binario WASM.
      if (!(error instanceof Event) || error.type !== 'error') throw error;
      const respuesta = await fetch(archivos.wasmLoaderPath, { cache: 'reload' });
      if (!respuesta.ok) throw new Error(`Cargador del motor, HTTP ${respuesta.status}`);
      const script = URL.createObjectURL(await respuesta.blob());
      try {
        return await iniciar({ ...archivos, wasmLoaderPath: script });
      } finally {
        URL.revokeObjectURL(script);
      }
    }
  } catch (error) {
    const detalle = error?.message || (error instanceof Event ? 'No se pudo ejecutar el cargador del motor.' : 'Error al iniciar el motor.');
    throw new Error(`No se pudo iniciar ${nombre}. ${detalle}`, { cause: error });
  }
}
