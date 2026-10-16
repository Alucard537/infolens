// DETECCIÓN DEL QR DEL ANCLA antes de mostrar nada en 3D (modos ANCLA y GUÍA):
//  1) 'qr'      → no se dibuja nada: "Busca el QR del ancla".
//  2) 'estable' → QR detectado: su borde se marca con líneas discontinuas AMARILLAS. Con el móvil quieto
//                 se mide cómo está colocado el QR ("arriba" en coordenadas del QR).
//  3) 'listo'   → QR bien definido: el borde pasa a VERDE y aparecen, centrados y alineados con el QR,
//                 el ⚓ ancla 3D y el recorrido. Desde ese momento ADELANTE / DERECHA / ARRIBA dependen
//                 SOLO de la posición del QR.
import * as THREE from 'three';
import { gravedadEnQR, colocacionQR } from './navegacion.js';

const MUESTRAS = 30;            // ~1 s de medidas con el QR a la vista
const DISPERSION_MAX = 3;       // grados: si las medidas varían más, el móvil se está moviendo

const TEXTO_COLOCACION = {
  suelo: 'QR en el suelo o en una mesa',
  techo: 'QR en el techo',
  pared: 'QR en una pared',
};

export function crearEscaneo({ panel, seguidos, capa, alMedir, alReiniciar }) {
  let fase = 'qr';
  let anclaId = null;
  let muestras = [];
  let medida = null;            // { id, g: [x, y, z], colocacion }
  let pintada = '';
  const media = new THREE.Vector3();
  let vistoAhora = false;

  function pintar() {
    if (fase === pintada) return;
    pintada = fase;
    panel.hidden = fase === 'listo';
    if (fase === 'listo') return;
    panel.innerHTML = fase === 'qr'
      ? '<div class="rec-titulo">🔍 Busca el QR del ancla</div><p class="esc-texto">Apunta la cámara al QR del ancla. Hasta que no lo detecte no aparece nada en 3D.</p>'
      : `<div class="rec-titulo">✅ QR detectado</div>
         <p class="esc-texto">Mantén el móvil <b>quieto</b> un momento mirando el QR (a 30–80 cm). Cuando el borde se ponga <b>verde</b>, aparecerá el modelo 3D centrado en el QR.</p>
         <div class="barra-progreso"><div></div></div><p class="nota esc-detalle"></p>`;
  }
  function progreso(v, detalle) {
    const b = panel.querySelector('.barra-progreso > div');
    if (b) b.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
    const d = panel.querySelector('.esc-detalle');
    if (d && d.textContent !== detalle) d.textContent = detalle;
  }

  function reiniciar() {
    fase = 'qr'; anclaId = null; muestras = []; medida = null; pintada = '';
    capa.fijarGravedad(null);
    capa.forzarEjes = false;
    alReiniciar?.();
    pintar();
  }

  /** Cada fotograma. Devuelve true cuando el QR está bien definido y ya se puede mostrar el 3D. */
  function actualizar(arriba, ahora) {
    const conQR = (s) => !!(s && s.tipo === 'ancla-activa' && s.vistoQR && ahora - s.vistoQR < 250);
    if (fase === 'qr') {
      const s = [...seguidos.values()].find(conQR);
      if (s) { anclaId = s.id; fase = 'estable'; muestras = []; }
    }
    const sa = anclaId ? seguidos.get(anclaId) : null;
    vistoAhora = conQR(sa);
    if (fase === 'estable') {
      if (vistoAhora) {
        muestras.push(gravedadEnQR(sa.rot, arriba));
        if (muestras.length > MUESTRAS) muestras.shift();
      }
      media.set(0, 0, 0);
      for (const m of muestras) media.add(m);
      media.normalize();
      let peor = 0;
      for (const m of muestras) peor = Math.max(peor, THREE.MathUtils.radToDeg(m.angleTo(media)));
      const lleno = muestras.length >= MUESTRAS;
      if (lleno && peor <= DISPERSION_MAX) {
        const g = [media.x, media.y, media.z];
        medida = { id: anclaId, g, colocacion: colocacionQR(g) };
        capa.fijarGravedad(anclaId, g);
        alMedir?.(anclaId, g);
        fase = 'listo';
      } else {
        progreso(muestras.length / MUESTRAS * (lleno ? 0.95 : 1),
          !vistoAhora ? '⚠️ Se ha perdido el QR: vuelve a apuntarlo.' : lleno ? 'Te estás moviendo: quédate quieto.' : 'Midiendo…');
      }
    }
    pintar();
    return fase === 'listo';
  }

  pintar();
  return {
    actualizar, reiniciar,
    get listo() { return fase === 'listo'; },
    /** Para dibujar el borde: id del QR del ancla, si se ve ahora y si ya está bien definido. */
    get borde() { return anclaId && vistoAhora ? { id: anclaId, definido: fase === 'listo' } : null; },
    get colocacion() { return medida ? TEXTO_COLOCACION[medida.colocacion] : ''; },
    gravedad(id) { return medida && medida.id === id ? medida.g : null; },
  };
}
