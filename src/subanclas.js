export const CARAS_MAQUINA = {
  frontal: 'Frontal',
  derecha: 'Lateral derecho',
  trasera: 'Trasera',
  izquierda: 'Lateral izquierdo',
};

export const ORIENTACIONES_QR = { vertical: 'Vertical', horizontal: 'Horizontal' };

// Prefijo distinto del de los elementos y del QR principal.
export const textoQRSubancla = (id) => `INFOLENS-SUB:${id}`;

export function giroSubanclaValido(giroQR) {
  return Number.isFinite(giroQR) && Math.abs(giroQR) <= Math.PI;
}

export function calibracionSubanclaValida({ pos, cara, ladoCm, orientacion }) {
  return Array.isArray(pos) && pos.length === 3 && pos.every((n) => Number.isFinite(n) && Math.abs(n) < 1000) &&
    pos.some((n) => n !== 0) && Object.hasOwn(CARAS_MAQUINA, cara) && Number.isFinite(ladoCm) && ladoCm >= 2 && ladoCm <= 16 &&
    (orientacion == null || Object.hasOwn(ORIENTACIONES_QR, orientacion));
}

export function subanclasDe(ancla) {
  if (!Array.isArray(ancla.subanclas)) return [];
  return ancla.subanclas.filter((s) => s && /^S-[0-9a-f]{12}$/.test(s.id) && typeof s.nombre === 'string' &&
    s.nombre.length > 0 && s.nombre.length <= 80 && calibracionSubanclaValida(s));
}
