// Bloque del recorrido con LiDAR de un paso (se prepara solo al abrir el paso):
//   1) botón verde grande: abre el AR de Apple; al ver el QR del ancla pone encima un ancla 3D,
//      las flechas por el camino exacto y, al final, la información del elemento.
//   2) respaldo: colocar a mano (si no detecta el QR).
//   3) ajustes del QR: en el suelo / en la pared, y girar si las flechas salen giradas.
import { crearEnlaceAR, hayQuickLook } from './boton-ar.js';
import { leerAjustes, guardarAjustes } from '../ajustes.js';
import { anchoMarcadorCm } from './marcador.js';
import { numero } from '../coordenadas.js';

const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esAppInstalada = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const urlsVivas = new Set();

/** Ajustes del QR de un ancla para el LiDAR (se guardan en este móvil). */
export function ajustesQRLidar(anclaId) {
  const a = leerAjustes();
  return {
    colocacion: (a.lidarColocacion || {})[anclaId] || 'suelo',
    giro: Number((a.lidarGiro || {})[anclaId] || 0),
    vista: a.lidarVista === 'linea' ? 'linea' : 'flechas',
    unidad: a.lidarUnidad || 'cm',
    anchoReal: Number((a.lidarAncho || {})[anclaId]) || null,
  };
}
function guardarAjusteQR(anclaId, campo, valor) {
  const a = leerAjustes();
  if (campo === 'vista') { guardarAjustes({ lidarVista: valor }); return; }
  const clave = campo === 'colocacion' ? 'lidarColocacion' : campo === 'ancho' ? 'lidarAncho' : 'lidarGiro';
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
    <div class="lidar-medida">
      <label>📏 Medida real del MARCADOR impreso, en cm (el cuadro entero, de borde negro a borde negro)
        <input inputmode="decimal" data-q="ancho"></label>
      <p class="nota medida-nota"></p>
    </div>
    <div class="lidar-boton"></div>
    <ol class="pasos-lidar">
      <li>Ponte <b>detrás del marcador</b> del ancla, mirando hacia donde apunta <b>"▲ ADELANTE"</b>.</li>
      <li>Apunta el <b>centro de la pantalla al centro del QR</b> y toca el botón verde: el ⚓ y el recorrido salen ahí, mirando hacia donde miras tú.</li>
      <li>Si el <b>cuadro blanco</b> no coincide con el borde del marcador: <b>arrastra con un dedo</b> y <b>gira con dos</b> hasta que coincida (la flecha azul sobre "▲ ADELANTE").</li>
      <li>Camina siguiendo el recorrido hasta la información del elemento.</li>
    </ol>
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
  selVista.value = aj.vista === 'linea' ? 'linea' : 'flechas';
  const boton = div.querySelector('.lidar-boton'), mano = div.querySelector('.lidar-mano');
  // Medida real del marcador: el AR de Apple necesita la medida EXACTA del papel (la impresora puede cambiarla)
  const anchoTeorico = anchoMarcadorCm(ladoCm);
  const inAncho = div.querySelector('[data-q="ancho"]');
  inAncho.value = String(aj.anchoReal || anchoTeorico).replace('.', ',');
  const anchoReal = () => { const n = numero(inAncho.value); return n > 2 && n < 200 ? n : null; };
  const notaMedida = () => {
    const n = anchoReal();
    div.querySelector('.medida-nota').textContent = !n ? '⚠️ Escribe un número (cm).'
      : Math.abs(n - anchoTeorico) > 0.3 ? `Impreso a otro tamaño: se usará ${String(n).replace('.', ',')} cm (el PDF lo hace de ${String(anchoTeorico).replace('.', ',')} cm).`
        : `Correcto si con la regla mide ${String(anchoTeorico).replace('.', ',')} cm.`;
  };
  notaMedida();

  let turno = 0;
  async function preparar() {
    const mio = ++turno;
    boton.innerHTML = '<p class="nota">⏳ Preparando el recorrido con LiDAR…</p>';
    mano.innerHTML = '';
    try {
      const THREE = await import('three');
      const { usdzPaso } = await import('./recorrido-lidar.js');
      const pts = puntos.map((q) => new THREE.Vector3(q[0], q[1], q[2]));
      const comunes = { textoQR: 'INFOLENS:' + anclaId, ladoCm, colocacion: selCol.value, giro: Number(selGiro.value), vista: selVista.value, unidad: aj.unidad || 'cm', anchoRealCm: anchoReal() };
      const [qr, suelo] = await Promise.all([usdzPaso(pts, info, { ...comunes, modo: 'qr' }), usdzPaso(pts, info, { ...comunes, modo: 'suelo' })]);
      if (mio !== turno) return;
      for (const u of urlsVivas) URL.revokeObjectURL(u);
      urlsVivas.clear();
      const uQR = URL.createObjectURL(qr), uSuelo = URL.createObjectURL(suelo);
      urlsVivas.add(uQR); urlsVivas.add(uSuelo);
      boton.innerHTML = '';
      boton.appendChild(crearEnlaceAR({ url: uSuelo, texto: '🧭 Ver recorrido con LiDAR' }).enlace);
      mano.innerHTML = '<details class="lidar-ajustes"><summary>🧪 Prueba: detección automática del marcador</summary><p class="nota">Todavía no funciona en el iPhone: el AR de Apple ignora el marcador y lo pone en el centro de la pantalla.</p></details>';
      mano.querySelector('details').appendChild(crearEnlaceAR({ url: uQR, texto: '🧪 Detectar el marcador (prueba)', tamano: 'grande' }).enlace);
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
  let esperaMedida = 0;
  inAncho.addEventListener('input', () => {
    notaMedida();
    clearTimeout(esperaMedida);
    esperaMedida = setTimeout(() => {
      const n = anchoReal();
      if (!n) return;
      if (!fijos) guardarAjusteQR(anclaId, 'ancho', n);
      preparar();
      pintarSafari();
    }, 700);
  });

  // Desde la app instalada puede que el AR de Apple no se abra: opción de abrirlo en Safari
  function pintarSafari() {
    const s = div.querySelector('.lidar-safari');
    if (!(esIOS() && esAppInstalada())) { s.innerHTML = ''; return; }
    s.innerHTML = '<p class="nota">Si desde la app instalada el botón verde no hace nada:</p><a class="boton secundario enlace-boton" target="_blank" rel="noopener">🧭 Abrir este recorrido en Safari</a>';
    s.querySelector('a').href = direccionSafari({
      p: puntos, i: info, a: anclaId, l: ladoCm, c: selCol.value, g: Number(selGiro.value), w: anchoReal(), v: selVista.value,
    });
  }
  pintarSafari();
  preparar();
  return div;
}
