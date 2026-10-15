// Ajustes guardados en el móvil. En la Fase 3 pasarán a IndexedDB.
import { DEFAULTS } from './config.js';

const CLAVE = 'infolens-ajustes';

export function leerAjustes() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function guardarAjustes(cambios) {
  const nuevos = { ...leerAjustes(), ...cambios };
  try { localStorage.setItem(CLAVE, JSON.stringify(nuevos)); } catch {}
  return nuevos;
}
