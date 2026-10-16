// "Anclar con LiDAR": abre el modelo 3D en AR Quick Look, el visor de realidad aumentada de Apple.
// Quick Look usa ARKit y el LiDAR del iPhone: coloca el modelo solo sobre la superficie que hay
// delante (centro de la cámara) y lo deja anclado; el usuario puede arrastrarlo, girarlo o cambiar
// su tamaño para corregirlo. El modelo sale a tamaño real.
//
// El .usdz (formato de Apple) se crea en el propio teléfono a partir del .glb, sin internet.
// El botón es un ENLACE <a rel="ar"> con una imagen dentro: es la forma que Apple exige para que
// Safari abra Quick Look al tocarlo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { obtenerArchivo } from '../db.js';
import { hayQuickLook, crearEnlaceAR } from './boton-ar.js';

const cache = new Map(); // id del archivo .glb -> Promise<blob: URL del .usdz>

export { hayQuickLook };
const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esAppInstalada = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/** Modelo a tamaño real, centrado y apoyado por su base en y = 0. */
export async function modeloNormalizado(blobGlb) {
  const datos = await blobGlb.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(datos, '');
  const modelo = gltf.scene;
  modelo.updateMatrixWorld(true);
  const caja = new THREE.Box3().setFromObject(modelo);
  const centro = caja.getCenter(new THREE.Vector3());
  const raiz = new THREE.Group();
  modelo.position.sub(new THREE.Vector3(centro.x, caja.min.y, centro.z));
  raiz.add(modelo);
  return raiz;
}

async function crearUsdz(blobGlb) {
  const datos = await blobGlb.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(datos, '');
  const modelo = gltf.scene;
  modelo.traverse((o) => {
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { m.side = THREE.FrontSide; }); // USDZ no admite caras dobles
    }
  });
  // Apoyado por su base y centrado: así Quick Look lo pone bien sobre la mesa o el suelo
  modelo.updateMatrixWorld(true);
  const caja = new THREE.Box3().setFromObject(modelo);
  const centro = caja.getCenter(new THREE.Vector3());
  const raiz = new THREE.Group();
  modelo.position.sub(new THREE.Vector3(centro.x, caja.min.y, centro.z));
  raiz.add(modelo);
  const bytes = await new USDZExporter().parseAsync(raiz);
  return new Blob([bytes], { type: 'model/vnd.usdz+zip' });
}

// Dirección del .usdz generado en el móvil para el AR de Apple.
// PROBADO EN EL iPHONE (diagnóstico, 16/10/2026): funciona como dirección TEMPORAL (blob:).
// Guardado en el almacén de la app (Cache Storage) y servido por el service worker NO se abre.
// (Lo que hacía que se abriera sin AR era tener la cámara de la app encendida, no el blob.)
export const CACHE_AR = 'ar-generado';
const temporales = new Map(); // id -> blob: (se libera la anterior del mismo id)
export async function direccionWeb(id, blob) {
  const previa = temporales.get(id);
  if (previa) URL.revokeObjectURL(previa);
  const url = URL.createObjectURL(blob);
  temporales.set(id, url);
  return url;
}

/** Prepara (una vez) el .usdz del modelo de un elemento. Devuelve Promise<URL>. */
export function prepararQuickLook(elemento) {
  if (!cache.has(elemento.modelo3dId)) {
    const p = obtenerArchivo(elemento.modelo3dId).then(async (a) => {
      if (!a) throw new Error('No se encuentra el modelo 3D.');
      return direccionWeb(elemento.modelo3dId, await crearUsdz(a.blob));
    });
    p.catch(() => cache.delete(elemento.modelo3dId)); // si falla, se podrá reintentar
    cache.set(elemento.modelo3dId, p);
  }
  return cache.get(elemento.modelo3dId);
}

/** Nota que explica por qué no se puede usar el LiDAR aquí (o null si sí se puede). */
export function motivoSinLidar(elemento) {
  if (elemento && !elemento.modelo3dId) return 'Este elemento no tiene modelo 3D: el administrador puede añadírselo.';
  if (hayQuickLook()) return null;
  if (esIOS() && esAppInstalada()) return 'El AR con LiDAR no se abre desde la app instalada. Ábrela en Safari (botón de abajo) y usa el botón allí.';
  if (esIOS()) return 'Este iPhone/iPad no permite el AR de Apple (necesita iOS 12 o más moderno).';
  return 'El AR con LiDAR solo funciona en iPhone o iPad.';
}

