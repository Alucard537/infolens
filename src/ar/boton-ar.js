// Enlace con forma de botón para abrir AR Quick Look (el AR de Apple con LiDAR).
// Apple exige que el enlace <a rel="ar"> tenga DENTRO SOLO UNA IMAGEN. Por eso el texto del botón
// se dibuja en una imagen. Archivo ligero (sin three.js): se usa también en la pantalla de inicio.

export function hayQuickLook() {
  try {
    const a = document.createElement('a');
    return !!(a.relList && a.relList.supports && a.relList.supports('ar'));
  } catch {
    return false; // algunos navegadores lanzan un error en vez de responder "no"
  }
}

/** Dibuja un botón con texto y devuelve su imagen (data URL). */
function imagenBoton(texto, { ancho, alto, fondo, color, tamLetra }) {
  const k = 2; // nítido en pantallas Retina
  const c = document.createElement('canvas');
  c.width = ancho * k; c.height = alto * k;
  const g = c.getContext('2d');
  g.scale(k, k);
  g.fillStyle = fondo;
  const r = Math.min(14, alto / 2);
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(ancho, 0, ancho, alto, r); g.arcTo(ancho, alto, 0, alto, r);
  g.arcTo(0, alto, 0, 0, r); g.arcTo(0, 0, ancho, 0, r); g.closePath(); g.fill();
  g.fillStyle = color;
  g.font = `700 ${tamLetra}px -apple-system, system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(texto, ancho / 2, alto / 2 + 1, ancho - 16);
  return c.toDataURL('image/png');
}

const ESTILOS = {
  grande: { ancho: 560, alto: 64, fondo: '#34c759', color: '#062b12', tamLetra: 20 },
  pequeno: { ancho: 200, alto: 40, fondo: '#34c759', color: '#062b12', tamLetra: 15 },
  apagado: { fondo: '#3a4a56', color: '#c8d3db' },
};

/**
 * Crea el enlace-botón. url puede ponerse después con poner(url) (mientras, el botón está apagado).
 * titulo/subtitulo: barra superior de Quick Look con el botón "Ver detalle" (alPulsar).
 */
export function crearEnlaceAR({ url = '', texto, tamano = 'grande', titulo, subtitulo, alPulsar } = {}) {
  const base = ESTILOS[tamano] || ESTILOS.grande;
  const a = document.createElement('a');
  a.rel = 'ar';
  a.className = `enlace-ar enlace-ar-${tamano}`;
  const img = document.createElement('img');
  img.alt = texto || '';
  a.appendChild(img); // ÚNICO hijo: una imagen
  let listo = false;
  const pintar = (t) => {
    img.src = imagenBoton(t, listo ? base : { ...base, ...ESTILOS.apagado });
    img.alt = t;
  };
  const params = titulo
    ? '#' + new URLSearchParams({ callToAction: 'Ver detalle', checkoutTitle: titulo, checkoutSubtitle: subtitulo || '' })
      .toString().replace(/\+/g, '%20')
    : '';
  let textoActual = texto || '🧊 Anclar con LiDAR';
  const poner = (u, t) => {
    listo = true;
    a.href = u + params;
    if (t) textoActual = t;
    pintar(textoActual);
  };
  a.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!listo) { e.preventDefault(); return; }
    // Si la app está usando la cámara, el AR de Apple se abre SIN realidad aumentada: hay que soltarla antes
    window.dispatchEvent(new CustomEvent('infolens-abrir-ar'));
  });
  a.addEventListener('message', (e) => {
    if (e.data === '_apple_ar_quicklook_button_tapped' && alPulsar) alPulsar();
  });
  if (url) poner(url); else pintar(textoActual);
  return { enlace: a, poner, texto: (t) => { textoActual = t; pintar(t); } };
}
