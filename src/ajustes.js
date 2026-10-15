// Ajustes de la app, guardados en la base de datos del móvil.
// Se cargan una vez al arrancar (cargarAjustes) y luego se leen al instante desde memoria.
import { DEFAULTS } from './config.js';
import { leerTodosAjustes, guardarAjuste } from './db.js';

let actuales = { ...DEFAULTS };

export async function cargarAjustes() {
  try {
    const guardados = await leerTodosAjustes();
    // Pasar los ajustes antiguos (Fases 1-2, guardados en localStorage) a la base de datos
    try {
      const viejos = JSON.parse(localStorage.getItem('infolens-ajustes') || 'null');
      if (viejos) {
        for (const [k, v] of Object.entries(viejos)) {
          if (!(k in guardados)) { guardados[k] = v; await guardarAjuste(k, v); }
        }
        localStorage.removeItem('infolens-ajustes');
      }
    } catch {}
    actuales = { ...DEFAULTS, ...guardados };
  } catch (e) {
    console.warn('No se pudieron cargar los ajustes:', e);
  }
  return actuales;
}

export function leerAjustes() {
  return { ...actuales };
}

export function guardarAjustes(cambios) {
  actuales = { ...actuales, ...cambios };
  for (const [k, v] of Object.entries(cambios)) {
    guardarAjuste(k, v).catch((e) => console.warn('No se pudo guardar el ajuste', k, e));
  }
  return { ...actuales };
}
