// Bloque del recorrido con LiDAR de un paso (se prepara solo al abrir el paso):
//   1) botón verde grande: abre el AR de Apple; al ver el QR del ancla pone encima un ancla 3D,
//      las flechas por el camino exacto y, al final, la información del elemento.
//   2) respaldo: colocar a mano (si no detecta el QR).
//   3) ajustes del QR: en el suelo / en la pared, y girar si las flechas salen giradas.
import { crearEnlaceAR, hayQuickLook } from './boton-ar.js';
import { leerAjustes, guardarAjustes } from '../ajustes.js';

const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esAppInstalada = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const urlsVivas = new Set();

/** Ajustes del QR de un ancla para el LiDAR (se guardan en este móvil). */
export function ajustesQRLidar(anclaId) {
  const a = leerAjustes();
  return {
    colocacion: (a.lidarColocacion || {})[anclaId] || 'suelo',
    giro: Number((a.lidarGiro || {})[anclaId] || 0),
  };
}
function guardarAjusteQR(anclaId, campo, valor) {
  const a = leerAjustes();
  const clave = campo === 'colocacion' ? 'lidarColocacion' : 'lidarGiro';
  guardarAjustes({ [clave]: { ...(a[clave] || {}), [anclaId]: valor } });
}

/** Dirección de la app en Safari con el paso dentro (para la app instalada). */
export function direccionSafari(datos) {
  const base = import.meta.env?.BASE_URL ?? './';
  return new URL(`${base}#/ar?d=${encodeURIComponent(JSON.stringify(datos))}`, location.href).href;
}

/**
 * puntos: [[x,y,z] …] en metros desde el QR (el primero [0,0,0]); info: { nombre, referencia, id, descripcion };
 * anclaId; ladoCm: tamaño impreso del QR; fijos: { colocacion, giro } (si vienen en la dirección).
 */
export function bloquePasoLidar({ puntos, info, anclaId, ladoCm, fijos = null }) {
  const div = document.createElement('div');
  div.className = 'bloque-lidar-guia';
  if (!hayQuickLook() && !esIOS()) {
    div.innerHTML = '<p class="nota">🧊 El recorrido con LiDAR solo se abre en iPhone o iPad.</p>';
    return div;
  }
  div.innerHTML = `
    <label class="lidar-vista">Qué mostrar
      <select data-q="vista"><option value="flechas">⚓ Ancla + flechas</option><option value="linea">⚓ Ancla + línea de un punto a otro</option></select></label>
    <div class="lidar-boton"></div>
    <p class="nota">Apunta al QR del ancla y toca el botón verde: el recorrido aparece ahí. Ajústalo con los dedos
      (uno para mover, dos para girar) hasta que el ⚓ quede encima del QR y las flechas salgan hacia "▲ ADELANTE". Luego camina.</p>
    <div class="lidar-safari"></div>`;
  const aj = fijos || ajustesQRLidar(anclaId);
  const selVista = div.querySelector('[data-q="vista"]');
  const vistaInicial = fijos && fijos.vista ? fijos.vista : leerAjustes().lidarVista;
  selVista.value = vistaInicial === 'linea' ? 'linea' : 'flechas';
  const boton = div.querySelector('.lidar-boton');

  let turno = 0;
  async function preparar() {
    const mio = ++turno;
    boton.innerHTML = '<p class="nota">⏳ Preparando el recorrido con LiDAR…</p>';
    try {
      const THREE = await import('three');
      const { usdzPaso } = await import('./recorrido-lidar.js');
      const pts = puntos.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
      const archivo = await usdzPaso(pts, info, { textoQR: 'INFOLENS:' + anclaId, ladoCm, colocacion: aj.colocacion, giro: aj.giro, vista: selVista.value, modo: 'qr' });
      if (mio !== turno) return;
      for (const u of urlsVivas) URL.revokeObjectURL(u);
      urlsVivas.clear();
      const url = URL.createObjectURL(archivo);
      urlsVivas.add(url);
      boton.innerHTML = '';
      boton.appendChild(crearEnlaceAR({ url, texto: '🧭 Ver recorrido con LiDAR' }).enlace);
    } catch (e) {
      if (mio !== turno) return;
      console.warn('Recorrido LiDAR:', e);
      boton.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'error-form';
      p.textContent = '❌ No se pudo preparar el recorrido: ' + (e && e.message ? e.message : e);
      boton.appendChild(p);
    }
  }
  selVista.addEventListener('change', () => { guardarAjustes({ lidarVista: selVista.value }); preparar(); pintarSafari(); });

  // Desde la app instalada puede que el AR de Apple no se abra: opción de abrirlo en Safari
  function pintarSafari() {
    const s = div.querySelector('.lidar-safari');
    if (!(esIOS() && esAppInstalada())) { s.innerHTML = ''; return; }
    s.innerHTML = '<p class="nota">Si desde la app instalada el botón verde no hace nada:</p><a class="boton secundario enlace-boton" target="_blank" rel="noopener">🧭 Abrir este recorrido en Safari</a>';
    s.querySelector('a').href = direccionSafari({
      p: puntos, i: info, a: anclaId, l: ladoCm, c: aj.colocacion, g: aj.giro, v: selVista.value,
    });
  }
  pintarSafari();
  preparar();
  return div;
}
