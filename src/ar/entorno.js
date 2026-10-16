// Seguimiento con el ENTORNO (sin QR a la vista).
//
// Idea: el QR del ancla está pegado en un plano (el suelo, una mesa o una pared). Mientras se ve el QR,
// se buscan "puntos con textura" de ese plano alrededor (manchas, juntas, tornillos...) y se calcula
// dónde está cada uno en el plano del QR (en metros). Después, aunque el QR salga de la imagen, esos
// puntos se siguen fotograma a fotograma (flujo óptico Lucas-Kanade) y con ellos se recalcula la
// posición del plano del QR respecto a la cámara (homografía + RANSAC). Mientras se camina se van
// añadiendo puntos nuevos del plano, así el "mapa" crece con el recorrido.
// Los puntos que no están en el plano (objetos, máquinas) no encajan y se descartan solos.
//
// Todo en píxeles de la imagen reducida que se le pasa; las poses en coordenadas de cámara
// "de visión" (x derecha, y abajo, z delante), igual que calcularPose().
import { resolver, poseDeHomografia } from './pose.js';

const NIVELES = 3;          // pirámide de imágenes (para movimientos grandes)
const V = 7;                // media ventana del flujo óptico (ventana de 15 x 15)
const ITER = 8;
const MAX_PUNTOS = 140;
const CELDAS_X = 12, CELDAS_Y = 9;
const MIN_INLIERS = 12;
const MIN_REPONER = 110;    // sin QR: solo se añaden puntos nuevos si quedan menos (cada punto nuevo hereda el error)
const ERROR_PX = 3.5;       // error máximo de un punto para contar como "encaja" (píxeles)
const FALLOS_MAX = 2;
const RECUERDO = 15;        // fotogramas guardados para casar la pose del QR (que llega con retraso)

// ---------- imágenes ----------
function gris(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { w, h, d: g };
}
function reducir(im) {
  const w = im.w >> 1, h = im.h >> 1, d = new Float32Array(w * h), s = im.d, W = im.w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 2 * y * W + 2 * x;
      d[y * w + x] = (s[i] + s[i + 1] + s[i + W] + s[i + W + 1]) * 0.25;
    }
  }
  return { w, h, d };
}
function piramide(im) {
  const p = [im];
  for (let l = 1; l < NIVELES; l++) p.push(reducir(p[l - 1]));
  return p;
}
function muestra(im, x, y) {
  if (x < 0) x = 0; else if (x > im.w - 1.001) x = im.w - 1.001;
  if (y < 0) y = 0; else if (y > im.h - 1.001) y = im.h - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * im.w + x0, d = im.d;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + im.w] * (1 - fx) + d[i + im.w + 1] * fx) * fy;
}

// ---------- flujo óptico Lucas-Kanade piramidal ----------
const N = (2 * V + 1) * (2 * V + 1);
const tI = new Float32Array(N), tJ = new Float32Array(N), tX = new Float32Array(N), tY = new Float32Array(N);
function seguirPunto(p0, p1, x, y) {
  let gx = 0, gy = 0, err = 0;
  for (let L = NIVELES - 1; L >= 0; L--) {
    const A = p0[L], B = p1[L], s = 1 << L;
    const px = x / s, py = y / s;
    let gxx = 0, gxy = 0, gyy = 0, k = 0, mT = 0;
    for (let j = -V; j <= V; j++) {
      for (let i = -V; i <= V; i++, k++) {
        const ix = (muestra(A, px + i + 1, py + j) - muestra(A, px + i - 1, py + j)) * 0.5;
        const iy = (muestra(A, px + i, py + j + 1) - muestra(A, px + i, py + j - 1)) * 0.5;
        tI[k] = muestra(A, px + i, py + j); tX[k] = ix; tY[k] = iy;
        gxx += ix * ix; gxy += ix * iy; gyy += iy * iy; mT += tI[k];
      }
    }
    mT /= N;
    const det = gxx * gyy - gxy * gxy;
    if (det < 1e-3 * N * N) return null; // sin textura: no se puede seguir
    let vx = 0, vy = 0;
    for (let it = 0; it < ITER; it++) {
      let bx = 0, by = 0, mJ = 0;
      k = 0;
      const qx = px + gx + vx, qy = py + gy + vy;
      for (let j = -V; j <= V; j++) for (let i = -V; i <= V; i++, k++) { tJ[k] = muestra(B, qx + i, qy + j); mJ += tJ[k]; }
      mJ /= N;
      for (k = 0; k < N; k++) {
        const dI = (tI[k] - mT) - (tJ[k] - mJ);
        bx += dI * tX[k]; by += dI * tY[k];
      }
      const dx = (gyy * bx - gxy * by) / det, dy = (gxx * by - gxy * bx) / det;
      vx += dx; vy += dy;
      if (dx * dx + dy * dy < 1e-4) break;
    }
    if (L > 0) { gx = 2 * (gx + vx); gy = 2 * (gy + vy); } else { gx += vx; gy += vy; }
    if (L === 0) {
      let e = 0, mJ = 0; k = 0;
      for (let j = -V; j <= V; j++) for (let i = -V; i <= V; i++, k++) { tJ[k] = muestra(B, x + gx + i, y + gy + j); mJ += tJ[k]; }
      mJ /= N;
      for (k = 0; k < N; k++) e += Math.abs((tI[k] - mT) - (tJ[k] - mJ));
      err = e / N;
    }
  }
  const nx = x + gx, ny = y + gy;
  const im = p1[0];
  if (nx < V || ny < V || nx > im.w - 1 - V || ny > im.h - 1 - V || err > 22) return null;
  return [nx, ny];
}

