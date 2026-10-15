// Permiso del sensor de orientación (iPhone). Archivo aparte y ligero: se usa desde la pantalla de inicio.

let permiso = null; // 'granted' | 'denied' | null (sin preguntar)

const hacePermiso = () =>
  typeof window.DeviceOrientationEvent !== 'undefined'
  && typeof window.DeviceOrientationEvent.requestPermission === 'function';

/** En iPhone hay que pedir permiso, y SOLO funciona si se llama directamente desde un toque. */
export function pedirPermisoSensor() {
  if (!hacePermiso()) return Promise.resolve('granted');
  return window.DeviceOrientationEvent.requestPermission()
    .then((r) => { permiso = r; return r; })
    .catch(() => { permiso = 'denied'; return 'denied'; });
}

export const faltaPermiso = () => hacePermiso() && permiso !== 'granted';
