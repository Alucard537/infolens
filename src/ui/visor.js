// Visor a pantalla completa para imágenes y PDF, con zoom. Todo funciona sin internet:
// pdf.js va incluido dentro de la app.
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { hacerZoomable } from './zoom.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function crearCapa(titulo, { flotante = false, alCerrar } = {}) {
  const capa = document.createElement('div');
  capa.className = 'visor';
  capa.innerHTML = `
    <div class="visor-barra">
      <button class="esc-btn" data-accion="cerrar" aria-label="Cerrar">✕</button>
      <div class="visor-titulo"></div>
      ${flotante ? `<button class="esc-btn" data-accion="reducir" aria-label="Reducir ventana">−</button>
        <button class="esc-btn" data-accion="ampliar" aria-label="Ampliar ventana">+</button>` : ''}
    </div>
    <div class="visor-marco"><div class="visor-contenido"></div></div>
    <div class="visor-pie" hidden>
      <button class="esc-btn" data-accion="anterior" aria-label="Página anterior">‹</button>
      <span class="visor-pagina"></span>
      <button class="esc-btn" data-accion="siguiente" aria-label="Página siguiente">›</button>
    </div>
    ${flotante ? '<div class="visor-borde-flotante"><span class="visor-tirador" aria-hidden="true">↘</span></div>' : ''}`;
  const enc = capa.querySelector('.visor-titulo');
  enc.textContent = titulo;
  const vida = new AbortController();
  let raiz = capa;
  if (flotante) {
    raiz = document.createElement('div');
    raiz.className = 'visor-zona-flotante';
    capa.classList.add('visor-flotante');
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-label', titulo);
    raiz.appendChild(capa);
  }
  document.body.appendChild(raiz);
  const cerrar = () => {
    if (vida.signal.aborted) return;
    vida.abort();
    raiz.remove();
    alCerrar?.();
  };
  const botonCerrar = capa.querySelector('[data-accion="cerrar"]');
  botonCerrar.addEventListener('click', cerrar);
  if (flotante) {
    ajustarVentana(raiz, capa, enc, vida.signal);
    capa.addEventListener('keydown', (event) => { if (event.key === 'Escape') cerrar(); });
    botonCerrar.focus({ preventScroll: true });
  }
  return {
    capa, cerrar, signal: vida.signal,
    marco: capa.querySelector('.visor-marco'),
    contenido: capa.querySelector('.visor-contenido'),
  };
}

function ajustarVentana(zona, capa, enc, signal) {
  const ancho = zona.clientWidth;
  const alto = zona.clientHeight;
  const ventana = { w: Math.min(ancho * 0.9, 620), h: Math.min(alto * 0.66, 640), y: alto * 0.1 };
  ventana.x = (ancho - ventana.w) / 2;
  const limitar = (n, min, max) => Math.max(min, Math.min(max, n));

  function aplicar(x, y, w, h, desdeEsquina = false) {
    const W = zona.clientWidth;
    const H = zona.clientHeight;
    const minW = Math.min(W, 244);
    const minH = Math.min(H, 212);
    ventana.w = limitar(w, minW, desdeEsquina ? Math.max(minW, W - x) : W);
    ventana.h = limitar(h, minH, desdeEsquina ? Math.max(minH, H - y) : H);
    ventana.x = limitar(x, 0, W - ventana.w);
    ventana.y = limitar(y, 0, H - ventana.h);
    Object.assign(capa.style, { left: `${ventana.x}px`, top: `${ventana.y}px`, width: `${ventana.w}px`, height: `${ventana.h}px` });
  }
  aplicar(ventana.x, ventana.y, ventana.w, ventana.h);

  function enganchar(control, cambiarTamano) {
    let inicio;
    control.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || inicio) return;
      inicio = { ...ventana, id: event.pointerId, px: event.clientX, py: event.clientY };
      control.setPointerCapture(event.pointerId);
    });
    control.addEventListener('pointermove', (event) => {
      if (inicio?.id !== event.pointerId) return;
      const dx = event.clientX - inicio.px;
      const dy = event.clientY - inicio.py;
      if (cambiarTamano) aplicar(inicio.x, inicio.y, inicio.w + dx, inicio.h + dy, true);
      else aplicar(inicio.x + dx, inicio.y + dy, inicio.w, inicio.h);
    });
    control.addEventListener('lostpointercapture', () => { inicio = null; });
  }
  enganchar(enc, false);
  enganchar(capa.querySelector('.visor-tirador'), true);
  enc.tabIndex = 0;
  enc.setAttribute('aria-label', `${enc.textContent}. Usa las flechas del teclado para mover la ventana.`);
  enc.addEventListener('keydown', (event) => {
    const movimiento = { ArrowUp: [0, -16], ArrowDown: [0, 16], ArrowLeft: [-16, 0], ArrowRight: [16, 0] }[event.key];
    if (!movimiento) return;
    event.preventDefault();
    aplicar(ventana.x + movimiento[0], ventana.y + movimiento[1], ventana.w, ventana.h);
  });
  for (const [accion, factor] of [['reducir', 0.8], ['ampliar', 1.25]]) {
    capa.querySelector(`[data-accion="${accion}"]`).addEventListener('click', () => {
      aplicar(ventana.x, ventana.y, ventana.w * factor, ventana.h * factor);
    });
  }
  const observador = new ResizeObserver(() => aplicar(ventana.x, ventana.y, ventana.w, ventana.h));
  observador.observe(zona);
  signal.addEventListener('abort', () => observador.disconnect(), { once: true });
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
  const visor = crearCapa(titulo);
  await mostrarPdf(url, visor);
  return visor.cerrar;
}

