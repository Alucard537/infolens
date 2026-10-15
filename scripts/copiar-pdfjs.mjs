// Copia las fuentes y tablas de caracteres de pdf.js dentro de la app,
// para que los PDF se vean bien también sin internet. Se ejecuta solo antes de "dev" y "build".
import { cpSync, mkdirSync } from 'node:fs';

const origen = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const destino = new URL('../public/pdfjs/', import.meta.url);
mkdirSync(destino, { recursive: true });
cpSync(new URL('standard_fonts/', origen), new URL('standard_fonts/', destino), { recursive: true });
cpSync(new URL('cmaps/', origen), new URL('cmaps/', destino), { recursive: true });