// ---------- esquinas (Shi-Tomasi) en celdas vacías ----------
function buscarEsquinas(im, ocupadas, maximo) {
  const { w, h, d } = im;
  const res = [];
  const cw = w / CELDAS_X, ch = h / CELDAS_Y, B = 2, M = V + 3;
  for (let cy = 0; cy < CELDAS_Y; cy++) {
    for (let cx = 0; cx < CELDAS_X; cx++) {
      if (ocupadas.has(cy * CELDAS_X + cx)) continue;
      let mejor = 0, bx = 0, by = 0;
      const x0 = Math.max(M, Math.floor(cx * cw)), x1 = Math.min(w - M, Math.floor((cx + 1) * cw));
      const y0 = Math.max(M, Math.floor(cy * ch)), y1 = Math.min(h - M, Math.floor((cy + 1) * ch));
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          let a = 0, b = 0, c = 0;
          for (let j = -B; j <= B; j++) {
            for (let i = -B; i <= B; i++) {
              const q = (y + j) * w + x + i;
              const ix = d[q + 1] - d[q - 1], iy = d[q + w] - d[q - w];
              a += ix * ix; b += ix * iy; c += iy * iy;
            }
          }
          const m = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b); // menor valor propio
          if (m > mejor) { mejor = m; bx = x; by = y; }
        }
      }
      if (mejor > 2500) res.push({ x: bx, y: by, s: mejor });
    }
  }
  res.sort((p, q) => q.s - p.s);
  return res.slice(0, maximo);
}

// ---------- geometría ----------
/** Punto de la imagen (normalizado) → coordenadas (X, Y) en el plano del QR, o null. */
function alPlano(pose, xn, yn) {
  const [r1, r2, n] = pose.R, t = pose.t;
  const nd = n[0] * xn + n[1] * yn + n[2];
  const len = Math.hypot(xn, yn, 1);
  if (Math.abs(nd) / len < 0.12) return null; // casi rasante: muy impreciso
  const s = (n[0] * t[0] + n[1] * t[1] + n[2] * t[2]) / nd;
  if (s <= 0 || s * len > 8) return null; // detrás de la cámara o a más de 8 m
  const c = [s * xn - t[0], s * yn - t[1], s - t[2]];
  return [r1[0] * c[0] + r1[1] * c[1] + r1[2] * c[2], r2[0] * c[0] + r2[1] * c[1] + r2[2] * c[2]];
}

function homografia(ps) {
  // Mínimos cuadrados (ecuaciones normales 8 x 8)
  const A = Array.from({ length: 8 }, () => new Array(8).fill(0)), b = new Array(8).fill(0);
  const fila = (r, v) => { for (let i = 0; i < 8; i++) { b[i] += r[i] * v; for (let j = 0; j < 8; j++) A[i][j] += r[i] * r[j]; } };
  for (const p of ps) {
    fila([p.U, p.W, 1, 0, 0, 0, -p.xn * p.U, -p.xn * p.W], p.xn);
    fila([0, 0, 0, p.U, p.W, 1, -p.yn * p.U, -p.yn * p.W], p.yn);
  }
  return resolver(A, b);
}
function errorH(H, p) {
  const w = H[6] * p.U + H[7] * p.W + 1;
  if (w <= 1e-6) return Infinity;
  const x = (H[0] * p.U + H[1] * p.W + H[2]) / w, y = (H[3] * p.U + H[4] * p.W + H[5]) / w;
  return Math.hypot(x - p.xn, y - p.yn);
}