/**
 * Bloque para "anclar con LiDAR" un elemento: el botón (si se puede) o una explicación clara.
 */
export function bloqueLidar(elemento, { alPulsar } = {}) {
  const div = document.createElement('div');
  div.className = 'bloque-lidar';
  const motivo = motivoSinLidar(elemento);
  if (motivo) {
    const p = document.createElement('p');
    p.className = 'nota';
    p.textContent = '🧊 ' + motivo;
    div.appendChild(p);
    if (esIOS() && esAppInstalada() && elemento.modelo3dId) {
      const b = document.createElement('a');
      b.className = 'boton secundario enlace-boton';
      b.href = location.href; b.target = '_blank'; b.rel = 'noopener';
      b.textContent = '🧭 Abrir en Safari';
      div.appendChild(b);
    }
    return div;
  }
  const { enlace, poner, texto } = crearEnlaceAR({
    texto: '⏳ Preparando AR con LiDAR…', alPulsar,
  });
  div.appendChild(enlace);
  prepararQuickLook(elemento)
    .then((u) => poner(u, '🧊 Anclar con LiDAR'))
    .catch((e) => { texto('❌ No se pudo preparar el AR'); console.warn('Quick Look:', e); });
  return div;
}

// ---------- anclado al QR impreso (ARKit lo encuentra solo y lo sigue con LiDAR) ----------
const cacheQR = new Map();
const redondeo = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 10) / 10).join(',');

/**
 * El modelo del elemento, de pie y a tamaño real, encima de SU QR. En el AR de Apple aparece solo
 * en cuanto la cámara ve el QR. arribaL: cómo está colocado el QR (lo calcula el escáner).
 */
export function prepararQuickLookEnQR(elemento, arribaL, ladoCm) {
  const clave = `${elemento.modelo3dId}|${redondeo(arribaL)}|${ladoCm}`;
  if (!cacheQR.has(clave)) {
    const p = (async () => {
      const [{ usdzAncladoAQR }, a] = await Promise.all([import('./navegacion.js'), obtenerArchivo(elemento.modelo3dId)]);
      if (!a) throw new Error('No se encuentra el modelo 3D.');
      const modelo = await modeloNormalizado(a.blob);
      modelo.position.y = (ladoCm / 100) * 0.6; // justo encima del QR
      const blob = await usdzAncladoAQR(modelo, { textoQR: 'INFOLENS:' + elemento.id, ladoCm, arribaL });
      return direccionWeb(`${elemento.modelo3dId}-qr-${redondeo(arribaL).replace(/[^0-9-]/g, '_')}`, blob);
    })();
    p.catch(() => cacheQR.delete(clave));
    cacheQR.set(clave, p);
  }
  return cacheQR.get(clave);
}

// modo 'qr': ARKit busca el QR impreso y coloca las flechas solo. modo 'suelo': se coloca a mano.
export async function prepararRecorridoQuickLook(componente, ancla, ladoCm, modo = 'qr') {
  const { usdzAncladoAQR, usdzEnSuelo, escenaRecorrido } = await import('./navegacion.js');
  const arr = ancla.anclaGravedad;
  const arribaL = arr ? new THREE.Vector3(arr[0], arr[1], arr[2]) : new THREE.Vector3(0, 1, 0);
  const escena = escenaRecorrido(componente.nav, componente);
  const blob = modo === 'suelo'
    ? await usdzEnSuelo(escena, { ladoCm })
    : await usdzAncladoAQR(escena, { textoQR: 'INFOLENS:' + ancla.id, ladoCm, arribaL });
  // Nombre estable (se sobrescribe si cambia el recorrido): no se acumulan archivos
  let h = 0;
  for (const c of JSON.stringify([componente.nav, arr, ladoCm, componente.nombre, modo])) h = (h * 31 + c.charCodeAt(0)) | 0;
  const url = await direccionWeb(`recorrido-${modo}-${ancla.id}-${componente.id}-${(h >>> 0).toString(36)}`, blob);
  // Sin zoom con los dedos: el recorrido tiene que quedar a tamaño real
  return url + '#allowsContentScaling=0';
}

/**
 * Botón del recorrido en el AR de Apple (LiDAR), hecho igual que la prueba del inicio que funciona:
 * un solo objeto con el ancla (🟥), las flechas y el componente (🟦). Se coloca como un objeto.
 * componente: { id, nombre, referencia, nav: { pos, ruta } }; ancla: { id }.
 */
