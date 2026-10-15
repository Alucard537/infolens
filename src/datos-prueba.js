// La primera vez que se abre la app, crea el elemento de ejemplo TEST-1
// (el del QR de prueba) usando la imagen y el PDF incluidos en la app.
// Si el usuario lo borra, no se vuelve a crear.
import { contarElementos, guardarElemento } from './db.js';
import { leerAjustes, guardarAjustes } from './ajustes.js';
import { prepararFoto } from './imagenes.js';

export async function crearEjemploSiHaceFalta() {
  if (leerAjustes().ejemploCreado) return;
  try {
    if ((await contarElementos()) === 0) {
      const base = import.meta.env.BASE_URL;
      const [svg, pdf] = await Promise.all([
        fetch(base + 'ejemplo/valvula.svg').then((r) => r.blob()),
        fetch(base + 'ejemplo/ficha.pdf').then((r) => r.blob()),
      ]);
      const { imagen, miniatura } = await prepararFoto(svg);
      await guardarElemento(
        {
          id: 'TEST-1',
          nombre: 'Válvula de prueba',
          referencia: 'REF-0001-A',
          tipo: 'SENCILLO',
          descripcion: 'Elemento de ejemplo para probar la realidad aumentada. Válvula de bola DN50, PN16, accionamiento manual. Puedes editarlo o borrarlo.',
        },
        {
          imagenId: { blob: imagen, nombre: 'valvula.jpg' },
          miniaturaId: { blob: miniatura, nombre: 'valvula-mini.jpg' },
          pdfId: { blob: new Blob([pdf], { type: 'application/pdf' }), nombre: 'ficha.pdf' },
        },
        true,
      );
    }
    guardarAjustes({ ejemploCreado: true });
  } catch (e) {
    console.warn('No se pudo crear el ejemplo:', e);
  }
}
