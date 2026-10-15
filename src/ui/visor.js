// Visor a pantalla completa para imágenes y PDF, con zoom. Todo funciona sin internet:
// pdf.js va incluido dentro de la app.
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { hacerZoomable } from './zoom.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function crearCapa(titulo) {
  const capa = document.createElement('div');
  capa.className = 'visor';
  capa.innerHTML = `
    <div class="visor-barra">
      <button class="esc-btn" data-accion="cerrar" aria-label="Cerrar">✕</button>
      <div class="visor-titulo"></div>
    </div>
    <div class="visor-marco"><div class="visor-contenido"></div></div>
    <div class="visor-pie" hidden>
      <button class="esc-btn" data-accion="anterior" aria-label="Página anterior">‹</button>
      <span class="visor-pagina"></span>
      <button class="esc-btn" data-accion="siguiente" aria-label="Página siguiente">›</button>
    </div>`;
  capa.querySelector('.visor-titulo').textContent = titulo;
  document.body.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.querySelector('[data-accion="cerrar"]').addEventListener('click', cerrar);
  return {
    capa, cerrar,
    marco: capa.querySelector('.visor-marco'),
    contenido: capa.querySelector('.visor-contenido'),
  };
}

export function abrirImagen(url, titulo) {
  const { marco, contenido } = crearCapa(titulo);
  const img = new Image();
  img.className = 'visor-img';
  img.alt = titulo;
  contenido.appendChild(img);
  const zoom = hacerZoomable(marco, contenido);
  img.onload = () => {
    // Ajustar la imagen al ancho/alto disponible
    const k = Math.min(marco.clientWidth / img.naturalWidth, marco.clientHeight / img.naturalHeight);
    img.style.width = img.naturalWidth * k + 'px';
    img.style.height = img.naturalHeight * k + 'px';
    zoom.restablecer();
  };
  img.src = url;
}

export async function abrirPdf(url, titulo) {
  const { capa, marco, contenido, cerrar } = crearCapa(titulo);
  const pie = capa.querySelector('.visor-pie');
  const txtPagina = capa.querySelector('.visor-pagina');
  contenido.innerHTML = '<p class="visor-cargando">Cargando PDF…</p>';
  const zoom = hacerZoomable(marco, contenido);

  let doc;
  try {
    const datos = await (await fetch(url)).arrayBuffer();
    const base = import.meta.env.BASE_URL;
    doc = await pdfjs.getDocument({
      data: datos,
      // Fuentes y tablas incluidas en la app, para que funcione sin internet
      cMapUrl: base + 'pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: base + 'pdfjs/standard_fonts/',
    }).promise;
  } catch (e) {
    contenido.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'visor-cargando';
    p.textContent = 'No se pudo abrir el PDF: ' + e.message;
    contenido.appendChild(p);
    return;
  }
  capa.querySelector('[data-accion="cerrar"]').addEventListener('click', () => doc.destroy());

  let pagina = 1;
  let tareaActual = null;
  pie.hidden = doc.numPages < 2;

  async function dibujar() {
    txtPagina.textContent = `Página ${pagina} de ${doc.numPages}`;
    const pag = await doc.getPage(pagina);
    const base = pag.getViewport({ scale: 1 });
    // Ajustar la página al marco y dibujarla con más resolución para que el zoom se vea nítido
    const ajuste = Math.min(marco.clientWidth / base.width, marco.clientHeight / base.height);
    let calidad = Math.min(window.devicePixelRatio || 2, 3) * 2;
    const maxPixeles = 16_000_000; // límite de Safari para un canvas
    while (base.width * ajuste * calidad * base.height * ajuste * calidad > maxPixeles) calidad *= 0.85;
    const vp = pag.getViewport({ scale: ajuste * calidad });

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.floor(vp.width);
    lienzo.height = Math.floor(vp.height);
    lienzo.style.width = base.width * ajuste + 'px';
    lienzo.style.height = base.height * ajuste + 'px';
    lienzo.className = 'visor-pdf-pagina';
    if (tareaActual) tareaActual.cancel();
    tareaActual = pag.render({ canvasContext: lienzo.getContext('2d'), viewport: vp });
    try { await tareaActual.promise; } catch { return; }
    contenido.innerHTML = '';
    contenido.appendChild(lienzo);
    zoom.restablecer();
  }

  capa.querySelector('[data-accion="anterior"]').addEventListener('click', () => {
    if (pagina > 1) { pagina--; dibujar(); }
  });
  capa.querySelector('[data-accion="siguiente"]').addEventListener('click', () => {
    if (pagina < doc.numPages) { pagina++; dibujar(); }
  });
  dibujar();
  return cerrar;
}
