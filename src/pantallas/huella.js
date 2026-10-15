// Pantalla "Huella para reconocer sin QR".
// - Cada grabación (cámara, vídeos o fotos) se AÑADE a la huella del elemento.
// - "Ver y borrar imágenes" muestra todas las imágenes, agrupadas por grabación, para quitar las malas.
import { obtenerElemento, guardarHuella, obtenerHuella, borrarHuella } from '../db.js';
import {
  cargarReconocedor, capturarImagen, fotogramasDeVideo, ajustarGuia,
} from '../reconocer/huella.js';
import {
  anadirAHuella, quitarDeHuella, normalizarHuella, posicionesMini, MAX_IMAGENES,
} from '../reconocer/vectores.js';

const SEGUNDOS = 15;
const INTERVALO_MS = 400;   // una imagen cada 0,4 s -> unas 37 imágenes por grabación
const DE_VIDEO = 36;        // imágenes que se sacan de cada vídeo
const ORIGEN = { 'cámara': '📷 Cámara', 'vídeo': '🎞️ Vídeo', fotos: '🖼️ Fotos', anterior: '📦 Anterior' };

export function pantallaHuella(app, id, { volver }) {
  let activo = true;
  let stream = null;
  let grabando = false;
  let parar = false;
  let huella = null;     // huella guardada (normalizada)
  let embedder = null;
  const urlsGaleria = [];

  app.innerHTML = `
    <div class="escaner huella">
      <video class="esc-video" playsinline muted autoplay></video>
      <div class="guia-recorte"></div>
      <div class="esc-barra">
        <button class="esc-btn" data-accion="volver" aria-label="Volver">‹</button>
        <div class="esc-estado">Preparando…</div>
      </div>
      <div class="huella-panel">
        <div class="huella-titulo"></div>
        <div class="huella-resumen"></div>
        <p class="nota huella-ayuda">Mete el elemento en el recuadro y pulsa <b>Grabar</b>. Muévete despacio a su alrededor
          (de frente, de lado, cerca y lejos) e incluye lo que lo rodea. Cada grabación se <b>suma</b> a las anteriores:
          graba otro día o con otra luz para que sea más fiable.</p>
        <div class="barra"><div class="barra-relleno"></div></div>
        <div class="botones-archivo">
          <button class="boton" data-accion="grabar" disabled>⏺ Grabar</button>
          <label class="boton secundario">🎞️ Vídeos o fotos
            <input type="file" accept="video/*,image/*" multiple class="entrada-oculta" data-entrada="medios"></label>
        </div>
        <button class="boton secundario" data-accion="galeria" hidden>🖼️ Ver y borrar imágenes</button>
      </div>
      <div class="galeria" hidden>
        <div class="galeria-barra">
          <button class="esc-btn" data-accion="cerrar-galeria" aria-label="Cerrar">✕</button>
          <div class="galeria-titulo">Imágenes de la huella</div>
        </div>
        <p class="nota galeria-ayuda">Toca las imágenes que quieras quitar (borrosas, que no se ve el elemento, de otro sitio…).</p>
        <div class="galeria-contenido"></div>
        <div class="galeria-pie">
          <button class="boton peligro" data-accion="borrar-sel" disabled>🗑️ Borrar seleccionadas</button>
          <button class="quitar" data-accion="borrar-todo">Borrar la huella entera</button>
        </div>
      </div>
    </div>`;
  const $ = (s) => app.querySelector(s);
  const video = $('.esc-video');
  const estado = $('.esc-estado');
  const barra = $('.barra-relleno');
  const btnGrabar = $('[data-accion="grabar"]');
  const guia = $('.guia-recorte');
  const recolocar = () => ajustarGuia(guia, video);
  video.addEventListener('loadedmetadata', recolocar);
  window.addEventListener('resize', recolocar);
  $('[data-accion="volver"]').addEventListener('click', volver);

  function pintarResumen() {
    const r = $('.huella-resumen');
    const btnGal = $('[data-accion="galeria"]');
    if (!huella) { r.textContent = 'Sin huella todavía.'; btnGal.hidden = true; return; }
    r.textContent = `Huella: ${huella.n} imágenes de ${huella.grabaciones.length} grabación${huella.grabaciones.length === 1 ? '' : 'es'} (máximo ${MAX_IMAGENES}).`;
    btnGal.hidden = false;
    btnGal.textContent = `🖼️ Ver y borrar imágenes (${huella.n})`;
  }

  (async () => {
    const elemento = await obtenerElemento(id);
    huella = normalizarHuella(await obtenerHuella(id));
    if (!activo) return;
    $('.huella-titulo').textContent = elemento ? `${elemento.nombre} · ${elemento.id}` : id;
    pintarResumen();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (!activo) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (e) {
      estado.textContent = 'No se pudo abrir la cámara: ' + e.message + '. Puedes usar "Vídeos o fotos".';
    }
    estado.textContent = 'Cargando el reconocimiento… (la primera vez necesita internet)';
    try {
      embedder = await cargarReconocedor();
      if (!activo) return;
      btnGrabar.disabled = !stream;
      estado.textContent = 'Listo para grabar.';
    } catch (e) {
      estado.textContent = 'No se pudo cargar el reconocimiento: ' + (e.message || e) + '. Conéctate a internet y vuelve a entrar.';
    }
  })();

  // Añade las imágenes capturadas a la huella y la guarda
  async function anadir(capturas, origen) {
    const lista = [];
    for (const c of capturas) lista.push({ v: c.v, mini: await c.mini });
    if (!lista.length) throw new Error('No se ha capturado ninguna imagen.');
    const libres = MAX_IMAGENES - (huella ? huella.n : 0);
    if (libres <= 0) throw new Error(`La huella ya tiene ${MAX_IMAGENES} imágenes (el máximo). Borra algunas antes de añadir más.`);
    const usadas = lista.length > libres ? lista.filter((_, i) => i % Math.ceil(lista.length / libres) === 0).slice(0, libres) : lista;
    huella = anadirAHuella(huella, id, usadas, origen);
    await guardarHuella(huella);
    pintarResumen();
    estado.textContent = `✅ Añadidas ${usadas.length} imágenes${usadas.length < lista.length ? ` (de ${lista.length}; se llegó al máximo)` : ''}. Total: ${huella.n}.`;
  }

  btnGrabar.addEventListener('click', async () => {
    if (!embedder) return;
    if (grabando) { parar = true; return; }      // el mismo botón sirve para parar
    grabando = true; parar = false;
    btnGrabar.textContent = '⏹ Parar';
    const capturas = [];
    const inicio = performance.now();
    while (activo && !parar && performance.now() - inicio < SEGUNDOS * 1000) {
      if (video.videoWidth) capturas.push(capturarImagen(embedder, video, video.videoWidth, video.videoHeight));
      const frac = (performance.now() - inicio) / (SEGUNDOS * 1000);
      barra.style.width = Math.min(100, frac * 100) + '%';
      estado.textContent = `Grabando… ${Math.ceil(SEGUNDOS * (1 - frac))} s · ${capturas.length} imágenes`;
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
    }
    grabando = false;
    btnGrabar.textContent = '⏺ Grabar';
    if (!activo) return;
    try { await anadir(capturas, 'cámara'); } catch (e) { estado.textContent = '❌ ' + e.message; }
  });

  app.querySelector('[data-entrada="medios"]').addEventListener('change', async (e) => {
    const archivos = [...(e.target.files || [])];
    e.target.value = '';
    if (!archivos.length) return;
    try {
      if (!embedder) { estado.textContent = 'Cargando el reconocimiento…'; embedder = await cargarReconocedor(); }
      const videos = archivos.filter((f) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(f.name));
      const fotos = archivos.filter((f) => !videos.includes(f));
      // Cada vídeo es una grabación distinta; todas las fotos elegidas juntas, otra
      for (let k = 0; k < videos.length; k++) {
        const capturas = [];
        await fotogramasDeVideo(videos[k], DE_VIDEO, (fuente, w, h, i) => {
          capturas.push(capturarImagen(embedder, fuente, w, h));
          estado.textContent = `Leyendo vídeo ${k + 1} de ${videos.length}… ${i + 1}/${DE_VIDEO}`;
          barra.style.width = ((i + 1) / DE_VIDEO) * 100 + '%';
        });
        await anadir(capturas, 'vídeo');
      }
      if (fotos.length) {
        const capturas = [];
        for (let i = 0; i < fotos.length; i++) {
          const bmp = await createImageBitmap(fotos[i]);
          capturas.push(capturarImagen(embedder, bmp, bmp.width, bmp.height));
          bmp.close && bmp.close();
          estado.textContent = `Leyendo fotos… ${i + 1} de ${fotos.length}`;
        }
        await anadir(capturas, 'fotos');
      }
    } catch (err) {
      estado.textContent = '❌ ' + err.message;
    }
  });

  // ---------- galería: ver y borrar imágenes ----------
  const seleccion = new Set();
  const galeria = $('.galeria');
  const btnBorrarSel = $('[data-accion="borrar-sel"]');
  const actualizarBotonBorrar = () => {
    btnBorrarSel.disabled = seleccion.size === 0;
    btnBorrarSel.textContent = `🗑️ Borrar seleccionadas (${seleccion.size})`;
  };

  function liberarGaleria() {
    urlsGaleria.forEach((u) => URL.revokeObjectURL(u));
    urlsGaleria.length = 0;
  }

  function pintarGaleria() {
    liberarGaleria();
    seleccion.clear();
    actualizarBotonBorrar();
    const cont = $('.galeria-contenido');
    cont.innerHTML = '';
    if (!huella) { cont.innerHTML = '<p class="nota">No hay imágenes.</p>'; return; }
    const pos = posicionesMini(huella);
    huella.grabaciones.forEach((g, gi) => {
      const indices = [];
      for (let i = 0; i < huella.n; i++) if (huella.grupo[i] === gi) indices.push(i);
      if (!indices.length) return;
      const bloque = document.createElement('section');
      bloque.className = 'galeria-grupo';
      const cab = document.createElement('div');
      cab.className = 'galeria-cab';
      const fecha = new Date(g.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
      cab.innerHTML = '<span class="galeria-cab-txt"></span><button class="boton-mini" data-grupo>Marcar todas</button>';
      cab.querySelector('.galeria-cab-txt').textContent = `${ORIGEN[g.origen] || g.origen} · ${fecha} · ${indices.length} imágenes`;
      bloque.appendChild(cab);
      const rejilla = document.createElement('div');
      rejilla.className = 'galeria-rejilla';
      for (const i of indices) {
        const b = document.createElement('button');
        b.className = 'galeria-img';
        if (huella.tamMini[i]) {
          const u = URL.createObjectURL(new Blob([huella.miniaturas.subarray(pos[i], pos[i] + huella.tamMini[i])], { type: 'image/jpeg' }));
          urlsGaleria.push(u);
          const img = document.createElement('img'); img.src = u; img.alt = ''; img.loading = 'lazy';
          b.appendChild(img);
        } else {
          b.textContent = '·'; // huellas antiguas, sin miniatura
        }
        b.addEventListener('click', () => {
          if (seleccion.has(i)) seleccion.delete(i); else seleccion.add(i);
          b.classList.toggle('marcada', seleccion.has(i));
          actualizarBotonBorrar();
        });
        b.dataset.i = i;
        rejilla.appendChild(b);
      }
      cab.querySelector('[data-grupo]').addEventListener('click', () => {
        const todas = indices.every((i) => seleccion.has(i));
        for (const i of indices) { if (todas) seleccion.delete(i); else seleccion.add(i); }
        rejilla.querySelectorAll('.galeria-img').forEach((el) => el.classList.toggle('marcada', seleccion.has(+el.dataset.i)));
        actualizarBotonBorrar();
      });
      bloque.appendChild(rejilla);
      cont.appendChild(bloque);
    });
  }

  $('[data-accion="galeria"]').addEventListener('click', () => { galeria.hidden = false; pintarGaleria(); });
  $('[data-accion="cerrar-galeria"]').addEventListener('click', () => { galeria.hidden = true; liberarGaleria(); });
  btnBorrarSel.addEventListener('click', async () => {
    if (!seleccion.size || !huella) return;
    if (!confirm(`¿Borrar ${seleccion.size} imágenes de la huella?`)) return;
    huella = quitarDeHuella(huella, seleccion);
    if (huella) await guardarHuella(huella); else await borrarHuella(id);
    pintarResumen();
    pintarGaleria();
    estado.textContent = huella ? `Quedan ${huella.n} imágenes.` : 'Huella borrada.';
  });
  $('[data-accion="borrar-todo"]').addEventListener('click', async () => {
    if (!confirm('¿Borrar la huella entera? Dejará de reconocerse sin QR.')) return;
    await borrarHuella(id);
    huella = null;
    pintarResumen();
    pintarGaleria();
    estado.textContent = 'Huella borrada.';
  });

  return () => {
    activo = false;
    parar = true;
    liberarGaleria();
    window.removeEventListener('resize', recolocar);
    if (stream) stream.getTracks().forEach((t) => t.stop());
  };
}
