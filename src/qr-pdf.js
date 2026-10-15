// Genera los QR de los elementos en PDF, al tamaño exacto (el que usa el escáner para el cálculo 3D).
// El QR solo contiene "INFOLENS:<ID>": así se enlaza cada QR con su elemento.
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { QR_PREFIX, APP_NAME } from './config.js';

export const textoQR = (id) => QR_PREFIX + id;

const A4 = { ancho: 210, alto: 297 };
const MARGEN_PAGINA = 6; // mm
const PIE = 5;           // mm reservados abajo para la nota de impresión
const PT = 0.3528;       // 1 punto tipográfico en mm

// Medidas de cada QR en la hoja (todo en mm)
function medidas(ladoCm) {
  const lado = ladoCm * 10;
  const tNombre = Math.min(16, Math.max(8, lado * 0.16));
  const tRef = tNombre * 0.75;
  const tId = Math.max(7, tNombre * 0.55);
  const margen = Math.max(4, lado * 0.08);   // borde blanco alrededor del QR (necesario para leerlo)
  const altoTexto = (tNombre * 2 + tRef + tId) * PT * 1.25;
  const celdaAncho = lado + margen * 2;
  const celdaAlto = lado + margen * 2 + altoTexto;
  const cols = Math.floor((A4.ancho - MARGEN_PAGINA * 2) / celdaAncho);
  const filas = Math.floor((A4.alto - MARGEN_PAGINA * 2 - PIE) / celdaAlto);
  return { lado, tNombre, tRef, tId, margen, celdaAncho, celdaAlto, cols, filas };
}

// Dibuja el QR como vectores (nítido a cualquier tamaño). "lado" = zona negra, en mm.
function dibujarQR(doc, texto, x, y, lado) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const m = lado / n;
  const solape = 0.02; // evita rayas finas blancas entre módulos al imprimir
  doc.setFillColor(0, 0, 0);
  for (let f = 0; f < n; f++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(f, c)) { c++; continue; }
      const inicio = c;
      while (c < n && qr.modules.get(f, c)) c++;
      doc.rect(x + inicio * m, y + f * m, (c - inicio) * m + solape, m + solape, 'F');
    }
  }
}

/**
 * elementos: [{ id, nombre, referencia }]; ladoCm: tamaño de la zona negra del QR.
 * Devuelve un Blob PDF A4 con tantos QR por hoja como quepan.
 */
export function generarPdfQR(elementos, ladoCm) {
  const { lado, tNombre, tRef, tId, margen, celdaAncho, celdaAlto, cols, filas } = medidas(ladoCm);
  if (cols < 1 || filas < 1) {
    throw new Error(`Un QR de ${ladoCm} cm no cabe en una hoja A4. Usa un tamaño menor (máximo unos 16 cm).`);
  }
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pt = PT;
  const porHoja = cols * filas;
  const x0 = (A4.ancho - cols * celdaAncho) / 2;
  const y0 = MARGEN_PAGINA;

  elementos.forEach((el, i) => {
    const pos = i % porHoja;
    if (i > 0 && pos === 0) doc.addPage();
    if (pos === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(140);
      doc.text(`${APP_NAME} · QR de ${ladoCm} cm (zona negra). Imprimir al 100 % / tamaño real, sin "ajustar a la página".`,
        A4.ancho / 2, A4.alto - MARGEN_PAGINA + 1, { align: 'center' });
    }
    const x = x0 + (pos % cols) * celdaAncho;
    const y = y0 + Math.floor(pos / cols) * celdaAlto;

    // Línea de corte
    doc.setDrawColor(190);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x, y, celdaAncho, celdaAlto);
    doc.setLineDashPattern([], 0);

    dibujarQR(doc, textoQR(el.id), x + margen, y + margen, lado);
    // QR de ANCLA: flechas impresas para colocarlo siempre igual (definen "adelante" y "derecha")
    if (el.ancla) {
      const mx = x + margen + lado / 2, arribaQR = y + margen;
      const t = Math.max(2.2, margen * 0.4);
      doc.setFillColor(0, 0, 0);
      doc.triangle(mx - t, arribaQR - 1, mx + t, arribaQR - 1, mx, arribaQR - 1 - t * 1.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.max(6, t * 2.6)); doc.setTextColor(0);
      doc.text('ADELANTE', mx + t + 1.5, arribaQR - 1.3);
      const rx = x + margen + lado + 1, my = y + margen + lado / 2;
      doc.triangle(rx, my - t, rx, my + t, rx + t * 1.2, my, 'F');
      doc.text('DERECHA', rx + t * 0.6, my + t + 1.5, { angle: -90 });
    }

    // Nombre, referencia e ID debajo
    const cx = x + celdaAncho / 2;
    let ty = y + margen + lado + margen * 0.5 + tNombre * pt * 0.9;
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(tNombre);
    const lineas = doc.splitTextToSize(el.nombre || '', celdaAncho - 4).slice(0, 2);
    doc.text(lineas, cx, ty, { align: 'center', lineHeightFactor: 1.1 });
    ty += (lineas.length - 1) * tNombre * pt * 1.1 + tRef * pt * 1.15;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(tRef);
    doc.text(String(el.referencia || ''), cx, ty, { align: 'center', maxWidth: celdaAncho - 4 });
    ty += tId * pt * 1.25;
    doc.setFontSize(tId);
    doc.setTextColor(110);
    doc.text(`ID: ${el.id}`, cx, ty, { align: 'center' });
  });
  return doc.output('blob');
}

/** QR en un <canvas> para verlo en pantalla. */
export async function qrEnCanvas(canvas, id, tam = 600) {
  await QRCode.toCanvas(canvas, textoQR(id), { errorCorrectionLevel: 'M', margin: 4, width: tam });
}

export function qrPorHoja(ladoCm) {
  const m = medidas(ladoCm);
  return Math.max(0, m.cols * m.filas);
}
