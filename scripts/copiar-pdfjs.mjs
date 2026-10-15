// Copia las fuentes y tablas de caracteres de pdf.js dentro de la app,
// para que los PDF se vean bien también sin internet. Se ejecuta solo antes de "dev" y "build".
import { cpSync, mkdirSync } from 'node:fs';

const origen = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const destino = new URL('../public/pdfjs/', import.meta.url);
mkdirSync(destino, { recursive: true });
cpSync(new URL('standard_fonts/', origen), new URL('standard_fonts/', destino), { recursive: true });
cpSync(new URL('cmaps/', origen), new URL('cmaps/', destino), { recursive: true });

// MediaPipe (reconocimiento sin QR): solo la versión con SIMD (iPhone con iOS 16.4 o más y PC actuales)
const mpOrigen = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const mpDestino = new URL('../public/mediapipe/', import.meta.url);
mkdirSync(mpDestino, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) cpSync(new URL(f, mpOrigen), new URL(f, mpDestino));
