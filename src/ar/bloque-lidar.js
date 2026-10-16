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
    vista: a.lidarVista || 'ambas',
  };
}
function guardarAjusteQR(anclaId, campo, valor) {
  const a = leerAjustes();
  if (campo === 'vista') { guardarAjustes({ lidarVista: valor }); return; }
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
      <select data-q="vista"><option value="ambas">⚓ Ancla + flechas + línea</option><option value="flechas">⚓ Ancla + solo flechas</option><option value="linea">⚓ Ancla + solo línea verde</option></select></label>
    <div class="lidar-boton"></div>
    <p class="nota">Al abrir, <b>apunta al QR del ancla</b>: aparece un ⚓ ancla 3D encima y las flechas hasta el elemento,
      con su información al final. Luego camina siguiendo las flechas.</p>
    <div class="lidar-mano"></div>
    <details class="lidar-ajustes">
      <summary>⚙️ Si las flechas salen giradas o en la pared</summary>
      <label>El QR del ancla está
        <select data-q="colocacion"><option value="suelo">En el suelo o en una mesa</option><option value="pared">En una pared</option></select></label>
      <label>Girar el recorrido sobre el QR
        <select data-q="giro"></select></label>
    </details>
    <div class="lidar-safari"></div>`;
  const aj = fijos || ajustesQRLidar(anclaId);
  const selCol = div.querySelector('[data-q="colocacion"]'), selGiro = div.querySelector('[data-q="giro"]');
  // Giro en pasos de 5°: positivo = a la izquierda (visto desde arriba), negativo = a la derecha
  for (let gr = -175; gr <= 180; gr += 5) {
    const o = document.createElement('option');
    o.value = String(gr);
    o.textContent = gr === 0 ? 'Sin girar' : gr === 180 ? '180° (media vuelta)' : `${Math.abs(gr)}° a la ${gr > 0 ? 'izquierda' : 'derecha'}`;
    selGiro.appendChild(o);
  }
  selCol.value = aj.colocacion;
  const g0 = ((Math.round(aj.giro / 5) * 5 + 540) % 360) - 180;
  selGiro.value = String(g0 === -180 ? 180 : g0);
  const selVista = div.querySelector('[data-q="vista"]');
  selVista.value = aj.vista || 'ambas';
  const boton = div.querySelector('.lidar-boton'), mano = div.querySelector('.lidar-mano');

  let turno = 0;
  async function preparar() {
    const mio = ++turno;
    boton.innerHTML = '<p class="nota">⏳ Preparando el recorrido con LiDAR…</p>';
    mano.innerHTML = '';
    try {
      const THREE = await import('three');
      const { usdzPaso } = await import('./recorrido-lidar.js');
      const pts = puntos.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
      const comunes = { textoQR: 'INFOLENS:' + anclaId, ladoCm, colocacion: selCol.value, giro: Number(selGiro.value), vista: selVista.value };
      const [qr, suelo] = await Promise.all([usdzPaso(pts, info, { ...comunes, modo: 'qr' }), usdzPaso(pts, info, { ...comunes, modo: 'suelo' })]);
      if (mio !== turno) return;
      for (const u of urlsVivas) URL.revokeObjectURL(u);
      urlsVivas.clear();
      const uQR = URL.createObjectURL(qr), uSuelo = URL.createObjectURL(suelo);
      urlsVivas.add(uQR); urlsVivas.add(uSuelo);
      boton.innerHTML = '';
      boton.appendChild(crearEnlaceAR({ url: uQR, texto: '🧭 Ver recorrido con LiDAR (apunta al QR)' }).enlace);
      mano.innerHTML = '<p class="nota">¿No detecta el QR? Ábrelo así y coloca el ⚓ ancla encima del QR con los dedos (arrastra con uno, gira con dos):</p>';
      mano.appendChild(crearEnlaceAR({ url: uSuelo, texto: '✋ Colocar a mano sobre el QR', tamano: 'grande' }).enlace);
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
  const alCambiar = (campo, sel) => () => {
    if (!fijos) guardarAjusteQR(anclaId, campo, campo === 'giro' ? Number(sel.value) : sel.value);
    preparar();
    pintarSafari();
  };
  selCol.addEventListener('change', alCambiar('colocacion', selCol));
  selGiro.addEventListener('change', alCambiar('giro', selGiro));
  selVista.addEventListener('change', () => { guardarAjusteQR(anclaId, 'vista', selVista.value); preparar(); });

  // Desde la app instalada puede que el AR de Apple no se abra: opción de abrirlo en Safari
  function pintarSafari() {
    const s = div.querySelector('.lidar-safari');
    if (!(esIOS() && esAppInstalada())) { s.innerHTML = ''; return; }
    s.innerHTML = '<p class="nota">Si desde la app instalada el botón verde no hace nada:</p><a class="boton secundario enlace-boton" target="_blank" rel="noopener">🧭 Abrir este recorrido en Safari</a>';
    s.querySelector('a').href = direccionSafari({
      p: puntos, i: info, a: anclaId, l: ladoCm, c: selCol.value, g: Number(selGiro.value),
    });
  }
  pintarSafari();
  preparar();
  return div;
}
