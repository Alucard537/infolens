// Crea public/ejemplo/prueba-flechas.usdz: objeto rojo, flechas 130 cm adelante y 150 cm a la derecha,
// y objeto azul al final. Uso: node scripts/generar-prueba-flechas.mjs
import { writeFileSync } from 'node:fs';
import { usdzPruebaFlechas } from '../src/ar/prueba-flechas.js';

const bytes = await usdzPruebaFlechas([{ adelante: 130 }, { derecha: 150 }]);
writeFileSync(new URL('../public/ejemplo/prueba-flechas.usdz', import.meta.url), Buffer.from(bytes));
console.log('prueba-flechas.usdz:', bytes.byteLength, 'bytes');
