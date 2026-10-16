// ESCANEO INICIAL DEL ENTORNO (modos ANCLA y GUÍA). Antes de mostrar flechas:
//  1) Encontrar el QR del ancla.
//  2) Medir cómo está colocado el QR (suelo, pared…) con el móvil quieto: se guarda "arriba" en
//     coordenadas del propio QR. Desde ese momento ADELANTE / DERECHA / ARRIBA dependen SOLO de la
//     posición del QR (no se mueven con el sensor).
//  3) Recorrer con la cámara el suelo alrededor del QR y por donde se va a ir: el seguimiento con el
//     entorno aprende puntos de referencia del plano del QR para no perder el ancla.
import * as THREE from 'three';
import { gravedadEnQR, colocacionQR } from './navegacion.js';

const MUESTRAS = 40;            // ~1,5 s de medidas con el QR a la vista
const DISPERSION_MAX = 3;       // grados: si las medidas varían más, el móvil se está moviendo
const PUNTOS_OBJETIVO = 300;    // puntos de referencia del entorno que hay que aprender

const TEXTO_COLOCACION = {
  suelo: 'QR en el SUELO / mesa: ADELANTE = hacia la flecha "▲ ADELANTE" impresa.',
  techo: 'QR en el TECHO: ADELANTE = hacia la flecha "▲ ADELANTE" impresa.',
  pared: 'QR en una PARED: ADELANTE = hacia la pared; DERECHA = derecha del QR.',
};

export function crearEscaneo({ panel, seguidos, capa, conEntorno, infoEntorno, alMedir, alReiniciar }) {
  let fase = 'qr';              // 'qr' → 'quieto' → 'entorno' → 'listo'
  let anclaId = null;
  let muestras = [];
  let medida = null;            // { id, g: [x, y, z], colocacion }
  let pintada = '';
  const media = new THREE.Vector3();

  function pintar() {
    const clave = fase + (medida ? medida.colocacion : '');
    if (clave === pintada) return;
    pintada = clave;
    panel.hidden = fase === 'listo';
    if (fase === 'listo') return;
    const paso = { qr: 1, quieto: 2, entorno: 3 }[fase];
    const textos = {
      qr: 'Apunta al QR del ancla de la máquina.',
      quieto: 'Mantén el móvil QUIETO mirando el QR del ancla (a 30–80 cm). Se está midiendo cómo está colocado.',
      entorno: 'Ahora mueve el móvil DESPACIO: apunta al suelo alrededor del QR y por donde vas a ir, alejándote un poco y volviendo al QR. Así la app aprende referencias para no perder el ancla.',
    };
    panel.innerHTML = `
      <div class="rec-titulo">🛰️ Escaneo del entorno · paso ${paso} de 3</div>
      <p class="esc-texto"></p>
      <div class="barra-progreso"><div></div></div>
      <p class="nota esc-detalle"></p>
      ${medida ? '<p class="nota esc-colocacion"></p>' : ''}
      <div class="botones-archivo">
        ${fase === 'entorno' ? '<button class="boton secundario" data-e="saltar">Saltar (menos preciso)</button>' : ''}
        ${fase !== 'qr' ? '<button class="boton secundario" data-e="repetir">↺ Repetir</button>' : ''}
      </div>`;
    panel.querySelector('.esc-texto').textContent = textos[fase];
    if (medida) panel.querySelector('.esc-colocacion').textContent = `✅ ${TEXTO_COLOCACION[medida.colocacion]} Comprueba que la flecha azul ADELANTE y la roja DERECHA apuntan bien.`;
    panel.querySelector('[data-e="saltar"]')?.addEventListener('click', () => { fase = 'listo'; capa.forzarEjes = false; pintar(); });
    panel.querySelector('[data-e="repetir"]')?.addEventListener('click', reiniciar);
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

  /** Cada fotograma. Devuelve true cuando el escaneo ha terminado. */
  function actualizar(arriba, ahora) {
    if (fase === 'listo') return true;
    const conQR = (s) => s && s.tipo === 'ancla-activa' && ahora - (s.vistoQR || 0) < 250;
    if (fase === 'qr') {
      const s = [...seguidos.values()].find(conQR);
      if (s) { anclaId = s.id; fase = 'quieto'; }
    }
    const sa = anclaId ? seguidos.get(anclaId) : null;
    if (sa) capa.actualizarEjes(arriba, sa);
    if (fase === 'quieto') {
      capa.forzarEjes = true;
      if (conQR(sa)) {
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
        fase = conEntorno() ? 'entorno' : 'listo';
        if (fase === 'listo') capa.forzarEjes = false;
      } else {
        progreso(muestras.length / MUESTRAS * (lleno ? 0.95 : 1),
          !conQR(sa) ? '⚠️ No se ve el QR del ancla.' : lleno ? `Te estás moviendo (${peor.toFixed(1)}°): quédate quieto.` : 'Midiendo…');
      }
    }
    if (fase === 'entorno') {
      const info = infoEntorno() || {};
      const n = info.aprendidos || 0;
      progreso(n / PUNTOS_OBJETIVO, `Referencias aprendidas: ${Math.min(n, PUNTOS_OBJETIVO)} de ${PUNTOS_OBJETIVO}`
        + (n < 20 && ahora % 3000 < 1500 ? ' · si no sube, el suelo tiene poca textura: acércate o enciende la linterna' : ''));
      if (n >= PUNTOS_OBJETIVO) { fase = 'listo'; capa.forzarEjes = false; }
    }
    pintar();
    return fase === 'listo';
  }

  pintar();
  return {
    actualizar, reiniciar,
    get listo() { return fase === 'listo'; },
    /** "Arriba" medido para ese ancla, en coordenadas del QR (o null). */
    gravedad(id) { return medida && medida.id === id ? medida.g : null; },
  };
}
