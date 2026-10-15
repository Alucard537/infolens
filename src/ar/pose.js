// Calcula la posición y el giro del QR respecto a la cámara a partir de sus 4 esquinas.
// Método: homografía entre el cuadrado real (en metros) y las esquinas en la imagen.

// Resuelve A·x = b (8x8) por eliminación de Gauss.
function resolver(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let f = c + 1; f < n; f++) if (Math.abs(A[f][c]) > Math.abs(A[p][c])) p = f;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let f = c + 1; f < n; f++) {
      const k = A[f][c] / A[c][c];
      for (let j = c; j < n; j++) A[f][j] -= k * A[c][j];
      b[f] -= k * b[c];
    }
  }
  const x = new Array(n);
  for (let f = n - 1; f >= 0; f--) {
    let s = b[f];
    for (let j = f + 1; j < n; j++) s -= A[f][j] * x[j];
    x[f] = s / A[f][f];
  }
  return x;
}

const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const escala = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
const suma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const resta = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => escala(v, 1 / norm(v));

/**
 * esquinas: [[x,y] x4] en píxeles del vídeo, orden: arriba-izq, arriba-der, abajo-der, abajo-izq.
 * f, cx, cy: parámetros de la cámara en píxeles del vídeo. lado: tamaño real del QR en metros.
 * Devuelve { R: [r1, r2, r3] (columnas), t } en coordenadas de cámara (x derecha, y abajo, z hacia delante).
 */
export function calcularPose(esquinas, f, cx, cy, lado) {
  const h = lado / 2;
  const modelo = [[-h, -h], [h, -h], [h, h], [-h, h]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = modelo[i];
    const x = (esquinas[i][0] - cx) / f;
    const y = (esquinas[i][1] - cy) / f;
    A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y]); b.push(x);
    A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y]); b.push(y);
  }
  const H = resolver(A, b);
  if (!H) return null;
  const c1 = [H[0], H[3], H[6]];
  const c2 = [H[1], H[4], H[7]];
  const c3 = [H[2], H[5], 1];
  let lambda = 2 / (norm(c1) + norm(c2));
  if (c3[2] * lambda < 0) lambda = -lambda; // el QR tiene que estar delante de la cámara
  const r1 = escala(c1, lambda), r2 = escala(c2, lambda), t = escala(c3, lambda);

  // Convertir r1, r2 en ejes perfectamente perpendiculares
  const z = unit(cruz(r1, r2));
  const medio = unit(suma(unit(r1), unit(r2)));
  const n = unit(cruz(z, medio));
  const x = escala(resta(medio, n), Math.SQRT1_2);
  const y = escala(suma(medio, n), Math.SQRT1_2);
  return { R: [x, y, z], t };
}