/** Dirección de la app (para Safari) con el recorrido dentro: #/ar?d={n, p}. */
export function direccionSafariRecorrido(componente) {
  const nav = componente.nav;
  const puntos = [[0, 0, 0], ...(nav.ruta || []), nav.pos].map((q) => q.map((n) => Math.round(n * 1000) / 1000));
  const d = JSON.stringify({ n: componente.nombre || 'Destino', p: puntos });
  return new URL(`${import.meta.env?.BASE_URL ?? "./"}#/ar?d=${encodeURIComponent(d)}`, location.href).href;
}

export function bloqueRecorridoLidar(componente, ancla, ladoCm) {
  // Igual que la prueba "Con tus medidas" del inicio (que funciona): primero se genera el archivo
  // al pulsar un botón normal y DESPUÉS se crea el botón verde, ya listo, con su dirección.
  void ladoCm;
  const div = document.createElement('div');
  div.className = 'bloque-lidar-guia';
  // Desde la app instalada en la pantalla de inicio el AR de Apple NO se abre: se abre en Safari,
  // con el recorrido dentro de la dirección (Safari no tiene los datos de la app).
  div.innerHTML = `
    <p class="nota lidar-recomendado">👉 Recomendado para andar: recorrido con LiDAR (no pierde la posición).</p>
    <button class="boton" data-l="preparar">⚙️ Preparar recorrido con LiDAR</button>
    <div class="lidar-listo"></div>
    <p class="nota">🟥 Rojo = el QR del ancla · 🟦 Azul = <span class="l-comp"></span>.<br>
      Coloca el rojo encima del QR del ancla y gira con dos dedos hasta que las flechas salgan hacia "▲ ADELANTE". Luego camina.</p>`;
  div.querySelector('.l-comp').textContent = componente.nombre || 'el componente';
  const listo = div.querySelector('.lidar-listo');
  const btn = div.querySelector('[data-l="preparar"]');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⏳ Preparando…';
    listo.innerHTML = '';
    try {
      const [{ puntosRecorrido }, { usdzRecorridoObjetos }] = await Promise.all([import('./navegacion.js'), import('./prueba-flechas.js')]);
      const bytes = await usdzRecorridoObjetos(puntosRecorrido(componente.nav));
      let h = 0;
      for (const c of JSON.stringify([componente.nav, componente.id, ancla.id])) h = (h * 31 + c.charCodeAt(0)) | 0;
      const blob = new Blob([bytes], { type: 'model/vnd.usdz+zip' });
      const url = await direccionWeb(`paso-${(h >>> 0).toString(36)}`, blob);
      listo.appendChild(crearEnlaceAR({ url, texto: '🧭 Ver recorrido con LiDAR: ancla 🟥 → componente 🟦' }).enlace);
      // Otra forma de abrirlo: un enlace normal al archivo (Safari también abre el AR de Apple)
      const otro = document.createElement('a');
      otro.className = 'boton secundario enlace-boton';
      otro.href = url;
      otro.textContent = '🔁 Si no se abre: abrir de otra forma';
      listo.appendChild(otro);
      const info = document.createElement('p');
      info.className = 'nota';
      info.textContent = `✅ Listo · ${Math.round(blob.size / 1024)} KB. Toca el botón verde.`;
      listo.appendChild(info);
      btn.textContent = '↻ Volver a preparar';
    } catch (e) {
      console.warn('Recorrido LiDAR:', e);
      const p = document.createElement('p');
      p.className = 'error-form';
      p.textContent = '❌ No se pudo preparar: ' + (e && e.message ? e.message : e);
      listo.appendChild(p);
      btn.textContent = '⚙️ Preparar recorrido con LiDAR';
    }
    btn.disabled = false;
  });
  // Desde la app instalada en la pantalla de inicio puede que el AR de Apple no se abra: otra opción es
  // abrirlo en Safari, con el recorrido dentro de la dirección (Safari no tiene los datos de la app).
  if (esIOS() && esAppInstalada()) {
    const extra = document.createElement('div');
    extra.innerHTML = '<p class="nota">Si desde la app instalada el botón verde no hace nada, ábrelo en Safari:</p>'
      + '<a class="boton secundario enlace-boton" target="_blank" rel="noopener">🧭 Abrir el recorrido en Safari</a>';
    extra.querySelector('a').href = direccionSafariRecorrido(componente);
    div.appendChild(extra);
  }
  return div;
}

function escaparHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
