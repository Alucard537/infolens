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

function escaparHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
