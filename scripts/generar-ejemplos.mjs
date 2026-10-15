// Genera los archivos de ejemplo de la Fase 1 en public/ejemplo.
// Uso: node scripts/generar-ejemplos.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

const dir = new URL('../public/ejemplo/', import.meta.url);
mkdirSync(dir, { recursive: true });
const escribir = (nombre, datos) => writeFileSync(new URL(nombre, dir), datos);

// ---------- QR de prueba (sin margen: el tamaño impreso es solo la zona negra) ----------
const TEXTO_QR = 'INFOLENS:TEST-1';
const svgQR = await QRCode.toString(TEXTO_QR, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
escribir('qr-TEST-1.svg', svgQR);
escribir('qr-prueba.html', `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QR de prueba TEST-1</title>
<style>
  body { font-family: system-ui, sans-serif; text-align: center; margin: 0; padding: 2cm 0; background: #fff; color: #000; }
  .qr { width: 10cm; height: 10cm; margin: 0 auto; padding: 1.5cm; box-sizing: content-box; }
  .qr svg { width: 10cm; height: 10cm; display: block; }
  h2 { margin: 0.3cm 0 0; font-size: 22pt; } p { margin: 0.2cm 0; font-size: 14pt; }
  .aviso { color: #666; font-size: 11pt; }
  @media print { .aviso { display: none; } }
</style></head><body>
<div class="qr">${svgQR}</div>
<h2>Válvula de prueba</h2>
<p>REF-0001-A · ${TEXTO_QR}</p>
<p class="aviso">Imprime al 100 % (sin "ajustar a la página"). Mide con una regla: la zona negra debe medir 10 cm.</p>
</body></html>`);

// ---------- Imagen de ejemplo (dibujo de una válvula) ----------
escribir('valvula.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <rect width="800" height="600" fill="#f4f7fa"/>
  <g stroke="#1d3c52" stroke-width="6" fill="#9cc9e6">
    <rect x="40" y="250" width="200" height="100" rx="8"/>
    <rect x="560" y="250" width="200" height="100" rx="8"/>
    <rect x="20" y="220" width="40" height="160" rx="6" fill="#6f9fbf"/>
    <rect x="740" y="220" width="40" height="160" rx="6" fill="#6f9fbf"/>
    <circle cx="400" cy="300" r="170" fill="#7ec8f2"/>
    <circle cx="400" cy="300" r="90" fill="#e8f4fb"/>
    <rect x="380" y="60" width="40" height="80" fill="#6f9fbf"/>
    <rect x="300" y="30" width="260" height="40" rx="18" fill="#e04b3c"/>
  </g>
  <g font-family="Arial, sans-serif" fill="#1d3c52">
    <text x="400" y="560" font-size="34" text-anchor="middle" font-weight="bold">Válvula de bola DN50 · PN16</text>
    <text x="400" y="310" font-size="22" text-anchor="middle">Detalle: asiento</text>
    <text x="140" y="410" font-size="18" text-anchor="middle">Entrada</text>
    <text x="660" y="410" font-size="18" text-anchor="middle">Salida</text>
    <text x="580" y="58" font-size="18">Palanca</text>
  </g>
</svg>`);

// ---------- PDF de ejemplo (2 páginas) ----------
const doc = new jsPDF({ unit: 'mm', format: 'a4' });
doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
doc.text('Ficha técnica', 20, 25);
doc.setFontSize(16); doc.text('Válvula de prueba · REF-0001-A', 20, 36);
doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
const filas = [
  ['Tipo', 'Válvula de bola'], ['Diámetro nominal', 'DN50'], ['Presión nominal', 'PN16'],
  ['Material cuerpo', 'Acero inoxidable 316'], ['Juntas', 'PTFE'], ['Temperatura', '-20 °C a 180 °C'],
  ['Accionamiento', 'Manual, palanca'], ['Par de maniobra', '25 N·m'],
];
let y = 52;
for (const [a, b] of filas) {
  doc.setDrawColor(180); doc.line(20, y + 3, 190, y + 3);
  doc.setFont('helvetica', 'bold'); doc.text(a, 22, y);
  doc.setFont('helvetica', 'normal'); doc.text(b, 90, y);
  y += 10;
}
doc.setFontSize(9);
doc.text('Texto pequeño para comprobar el zoom: revisar el apriete de la tornillería cada 6 meses.', 20, y + 10);
doc.addPage();
doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Página 2 · Esquema', 20, 25);
doc.setLineWidth(1); doc.setDrawColor(29, 60, 82);
doc.circle(105, 120, 45); doc.circle(105, 120, 22);
doc.rect(25, 108, 35, 24); doc.rect(150, 108, 35, 24);
doc.rect(98, 40, 14, 30); doc.rect(75, 32, 60, 10);
doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
doc.text('Entrada', 30, 145); doc.text('Salida', 158, 145); doc.text('Palanca', 140, 38);
doc.setFontSize(7); doc.text('Cota interior: 50 mm', 92, 121);
writeFileSync(new URL('ficha.pdf', dir), Buffer.from(doc.output('arraybuffer')));

console.log('Ejemplos generados en public/ejemplo');
