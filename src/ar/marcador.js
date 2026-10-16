// MARCADOR DE ANCLA: el QR del ancla en el centro, rodeado de un dibujo con muchas formas y colores
// (distinto para cada ancla y sin simetrías). El AR de Apple reconoce MUY mal un QR solo (cuadrados
// blancos y negros que se repiten), pero reconoce bien un dibujo así, y con él sabe exactamente dónde
// está el frente ("▲ ADELANTE"), la derecha y el centro. La app sigue leyendo el QR del centro.
// El mismo dibujo se imprime (PDF) y se pasa al AR de Apple como imagen de referencia.
import QRCode from 'qrcode';

/** Ancho total del marcador (cm) para un QR de ladoQRcm (cabe en un A4). */
export const anchoMarcadorCm = (ladoQRcm) => Math.round(Math.min(19, Math.max(12, ladoQRcm * 1.9)) * 10) / 10;

function azar(texto) {
  let h = 2166136261;
  for (const c of texto) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

const COLORES = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c',
  '#008080', '#9a6324', '#800000', '#808000', '#000075', '#111111', '#555555', '#aaaaaa'];

/** Dibuja el marcador en un lienzo cuadrado de px píxeles. texto = contenido del QR (INFOLENS:<id>). */
export function dibujarMarcador(texto, ladoQRcm, px = 1024) {
  const ancho = anchoMarcadorCm(ladoQRcm);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  const r = azar(texto);
  const k = px / ancho; // píxeles por cm
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, px, px);
  // Fondo: manchas grandes de colores suaves (para que no quede blanco)
  const SUAVES = ['#ffd6d6', '#d6f5d6', '#d6e4ff', '#fff2c2', '#f1d6ff', '#c9f7f5', '#ffe0c2', '#e0e0e0'];
  for (let i = 0; i < 70; i++) {
    g.fillStyle = SUAVES[Math.floor(r() * SUAVES.length)];
    g.beginPath();
    const cx = r() * px, cy = r() * px, rad = (0.8 + r() * 2.5) * k, lados = 3 + Math.floor(r() * 4);
    for (let j = 0; j < lados; j++) { const a = (j / lados) * Math.PI * 2 + r(); g.lineTo(cx + Math.cos(a) * rad * (0.6 + r() * 0.6), cy + Math.sin(a) * rad * (0.6 + r() * 0.6)); }
    g.closePath(); g.fill();
  }
  // Muchas formas pequeñas al azar (siempre las mismas para el mismo ancla): círculos, rectángulos, triángulos, rayas
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = COLORES[Math.floor(r() * COLORES.length)];
    g.strokeStyle = g.fillStyle;
    const x = r() * px, y = r() * px, t = (0.12 + r() * r() * 1.1) * k;
    const forma = Math.floor(r() * 4);
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    g.beginPath();
    if (forma === 0) g.arc(0, 0, t / 2, 0, Math.PI * 2);
    else if (forma === 1) g.rect(-t / 2, -t / 3, t, t * (0.3 + r() * 0.7));
    else if (forma === 2) { g.moveTo(0, -t / 2); g.lineTo(t / 2, t / 2); g.lineTo(-t / 2, t / 2); g.closePath(); }
    if (forma === 3) { g.lineWidth = Math.max(2, t * 0.12); g.moveTo(-t, 0); g.lineTo(t, 0); g.stroke(); } else g.fill();
    g.restore();
  }
  // Zona blanca para el QR (con su margen) y el QR exacto en el centro
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const lado = ladoQRcm * k, m = lado / n, margen = 3 * m;
  const x0 = (px - lado) / 2, y0 = (px - lado) / 2;
  g.fillStyle = '#ffffff';
  g.fillRect(x0 - margen, y0 - margen, lado + margen * 2, lado + margen * 2);
  g.fillStyle = '#000000';
  for (let f = 0; f < n; f++) for (let col = 0; col < n; col++) if (qr.modules.get(f, col)) g.fillRect(Math.floor(x0 + col * m), Math.floor(y0 + f * m), Math.ceil(m) + 1, Math.ceil(m) + 1);
  // Flechas ADELANTE (arriba) y DERECHA (derecha), sobre fondo blanco
  const etiqueta = (txt, cx, cy, angulo) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(angulo);
    g.font = `900 ${Math.round(0.9 * k)}px Helvetica, Arial, sans-serif`;
    const w = g.measureText(txt).width + 0.6 * k;
    g.fillStyle = '#ffffff';
    g.fillRect(-w / 2, -0.65 * k, w, 1.3 * k);
    g.fillStyle = '#000000';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, 0, 0.05 * k);
    g.restore();
  };
  const hueco = (px - lado) / 2 - margen;
  etiqueta('▲ ADELANTE ▲', px / 2, hueco / 2, 0);
  etiqueta('DERECHA', px - hueco / 2, px / 2 - 0.4 * k, Math.PI / 2);
  // Flecha DERECHA dibujada aparte (apunta a la derecha aunque el texto vaya en vertical)
  const fx = px - hueco / 2, fy = px / 2 + 2.6 * k, tf = 0.7 * k;
  g.fillStyle = '#ffffff'; g.fillRect(fx - tf, fy - tf, tf * 2, tf * 2);
  g.fillStyle = '#000000'; g.beginPath(); g.moveTo(fx - tf * 0.7, fy - tf * 0.8); g.lineTo(fx + tf * 0.8, fy); g.lineTo(fx - tf * 0.7, fy + tf * 0.8); g.closePath(); g.fill();
  // Borde negro grueso (ayuda a recortarlo y a verlo)
  g.lineWidth = Math.max(4, 0.15 * k);
  g.strokeStyle = '#000000';
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, px - g.lineWidth, px - g.lineWidth);
  return { lienzo: c, anchoCm: ancho };
}

/** PNG del marcador (bytes) para el AR de Apple. */
export async function pngMarcador(texto, ladoQRcm) {
  const { lienzo, anchoCm } = dibujarMarcador(texto, ladoQRcm);
  const blob = await new Promise((ok) => lienzo.toBlob(ok, 'image/png'));
  return { png: new Uint8Array(await blob.arrayBuffer()), anchoCm };
}