/** Crea el seguidor. Se le pasan fotogramas y, cuando se ve el QR del ancla, su pose. */
export function crearSeguidorEntorno() {
  let prev = null;
  let puntos = [];            // { id, x, y, X, Y (o null), fallos }
  let recuerdos = [];         // [{ t, pos: Map(id -> [x, y]) }]
  let semilla = null;         // última pose del QR { R, t, cuando }
  let ultimaPose = null;
  let sig = 1;
  let n = 0;
  let semilla_rand = 12345;
  const rnd = () => ((semilla_rand = (semilla_rand * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  function reiniciar() { prev = null; puntos = []; recuerdos = []; semilla = null; ultimaPose = null; }

  /** Pose del QR (visto por el lector) para el fotograma del instante t. */
  function poseQR(t, R, tv) {
    semilla = { R, t: tv, cuando: t };
    let mejor = null;
    for (const r of recuerdos) if (!mejor || Math.abs(r.t - t) < Math.abs(mejor.t - t)) mejor = r;
    if (!mejor || Math.abs(mejor.t - t) > 70 || !prev) return;
    const pose = { R, t: tv };
    for (const p of puntos) {
      const q = mejor.pos.get(p.id);
      if (!q) continue;
      const pl = alPlano(pose, (q[0] - prev.cx) / prev.f, (q[1] - prev.cy) / prev.f);
      if (pl) { p.X = pl[0]; p.Y = pl[1]; }
    }
  }

  /** Procesa un fotograma. Devuelve { pose | null, puntos, encajan }. */
  function fotograma({ t, w, h, rgba, f, cx, cy }) {
    n++;
    const pir = piramide(gris(rgba, w, h));
    // 1) Seguir los puntos desde el fotograma anterior
    if (prev && prev.w === w && prev.h === h) {
      const vivos = [];
      for (const p of puntos) {
        const q = seguirPunto(prev.pir, pir, p.x, p.y);
        if (q) { p.x = q[0]; p.y = q[1]; vivos.push(p); }
      }
      puntos = vivos;
    } else puntos = [];
    // 2) Pose del plano con los puntos que tienen posición en el plano (RANSAC)
    const conPlano = puntos.filter((p) => p.X != null);
    let X0 = 0, Y0 = 0;
    for (const p of conPlano) { X0 += p.X; Y0 += p.Y; }
    X0 /= conPlano.length || 1; Y0 /= conPlano.length || 1;
    for (const p of conPlano) { p.xn = (p.x - cx) / f; p.yn = (p.y - cy) / f; p.U = p.X - X0; p.W = p.Y - Y0; }
    let pose = null, encajan = 0;
    const umbral = ERROR_PX / f;
    if (conPlano.length >= MIN_INLIERS) {
      let mejorH = null, mejores = [];
      for (let it = 0; it < 70; it++) {
        const m = new Set();
        while (m.size < 4) m.add((rnd() * conPlano.length) | 0);
        const H = homografia([...m].map((i) => conPlano[i]));
        if (!H) continue;
        const dentro = conPlano.filter((p) => errorH(H, p) < umbral);
        if (dentro.length > mejores.length) { mejores = dentro; mejorH = H; }
      }
      if (mejorH && mejores.length >= MIN_INLIERS) {
        let H = homografia(mejores) || mejorH;
        mejores = conPlano.filter((p) => errorH(H, p) < umbral);
        H = homografia(mejores) || H;
        const dentro = new Set(mejores);
        for (const p of conPlano) p.fallos = dentro.has(p) ? 0 : (p.fallos || 0) + 1;
        puntos = puntos.filter((p) => p.X == null || p.fallos < FALLOS_MAX);
        encajan = mejores.length;
        if (encajan >= MIN_INLIERS && encajan >= conPlano.length * 0.45) {
          const pp = poseDeHomografia(H);
          if (pp && pp.t[2] > 0.05) {
            // Pasar del origen local al centro del QR: t = t_local − X0·r1 − Y0·r2
            const [r1, r2] = pp.R;
            pose = { R: pp.R, t: [0, 1, 2].map((i) => pp.t[i] - X0 * r1[i] - Y0 * r2[i]) };
          }
        }
      }
    }
    if (pose) ultimaPose = pose;
    const poseBuena = pose && encajan >= 20 && encajan >= conPlano.length * 0.75;
    // 3) Puntos nuevos del plano (con la pose de ahora, o la del QR recién visto)
    const conQR = semilla && t - semilla.cuando < 250;
    const ref = conQR ? (pose || semilla) : poseBuena ? pose : null;
    if (ref && puntos.length < (conQR ? MAX_PUNTOS : MIN_REPONER) && (n % 2 === 0 || puntos.length < 60)) {
      const ocupadas = new Set();
      const cw = w / CELDAS_X, ch = h / CELDAS_Y;
      for (const p of puntos) ocupadas.add(Math.min(CELDAS_Y - 1, (p.y / ch) | 0) * CELDAS_X + Math.min(CELDAS_X - 1, (p.x / cw) | 0));
      for (const e of buscarEsquinas(pir[0], ocupadas, MAX_PUNTOS - puntos.length)) {
        const pl = alPlano(ref, (e.x - cx) / f, (e.y - cy) / f);
        if (pl) puntos.push({ id: sig++, x: e.x, y: e.y, X: pl[0], Y: pl[1], fallos: 0 });
      }
    }
    // 4) Recordar dónde estaba cada punto en este instante
    recuerdos.push({ t, pos: new Map(puntos.map((p) => [p.id, [p.x, p.y]])) });
    if (recuerdos.length > RECUERDO) recuerdos.shift();
    prev = { pir, w, h, f, cx, cy };
    return { pose, puntos: puntos.length, encajan };
  }

  return { fotograma, poseQR, reiniciar, get ultimaPose() { return ultimaPose; } };
}