export function abrirInformacionFlotante(url, titulo, tipoMime, alCerrar) {
  const visor = crearCapa(titulo, { flotante: true, alCerrar });
  if (tipoMime === 'application/pdf') {
    mostrarPdf(url, visor);
  } else {
    const video = document.createElement('video');
    video.className = 'visor-video';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener('error', () => mostrarAviso(visor.marco, 'No se pudo reproducir el vídeo en este dispositivo.'));
    visor.signal.addEventListener('abort', () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }, { once: true });
    visor.marco.replaceChildren(video);
    video.src = url;
  }
  return visor.cerrar;
}

function mostrarAviso(contenedor, mensaje) {
  const p = document.createElement('p');
  p.className = 'visor-cargando';
  p.textContent = mensaje;
  contenedor.replaceChildren(p);
}

async function mostrarPdf(url, { capa, marco, contenido, signal }) {
  const pie = capa.querySelector('.visor-pie');
  const txtPagina = capa.querySelector('.visor-pagina');
  mostrarAviso(contenido, 'Cargando PDF…');
  const zoom = hacerZoomable(marco, contenido);
  let carga, doc, tareaActual, observador, tiempo;
  let solicitud = 0;
  signal.addEventListener('abort', () => {
    clearTimeout(tiempo);
    observador?.disconnect();
    tareaActual?.cancel();
    carga?.destroy().catch(() => {});
  }, { once: true });
  try {
    const datos = await (await fetch(url, { signal })).arrayBuffer();
    if (signal.aborted) return;
    const base = import.meta.env.BASE_URL;
    carga = pdfjs.getDocument({
      data: datos,
      // Fuentes y tablas incluidas en la app, para que funcione sin internet
      cMapUrl: base + 'pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: base + 'pdfjs/standard_fonts/',
    });
    doc = await carga.promise;
  } catch (e) {
    if (!signal.aborted) mostrarAviso(contenido, 'No se pudo abrir el PDF. ' + e.message);
    return;
  }
  if (signal.aborted) return;

  let pagina = 1;
  pie.hidden = doc.numPages < 2;

  async function dibujarPagina(turno) {
    txtPagina.textContent = `Página ${pagina} de ${doc.numPages}`;
    tareaActual?.cancel();
    const pag = await doc.getPage(pagina);
    if (signal.aborted || turno !== solicitud || !marco.clientWidth || !marco.clientHeight) return;
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
    tareaActual = pag.render({ canvasContext: lienzo.getContext('2d'), viewport: vp });
    await tareaActual.promise;
    if (signal.aborted || turno !== solicitud) return;
    contenido.replaceChildren(lienzo);
    zoom.restablecer();
  }

  function dibujar() {
    const turno = ++solicitud;
    dibujarPagina(turno).catch((error) => {
      if (!signal.aborted && turno === solicitud && error.name !== 'RenderingCancelledException') {
        mostrarAviso(contenido, 'No se pudo mostrar la página del PDF.');
      }
    });
  }

  capa.querySelector('[data-accion="anterior"]').addEventListener('click', () => {
    if (pagina > 1) { pagina--; dibujar(); }
  });
  capa.querySelector('[data-accion="siguiente"]').addEventListener('click', () => {
    if (pagina < doc.numPages) { pagina++; dibujar(); }
  });
  observador = new ResizeObserver(() => {
    clearTimeout(tiempo);
    tiempo = setTimeout(dibujar, 80);
  });
  observador.observe(marco);
}
