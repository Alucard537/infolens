// Pantalla "Huella para reconocer sin QR".
// - Cada grabación (cámara, vídeos o fotos) se AÑADE a la huella del elemento.
// - "Ver y borrar imágenes" muestra todas las imágenes, agrupadas por grabación, para quitar las malas.
import { obtenerElemento, modificarHuella, obtenerHuella } from '../db.js';
import {
  cargarReconocedor, capturarImagen, fotogramasDeVideo, ajustarGuia,
} from '../reconocer/huella.js';
import {
  anadirAHuella, elegirCapturas, quitarDeHuella, normalizarHuella, posicionesMini,
  MAX_IMAGENES, RECORTE_OBJETO, tieneRecorteObjeto,
} from '../reconocer/vectores.js';
import { cargarSegmentador } from '../reconocer/recorte-objeto.js';

const SEGUNDOS = 15;
const INTERVALO_MS = 400;   // una imagen cada 0,4 s -> unas 37 imágenes por grabación
const DE_VIDEO = 36;        // imágenes que se sacan de cada vídeo
const ORIGEN = { 'cámara': '📷 Cámara', 'vídeo': '🎞️ Vídeo', fotos: '🖼️ Fotos', anterior: '📦 Anterior' };

export function pantallaHuella(app, id, { volver }) {
  let activo = true;
  let stream = null;
  let ocupada = false;
  let grabando = false;
  let parar = false;
  let elementoListo = false;
  let huella = null;     // huella guardada (normalizada)
  const cancelar = new AbortController();
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
        <p class="nota huella-ayuda">Pon el punto central sobre la pieza y deja visibles sus bordes. Graba de frente y
          desde los lados, moviéndote despacio. En fotos y vídeos, coloca la pieza en el centro para recortar el fondo.</p>
        <div class="barra"><div class="barra-relleno"></div></div>
        <div class="botones-archivo">
          <button class="boton" data-accion="grabar" disabled>⏺ Grabar</button>
          <label class="boton secundario">🎞️ Vídeos o fotos
            <input type="file" accept="video/*,image/*" multiple class="entrada-oculta" data-entrada="medios" disabled></label>
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
  const btnGal = $('[data-accion="galeria"]');
  const medios = $('[data-entrada="medios"]');
  const guia = $('.guia-recorte');
  const instruccionesIniciales = 'Permite el uso de la cámara o elige «Vídeos o fotos».';
  const controles = () => {
    btnGrabar.disabled = !elementoListo || !stream || (ocupada && !grabando);
    btnGrabar.textContent = grabando ? '⏹ Parar' : '⏺ Grabar';
    medios.disabled = !elementoListo || ocupada;
    medios.parentElement.classList.toggle('desactivado', medios.disabled);
    btnGal.disabled = ocupada;
  };
  const recolocar = () => ajustarGuia(guia, video);
  video.addEventListener('loadedmetadata', recolocar);
  window.addEventListener('resize', recolocar);
  $('[data-accion="volver"]').addEventListener('click', volver);

  function pintarResumen() {
    const r = $('.huella-resumen');
    if (!huella) { r.textContent = 'Sin huella todavía.'; btnGal.hidden = true; return; }
    const muestras = huella.n === 1 ? '1 imagen' : `${huella.n} imágenes`;
    r.textContent = `${muestras} · ${huella.grabaciones.length} grabación${huella.grabaciones.length === 1 ? '' : 'es'} · máximo ${MAX_IMAGENES}`;
    if (!tieneRecorteObjeto(huella)) r.textContent += ' · Añade tomas para activar el recorte del fondo.';
    btnGal.hidden = false;
    btnGal.textContent = `🖼️ Ver y borrar imágenes (${huella.n})`;
  }

  (async () => {
    const elemento = await obtenerElemento(id);
    huella = normalizarHuella(await obtenerHuella(id));
    if (!activo) return;
    if (!elemento) { estado.textContent = 'El elemento ya no existe.'; return; }
    $('.huella-titulo').textContent = `${elemento.nombre} · ${elemento.id}`;
    pintarResumen();
    elementoListo = true;
    controles();
    estado.textContent = instruccionesIniciales;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (!activo) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (!activo) return;
      controles();
      if (estado.textContent === instruccionesIniciales) estado.textContent = 'Listo para grabar.';
    } catch (e) {
      if (activo && estado.textContent === instruccionesIniciales) estado.textContent = 'Cámara no disponible. Puedes usar «Vídeos o fotos».';
    }
  })();

  async function usarCapturas(capturas, origen, totales) {
    const lista = await Promise.all(capturas.filter((c) => c.v).map(async (c) => ({ v: c.v, mini: await c.mini })));
    if (!activo) return;
    totales.descartadas += capturas.length - lista.length;
    const rechazada = capturas.find((c) => c.motivo);
    if (rechazada) totales.motivo = rechazada.motivo;
    if (!lista.length) return;
    let seleccionadas;
    const nueva = await modificarHuella(id, (anterior) => {
      const libres = Math.max(0, MAX_IMAGENES - (anterior?.n || 0));
      seleccionadas = elegirCapturas(lista, anterior, libres, RECORTE_OBJETO);
      const { elegidas } = seleccionadas;
      return elegidas.length ? anadirAHuella(anterior, id, elegidas, origen, RECORTE_OBJETO) : anterior;
    });
    totales.añadidas += seleccionadas.elegidas.length;
    totales.repetidas += seleccionadas.repetidas;
    totales.sinEspacio += seleccionadas.sinEspacio;
    huella = normalizarHuella(nueva);
    if (activo) pintarResumen();
  }

  async function entrenar(conCamara, recoger) {
    if (ocupada || !elementoListo) return;
    ocupada = true;
    grabando = conCamara;
    parar = false;
    controles();
    barra.style.width = '0%';
    estado.textContent = 'Preparando el reconocimiento…';
    const totales = { añadidas: 0, descartadas: 0, repetidas: 0, sinEspacio: 0, motivo: '' };
    try {
      const embedder = await cargarReconocedor();
      if (!activo) return;
      const segmentador = await cargarSegmentador();
      if (!activo) return;
      if (parar) { estado.textContent = 'Grabación detenida.'; return; }
      const capturar = (fuente, ancho, alto) => capturarImagen(embedder, segmentador, fuente, ancho, alto);
      await recoger(capturar, totales);
      if (!activo) return;
      const { añadidas, descartadas, repetidas, sinEspacio, motivo } = totales;
      const partes = [añadidas === 1 ? 'Guardada 1 imagen.' : añadidas ? `Guardadas ${añadidas} imágenes.` : 'Sin imágenes nuevas.'];
      if (repetidas) partes.push(`${repetidas} ${repetidas === 1 ? 'repetida' : 'repetidas'}. Cambia de ángulo o distancia.`);
      if (descartadas) partes.push(`${descartadas} descartadas por calidad. ${motivo}.`);
      if (sinEspacio) partes.push(`Límite de ${MAX_IMAGENES} imágenes. Borra alguna en la galería para añadir otras.`);
      estado.textContent = partes.join(' ');
    } catch (e) {
      if (activo) estado.textContent = (totales.añadidas ? `Guardadas ${totales.añadidas} imágenes. ` : '') +
        (e?.message || 'No se pudo preparar la grabación.');
    } finally {
      ocupada = grabando = false;
      if (activo) controles();
    }
  }

  btnGrabar.addEventListener('click', () => {
    if (grabando) { parar = true; estado.textContent = 'Guardando las muestras…'; return; }
    entrenar(true, async (capturar, totales) => {
      const capturas = [];
      const inicio = performance.now();
      while (activo && !parar && performance.now() - inicio < SEGUNDOS * 1000) {
        const frac = (performance.now() - inicio) / (SEGUNDOS * 1000);
        barra.style.width = Math.min(100, frac * 100) + '%';
        let motivo = 'Espera a que se vea la cámara';
        if (video.readyState >= 2 && video.videoWidth) {
          const c = capturar(video, video.videoWidth, video.videoHeight);
          capturas.push(c);
          motivo = c.motivo;
        }
        const consejo = motivo || (frac < 0.25 ? 'Vista de frente' : frac < 0.65 ? 'Cambia de ángulo despacio' : 'Cambia un poco la distancia');
        estado.textContent = `${Math.ceil(SEGUNDOS * (1 - frac))} s · ${consejo}`;
        await new Promise((r) => setTimeout(r, INTERVALO_MS));
      }
      grabando = false;
      if (activo) controles();
      await usarCapturas(capturas, 'cámara', totales);
    });
  });

  medios.addEventListener('change', (e) => {
    const archivos = [...(e.target.files || [])];
    e.target.value = '';
    if (!archivos.length) return;
    entrenar(false, async (capturar, totales) => {
      const videos = archivos.filter((f) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(f.name));
      const fotos = archivos.filter((f) => !videos.includes(f));
      // Cada vídeo es una grabación distinta; todas las fotos elegidas juntas, otra
      for (let k = 0; k < videos.length; k++) {
        if (!activo) return;
        const capturas = [];
        await fotogramasDeVideo(videos[k], DE_VIDEO, (fuente, w, h, i, n) => {
          capturas.push(capturar(fuente, w, h));
          estado.textContent = `Leyendo vídeo ${k + 1} de ${videos.length}… ${i + 1}/${n}`;
          barra.style.width = ((i + 1) / n) * 100 + '%';
        }, cancelar.signal);
        await usarCapturas(capturas, 'vídeo', totales);
      }
      if (fotos.length) {
        const capturas = [];
        for (let i = 0; i < fotos.length; i++) {
          if (!activo) return;
          const bmp = await createImageBitmap(fotos[i]);
          try {
            if (!activo) return;
            capturas.push(capturar(bmp, bmp.width, bmp.height));
          } finally {
            bmp.close();
          }
          estado.textContent = `Leyendo fotos… ${i + 1} de ${fotos.length}`;
          barra.style.width = ((i + 1) / fotos.length) * 100 + '%';
        }
        await usarCapturas(capturas, 'fotos', totales);
      }
    });
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
      const recorte = g.recorte === RECORTE_OBJETO ? ' · Fondo recortado' : '';
      cab.querySelector('.galeria-cab-txt').textContent = `${ORIGEN[g.origen] || g.origen} · ${fecha} · ${indices.length} imágenes${recorte}`;
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
  async function borrar(registros) {
    if (ocupada || !huella) return;
    const fecha = huella.fecha;
    ocupada = true;
    controles();
    try {
      let actualizada = false;
      const nueva = await modificarHuella(id, (anterior) => {
        actualizada = !anterior || anterior.fecha !== fecha;
        if (actualizada) return anterior;
        return registros ? quitarDeHuella(anterior, registros) : null;
      });
      huella = normalizarHuella(nueva);
      if (!activo) return;
      pintarResumen();
      pintarGaleria();
      estado.textContent = actualizada ? 'La huella se ha actualizado. Revisa la selección.'
        : huella ? `Quedan ${huella.n} imágenes.` : 'Huella borrada.';
    } catch (e) {
      if (activo) estado.textContent = e.message;
    } finally {
      ocupada = false;
      if (activo) controles();
    }
  }
  btnBorrarSel.addEventListener('click', () => {
    if (seleccion.size && confirm(`¿Borrar ${seleccion.size} imágenes de la huella?`)) borrar(new Set(seleccion));
  });
  $('[data-accion="borrar-todo"]').addEventListener('click', () => {
    if (confirm('¿Borrar la huella entera? Dejará de reconocerse sin QR.')) borrar(null);
  });

  return () => {
    activo = false;
    parar = true;
    cancelar.abort();
    liberarGaleria();
    window.removeEventListener('resize', recolocar);
    if (stream) stream.getTracks().forEach((t) => t.stop());
  };
}
