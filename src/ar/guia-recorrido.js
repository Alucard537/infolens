export const VIGENCIA_QR_MS = 650;
export const VIGENCIA_ENTORNO_MS = 500;
export const MAX_ENTORNO_SIN_QR_MS = 12000;

/** Destino del paso por tramos propios, posición antigua o localización del elemento. */
export function destinoDelPaso(paso, localizaciones) {
  const puntos = paso.rutaPropia;
  if (Array.isArray(puntos) && puntos.length) return { pos: puntos.at(-1), ruta: puntos.slice(0, -1) };
  if (Array.isArray(paso.destinoPropio)) return { pos: paso.destinoPropio, ruta: [] };
  return localizaciones.get(paso.elementoId) || null;
}

export function marcasDeGuia(guia, localizaciones) {
  const vistas = new Set();
  return guia.pasos.flatMap((paso, id) => {
    const destino = destinoDelPaso(paso, localizaciones);
    const pos = [destino?.posIcono, destino?.pos].find((punto) =>
      Array.isArray(punto) && punto.length === 3 && punto.every((n) => Number.isFinite(n) && Math.abs(n) < 1000));
    if (!pos) return [];
    const elemento = guia.elementos.get(paso.elementoId);
    const nombre = elemento?.nombre || String(paso.titulo ?? '').trim() || `Paso ${id + 1}`;
    const clave = elemento ? `elemento:${elemento.id}` : `punto:${nombre}:${pos.join(',')}`;
    if (vistas.has(clave)) return [];
    vistas.add(clave);
    return [{ id, pos, nombre }];
  });
}

export function fuentePoseAncla(ancla, ahora) {
  if (!ancla?.visible || !Number.isFinite(ancla.vistoQR)) return null;
  const sinQR = ahora - ancla.vistoQR;
  if (sinQR <= VIGENCIA_QR_MS && !ancla.porEntorno) return 'qr';
  if (ancla.porEntorno && ahora - ancla.ultimoEntorno <= VIGENCIA_ENTORNO_MS && sinQR <= MAX_ENTORNO_SIN_QR_MS) return 'entorno';
  return null;
}

/** Avanza en orden. La altura del teléfono queda fuera de la distancia de marcha. */
export function progresoRecorrido(puntos, posicion, indice) {
  const total = puntos.length - 1;
  for (; indice <= total; indice++) {
    const anterior = puntos[indice - 1], punto = puntos[indice];
    const dx = punto.x - anterior.x, dz = punto.z - anterior.z;
    const largo = Math.hypot(dx, dz);
    const distancia = Math.hypot(punto.x - posicion.x, punto.z - posicion.z);
    const radio = Math.min(0.45, Math.max(0.12, largo * 0.25));
    const cerca = distancia <= radio;
    if (indice === total) return { indice, total, punto, distancia, llegada: cerca };
    if (cerca) continue;
    if (largo > 0.001) {
      const x = posicion.x - anterior.x, z = posicion.z - anterior.z;
      const avance = (x * dx + z * dz) / largo;
      const desviacion = Math.abs(x * dz - z * dx) / largo;
      if (avance >= largo && avance <= largo + 2 * radio && desviacion <= radio) continue;
    }
    return { indice, total, punto, distancia, llegada: false };
  }
}

export function textoTramo({ llegada, indice, total, distancia }) {
  if (llegada) return 'Destino en esta zona';
  return `Tramo ${indice} de ${total} · ${distancia.toFixed(1).replace('.', ',')} m`;
}
