export const CARAS_MAQUINA = {
  frontal: 'Frontal',
  derecha: 'Lateral derecho',
  trasera: 'Trasera',
  izquierda: 'Lateral izquierdo',
};

// Prefijo distinto del de los elementos y del QR principal.
export const textoQRSubancla = (id) => `INFOLENS-SUB:${id}`;

export function calibracionSubanclaValida({ pos, cara, ladoCm }) {
  return Array.isArray(pos) && pos.length === 3 && pos.every((n) => Number.isFinite(n) && Math.abs(n) < 1000) &&
    pos.some((n) => n !== 0) && Object.hasOwn(CARAS_MAQUINA, cara) && Number.isFinite(ladoCm) && ladoCm >= 2 && ladoCm <= 16;
}

export function subanclasDe(ancla) {
  if (!Array.isArray(ancla.subanclas)) return [];
  return ancla.subanclas.filter((s) => s && /^S-[0-9a-f]{12}$/.test(s.id) && typeof s.nombre === 'string' &&
    s.nombre.length > 0 && s.nombre.length <= 80 && calibracionSubanclaValida(s));
}
