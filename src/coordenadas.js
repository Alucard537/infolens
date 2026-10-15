// Coordenadas respecto al QR del ancla, tal como las ve el usuario:
//   ADELANTE (+) / atrás (−): la dirección hacia la que miras al leer el QR derecho
//        (QR en el suelo o en una mesa: hacia su borde de arriba, el de "▲ ADELANTE";
//         QR en una pared: hacia la pared)
//   DERECHA (+) / izquierda (−): la derecha del QR
//   ARRIBA (+) / abajo (−): hacia el techo, según la gravedad (aunque el QR esté inclinado)
//
// Internamente (base de datos y 3D) se guardan en metros en el sistema "G":
//   x = derecha, y = arriba, z = hacia quien lee el QR  →  adelante = −z.
//
// RECORRIDO POR TRAMOS: cada tramo es un movimiento desde donde terminó el anterior
// (el primero sale del QR). Por ejemplo: [adelante 130], [derecha 150] → las flechas avanzan
// 130 cm y, al final, giran y siguen 150 cm a la derecha. El destino es el final del último tramo.

/** {adelante, derecha, arriba} en cm → punto G en metros. */
export const aG = ({ adelante = 0, derecha = 0, arriba = 0 }) => [derecha / 100, arriba / 100, -adelante / 100];

/** Punto G en metros → {adelante, derecha, arriba} en cm (redondeado a 0,1 cm). */
export function deG(p) {
  const r = (n) => Math.round(n * 1000) / 10 || 0;
  return { adelante: r(-p[2]), derecha: r(p[0]), arriba: r(p[1]) };
}

/** Tramos (cm) → puntos G acumulados (metros), sin el origen. */
export function puntosDeTramos(tramos) {
  let x = 0, y = 0, z = 0;
  return tramos.map((t) => {
    const [dx, dy, dz] = aG(t);
    x += dx; y += dy; z += dz;
    return [x, y, z].map((n) => Math.round(n * 1000) / 1000);
  });
}

/** Puntos G (metros, sin el origen) → tramos (cm), cada uno desde el anterior (el primero desde el QR). */
export function tramosDePuntos(puntos) {
  let prev = [0, 0, 0];
  return (puntos || []).map((p) => {
    const t = deG([p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]]);
    prev = p;
    return t;
  });
}

/** Texto corto de un tramo o posición: "130 adelante · 150 derecha". */
export function describir(t) {
  const partes = [];
  const fmt = (n) => String(Math.abs(Math.round(n * 10) / 10)).replace('.', ',');
  if (t.adelante) partes.push(`${fmt(t.adelante)} ${t.adelante > 0 ? 'adelante' : 'atrás'}`);
  if (t.derecha) partes.push(`${fmt(t.derecha)} ${t.derecha > 0 ? 'derecha' : 'izquierda'}`);
  if (t.arriba) partes.push(`${fmt(t.arriba)} ${t.arriba > 0 ? 'arriba' : 'abajo'}`);
  return partes.length ? partes.join(' · ') + ' cm' : 'en el mismo punto del QR';
}

// Lee un número aunque se escriba "X=-130", "-130 cm" o con coma decimal ("1,5"). Vacío = 0.
export function numero(t) {
  const s = String(t ?? '').replace(/\s+/g, '');
  if (!s) return 0;
  const m = /-?\d+(?:[.,]\d+)?/.exec(s);
  return m ? parseFloat(m[0].replace(',', '.')) : NaN;
}
