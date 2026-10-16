// CENTRAR EL QR antes de abrir el AR de Apple (LiDAR):
// cámara a pantalla completa con un recuadro amarillo en el centro. El usuario centra el QR del ancla
// dentro del recuadro (con "▲ ADELANTE" hacia arriba) y pulsa "⚓ Anclar": se abre el AR de Apple, que
// coloca el recorrido donde apunta el centro de la pantalla (encima del QR) y mirando hacia donde mira
// el usuario (hacia ADELANTE). La cámara de la app se apaga justo al pulsar: si no, el AR de Apple se
// abriría sin realidad aumentada.
import { crearEnlaceAR } from '../ar/boton-ar.js';

export function abrirCentrarQR(url) {
  const capa = document.createElement('div');
  capa.className = 'centrar-qr';
  capa.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="cq-cartel">Centra el <b>QR del ancla</b> dentro del <b>recuadro amarillo</b>, con <b>▲ ADELANTE</b> hacia arriba.
      Cuando esté centrado, pulsa <b>⚓ Anclar</b> sin mover el móvil.</div>
    <div class="cq-recuadro"><span>▲ ADELANTE</span></div>
    <div class="cq-abajo"><div class="cq-anclar"></div><button class="boton secundario" data-c="cerrar">Cancelar</button></div>`;
  document.body.appendChild(capa);
  const video = capa.querySelector('video');
  let stream = null, cerrado = false;
  const apagar = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  };
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    apagar();
    window.removeEventListener('infolens-abrir-ar', alAnclar);
    capa.remove();
  };
  // Al tocar "⚓ Anclar" (enlace al AR de Apple): soltar la cámara YA y cerrar esta pantalla poco después
  const alAnclar = () => { apagar(); setTimeout(cerrar, 800); };
  window.addEventListener('infolens-abrir-ar', alAnclar);
  capa.querySelector('[data-c="cerrar"]').addEventListener('click', cerrar);
  capa.querySelector('.cq-anclar').appendChild(crearEnlaceAR({ url, texto: '⚓ Anclar' }).enlace);
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (cerrado) { apagar(); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (e) {
      capa.querySelector('.cq-cartel').textContent = '⚠️ No se pudo abrir la cámara (' + (e && e.message ? e.message : e) + '). Puedes pulsar ⚓ Anclar igualmente y colocarlo con los dedos.';
    }
  })();
  return cerrar;
}
