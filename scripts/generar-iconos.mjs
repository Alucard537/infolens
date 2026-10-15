// Crea los iconos de la app (pantalla de inicio del iPhone, Android y pestaña del navegador).
// Uso: node scripts/generar-iconos.mjs   (vuelve a ejecutarlo si cambias el dibujo)
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('../public/iconos/', import.meta.url);
mkdirSync(dir, { recursive: true });

// Dibujo del icono: fondo azul oscuro, esquinas de visor de QR y disco azul claro con la "i".
// "relleno" deja margen extra para los iconos "maskable" de Android (que se recortan en círculo).
function svg(relleno = 0, redondeo = true) {
  const k = 1 - relleno * 2;
  const t = (n) => 256 + (n - 256) * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${redondeo ? 'rx="112"' : ''} fill="#0f1b24"/>
  <g fill="none" stroke="#7EC8F2" stroke-width="${26 * k}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${t(96)} ${t(176)} V${t(96)} H${t(176)}"/>
    <path d="M${t(336)} ${t(96)} H${t(416)} V${t(176)}"/>
    <path d="M${t(416)} ${t(336)} V${t(416)} H${t(336)}"/>
    <path d="M${t(176)} ${t(416)} H${t(96)} V${t(336)}"/>
  </g>
  <circle cx="256" cy="256" r="${118 * k}" fill="#7EC8F2" fill-opacity="0.9"/>
  <circle cx="256" cy="${t(196)}" r="${20 * k}" fill="#fff"/>
  <rect x="${256 - 17 * k}" y="${t(232)}" width="${34 * k}" height="${100 * k}" rx="${12 * k}" fill="#fff"/>
</svg>`;
}

const crear = (nombre, tam, dibujo) =>
  sharp(Buffer.from(dibujo)).resize(tam, tam).png().toFile(fileURLToPath(new URL(nombre, dir)));

writeFileSync(new URL('icono.svg', dir), svg());
await crear('icono-192.png', 192, svg());
await crear('icono-512.png', 512, svg());
await crear('icono-maskable-512.png', 512, svg(0.1, false));
// iOS redondea él mismo las esquinas: le damos el cuadrado completo
await crear('apple-touch-icon.png', 180, svg(0, false));
console.log('Iconos generados en public/iconos');
