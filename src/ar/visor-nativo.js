// Enlace a la app nativa "InfoLens Visor" (ARKit + LiDAR + seguimiento del QR del ancla).
// Le pasa el recorrido dentro de la dirección: infolens://ruta?d={p, i, a, l, v, q}
//   q = los módulos del QR del ancla tal como se imprime ("N:hex"), para que ARKit reconozca EXACTAMENTE ese QR.
import QRCode from 'qrcode';

export function tieneARKitIntegrado() {
  return typeof window.webkit?.messageHandlers?.infolens?.postMessage === 'function';
}

export function enviarARKit(mensaje) {
  window.webkit.messageHandlers.infolens.postMessage(mensaje);
}

export function tieneVisorNativo() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function modulosQR(texto) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  let hex = '', acc = 0, k = 0;
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < n; c++) {
      acc = (acc << 1) | (qr.modules.get(f, c) ? 1 : 0);
      if (++k === 4) { hex += acc.toString(16); acc = 0; k = 0; }
    }
  }
  if (k) hex += (acc << (4 - k)).toString(16);
  return `${n}:${hex}`;
}

/** puntos: [[x,y,z]…] en metros desde el QR (el primero [0,0,0]). */
export function datosDelVisor({ puntos, info, anclaId, ladoCm, vista = 'flechas', flechas, icono, posIcono }) {
  const redondo = (n) => Math.round(n * 1000) / 1000;
  return {
    p: puntos.map((q) => q.map(redondo)),
    ...(info ? { i: info } : {}),
    a: anclaId,
    l: ladoCm,
    v: vista,
    q: modulosQR('INFOLENS:' + anclaId),
    ...(typeof flechas === 'boolean' ? { flechas } : {}),
    ...(typeof icono === 'boolean' ? { icono } : {}),
    ...(posIcono ? { posIcono } : {}),
  };
}

export function direccionVisor(datos) {
  return 'infolens://ruta?d=' + encodeURIComponent(JSON.stringify(datosDelVisor(datos)));
}

/** Botón-enlace para abrir el visor nativo. */
export function botonVisor(datos, texto = '📱 Abrir en el visor nativo (sigue al QR)') {
  const a = document.createElement('a');
  a.className = 'boton secundario enlace-boton';
  a.textContent = texto;
  a.href = direccionVisor(datos);
  if (tieneARKitIntegrado()) {
    a.addEventListener('click', (evento) => {
      evento.preventDefault();
      const recorrido = JSON.parse(new URL(a.href).searchParams.get('d'));
      enviarARKit({ accion: 'prueba', recorrido });
    });
  }
  return a;
}
