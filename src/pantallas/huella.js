// Pantalla "Huella para reconocer sin QR": graba con la cámara (o desde un vídeo / fotos)
// muchas imágenes del elemento desde varios ángulos y guarda su huella visual.
import { obtenerElemento, guardarHuella, obtenerHuella, borrarHuella } from '../db.js';
import {
  cargarReconocedor, huellaDe, empaquetar, fotogramasDeVideo, ajustarGuia,
} from '../reconocer/huella.js';

const SEGUNDOS = 15;
const INTERVALO_MS = 400;   // una imagen cada 0,4 s -> unas 37 imágenes
const DE_VIDEO = 36;        // imágenes que se sacan de un vídeo

export function pantallaHuella(app, id, { volver }) {
  let activo = true;
  let stream = null;
  let grabando = false;

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
        <p class="nota huella-ayuda">Mete el elemento dentro del recuadro y pulsa <b>Grabar</b>. Durante ${SEGUNDOS} segundos
          muévete despacio a su alrededor (de frente, de lado, más cerca y más lejos). Incluye lo que lo rodea:
          ayuda a distinguirlo de otros iguales.</p>
        <div class="barra"><div class="barra-relleno"></div></div>
        <div class="botones-archivo">
          <button class="boton" data-accion="grabar" disabled>⏺ Grabar</button>
          <label class="boton secundario">🎞️ Vídeo o fotos
            <input type="file" accept="video/*,image/*" multiple class="entrada-oculta" data-entrada="medios"></label>
        </div>
        <button class="quitar" data-accion="borrar" hidden>Borrar la huella guardada</button>
      </div>
    </div>`;
  document.body.classList.add('modo-escaner');
  const $ = (s) => app.querySelector(s);
  const video = $('.esc-video');
  const estado = $('.esc-estado');
  const barra = $('.barra-relleno');
  const btnGrabar = $('[data-accion="grabar"]');
  $('[data-accion="volver"]').addEventListener('click', volver);
  const guia = $('.guia-recorte');
  const recolocar = () => ajustarGuia(guia, video);
  video.addEventListener('loadedmetadata', recolocar);
  window.addEventListener('resize', recolocar);

  let embedder = null;
  let elemento = null;

  (async () => {
    elemento = await obtenerElemento(id);
    if (!activo) return;
    $('.huella-titulo').textContent = elemento ? `${elemento.nombre} · ${elemento.id}` : id;
    const previa = await obtenerHuella(id);
    if (previa) {
      $('[data-accion="borrar"]').hidden = false;
      estado.textContent = `Ya tiene huella (${previa.n} imágenes). Puedes grabar otra para sustituirla.`;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (!activo) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (e) {
      estado.textContent = 'No se pudo abrir la cámara: ' + e.message + '. Puedes usar "Vídeo o fotos".';
    }
    estado.textContent = 'Cargando el reconocimiento… (la primera vez necesita internet)';
    try {
      embedder = await cargarReconocedor();
      if (!activo) return;
      btnGrabar.disabled = !stream;
      estado.textContent = previa ? `Ya tiene huella (${previa.n} imágenes). Grabar la sustituye.` : 'Listo para grabar.';
    } catch (e) {
      estado.textContent = 'No se pudo cargar el reconocimiento: ' + (e.message || e) + '. Conéctate a internet y vuelve a entrar.';
    }
  })();

  async function guardar(lista) {
    if (lista.length < 5) throw new Error('Hacen falta al menos 5 imágenes.');
    await guardarHuella({ elementoId: id, ...empaquetar(lista) });
    estado.textContent = `✅ Huella guardada (${lista.length} imágenes).`;
    $('[data-accion="borrar"]').hidden = false;
  }

  btnGrabar.addEventListener('click', async () => {
    if (grabando || !embedder) return;
    grabando = true;
    btnGrabar.disabled = true;
    const lista = [];
    const inicio = performance.now();
    while (activo && performance.now() - inicio < SEGUNDOS * 1000) {
      if (video.videoWidth) lista.push(huellaDe(embedder, video, video.videoWidth, video.videoHeight));
      const frac = (performance.now() - inicio) / (SEGUNDOS * 1000);
      barra.style.width = Math.min(100, frac * 100) + '%';
      estado.textContent = `Grabando… ${Math.ceil(SEGUNDOS * (1 - frac))} s · ${lista.length} imágenes`;
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
    }
    if (!activo) return;
    try { await guardar(lista); } catch (e) { estado.textContent = '❌ ' + e.message; }
    grabando = false;
    btnGrabar.disabled = false;
  });

  app.querySelector('[data-entrada="medios"]').addEventListener('change', async (e) => {
    const archivos = [...(e.target.files || [])];
    e.target.value = '';
    if (!archivos.length) return;
    try {
      if (!embedder) { estado.textContent = 'Cargando el reconocimiento…'; embedder = await cargarReconocedor(); }
      const lista = [];
      const videos = archivos.filter((f) => f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(f.name));
      const fotos = archivos.filter((f) => !videos.includes(f));
      for (const v of videos) {
        await fotogramasDeVideo(v, DE_VIDEO, (fuente, w, h, i) => {
          lista.push(huellaDe(embedder, fuente, w, h));
          estado.textContent = `Leyendo vídeo… ${i + 1} de ${DE_VIDEO}`;
          barra.style.width = ((i + 1) / DE_VIDEO) * 100 + '%';
        });
      }
      for (let i = 0; i < fotos.length; i++) {
        const bmp = await createImageBitmap(fotos[i]);
        lista.push(huellaDe(embedder, bmp, bmp.width, bmp.height));
        bmp.close && bmp.close();
        estado.textContent = `Leyendo fotos… ${i + 1} de ${fotos.length}`;
      }
      await guardar(lista);
    } catch (err) {
      estado.textContent = '❌ ' + err.message;
    }
  });

  $('[data-accion="borrar"]').addEventListener('click', async () => {
    if (!confirm('¿Borrar la huella de este elemento? Dejará de reconocerse sin QR.')) return;
    await borrarHuella(id);
    $('[data-accion="borrar"]').hidden = true;
    estado.textContent = 'Huella borrada.';
  });

  return () => {
    activo = false;
    window.removeEventListener('resize', recolocar);
    if (stream) stream.getTracks().forEach((t) => t.stop());
  };
}
