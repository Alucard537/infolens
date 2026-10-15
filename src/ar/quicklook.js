// "Anclar con LiDAR": abre el modelo 3D en AR Quick Look, el visor de realidad aumentada de Apple.
// Quick Look usa ARKit y el LiDAR del iPhone: coloca el modelo solo sobre la superficie que hay
// delante (centro de la cámara) y lo deja perfectamente anclado; el usuario puede arrastrarlo,
// girarlo o cambiar su tamaño para corregirlo. El modelo sale a tamaño real.
//
// El .usdz (formato de Apple) se crea en el propio teléfono a partir del .glb, sin internet.
// IMPORTANTE: Safari solo abre Quick Look si se toca un enlace; por eso el .usdz se prepara antes
// y el botón se activa cuando está listo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { obtenerArchivo } from '../db.js';

const cache = new Map(); // id del archivo .glb -> Promise<blob: URL del .usdz>

/** ¿Este dispositivo tiene AR Quick Look? (iPhone / iPad con Safari) */
export function hayQuickLook() {
  const a = document.createElement('a');
  return !!(a.relList && a.relList.supports && a.relList.supports('ar'));
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
  return URL.createObjectURL(new Blob([bytes], { type: 'model/vnd.usdz+zip' }));
}

/** Prepara (una vez) el .usdz del modelo de un elemento. Devuelve Promise<URL> o null si no tiene modelo. */
export function prepararQuickLook(elemento) {
  if (!elemento || !elemento.modelo3dId || !hayQuickLook()) return null;
  if (!cache.has(elemento.modelo3dId)) {
    const p = obtenerArchivo(elemento.modelo3dId).then((a) => {
      if (!a) throw new Error('No se encuentra el modelo 3D.');
      return crearUsdz(a.blob);
    });
    p.catch(() => cache.delete(elemento.modelo3dId)); // si falla, se podrá reintentar
    cache.set(elemento.modelo3dId, p);
  }
  return cache.get(elemento.modelo3dId);
}

/**
 * Abre Quick Look. Hay que llamarlo DIRECTAMENTE desde un toque del usuario y con la URL ya lista.
 * Arriba se ve una barra con el nombre del elemento y el botón "Ver detalle" (alPulsar).
 */
export function abrirQuickLook(url, { titulo, subtitulo, alPulsar }) {
  const a = document.createElement('a');
  a.rel = 'ar';
  const params = new URLSearchParams({
    callToAction: 'Ver detalle',
    checkoutTitle: titulo || '',
    checkoutSubtitle: subtitulo || '',
  });
  a.href = `${url}#${params.toString().replace(/\+/g, '%20')}`;
  a.appendChild(document.createElement('img')); // Safari exige una imagen dentro del enlace
  a.style.display = 'none';
  a.addEventListener('message', (e) => {
    if (e.data === '_apple_ar_quicklook_button_tapped' && alPulsar) alPulsar();
  });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 60_000);
}

/**
 * Crea el botón "🧊 Anclar con LiDAR" para un elemento (o null si no tiene modelo o no hay Quick Look).
 * El botón aparece desactivado mientras se prepara el modelo.
 */
export function botonQuickLook(elemento, { clase = 'boton', alPulsar } = {}) {
  const preparado = prepararQuickLook(elemento);
  if (!preparado) return null;
  const b = document.createElement('button');
  b.className = clase;
  b.disabled = true;
  b.textContent = '⏳ Preparando AR…';
  let url = null;
  preparado.then((u) => { url = u; b.disabled = false; b.textContent = '🧊 Anclar con LiDAR'; })
    .catch(() => { b.textContent = '❌ No se pudo preparar el AR'; });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (url) abrirQuickLook(url, { titulo: elemento.nombre, subtitulo: `${elemento.referencia} · ${elemento.id}`, alPulsar });
  });
  return b;
}
