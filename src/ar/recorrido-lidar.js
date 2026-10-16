// Recorrido de un paso para el AR de Apple (LiDAR):
//   · un ANCLA 3D encima del QR del ancla (origen),
//   · flechas + línea por el camino EXACTO de los tramos,
//   · en el punto final, la "i" y un cartel con la información del elemento.
// Dos formas de abrirlo:
//   'qr'    → ARKit busca el QR impreso del ancla y lo coloca solo encima (ancla de imagen).
//   'suelo' → se coloca a mano como un objeto (respaldo si no detecta el QR).
// Se abre con una dirección temporal (blob:), que es la que funciona en el iPhone.
import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { crearFlechas, usdzAncladoAQR, marcaSalida } from './navegacion.js';
import { crearIcono } from './icono.js';
import { pngMarcador } from './marcador.js';

const ORO = 0xffc83d, AZUL = 0x0a84ff;

/** Ancla 3D (el símbolo ⚓) de unos `alto` metros, de pie sobre el origen. */
export function anclaTresD(alto = 0.16) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: ORO, metalness: 0.4, roughness: 0.35, emissive: 0x3a2a00 });
  const k = alto / 0.16;
  const grosor = 0.008 * k;
  const cana = new THREE.Mesh(new THREE.CylinderGeometry(grosor, grosor, 0.12 * k, 16), mat);
  cana.position.y = 0.075 * k;
  const aro = new THREE.Mesh(new THREE.TorusGeometry(0.014 * k, grosor * 0.8, 10, 24), mat);
  aro.position.y = 0.15 * k;
  const cruz = new THREE.Mesh(new THREE.CylinderGeometry(grosor * 0.8, grosor * 0.8, 0.07 * k, 12), mat);
  cruz.rotation.z = Math.PI / 2;
  cruz.position.y = 0.12 * k;
  // Brazos curvos (media circunferencia por debajo) y puntas
  const brazos = new THREE.Mesh(new THREE.TorusGeometry(0.045 * k, grosor, 10, 32, Math.PI), mat);
  brazos.rotation.z = Math.PI;
  brazos.position.y = 0.06 * k;
  g.add(cana, aro, cruz, brazos);
  for (const s of [-1, 1]) {
    const punta = new THREE.Mesh(new THREE.ConeGeometry(grosor * 2.4, 0.03 * k, 12), mat);
    punta.position.set(s * 0.045 * k, 0.07 * k, 0);
    g.add(punta);
  }
  // Base: disco azul sobre el QR
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * k, 0.02 * k, 0.004, 32),
    new THREE.MeshStandardMaterial({ color: AZUL, roughness: 0.5, emissive: 0x06336b }));
  base.position.y = 0.002;
  g.add(base);
  return g;
}

/** Cartel con varias líneas de texto (la primera grande). anchoM: ancho en metros. */
function cartel(lineas, anchoM = 0.34) {
  const c = document.createElement('canvas');
  const n = Math.max(1, Math.min(4, lineas.length));
  c.width = 1024; c.height = 120 + n * 90;
  const g = c.getContext('2d');
  g.fillStyle = '#0f1b24';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#34c759'; g.lineWidth = 14; g.strokeRect(7, 7, c.width - 14, c.height - 14);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lineas.slice(0, 4).forEach((t, i) => {
    g.fillStyle = i === 0 ? '#ffffff' : '#9fd8ff';
    g.font = `${i === 0 ? 700 : 500} ${i === 0 ? 86 : 56}px -apple-system, system-ui, sans-serif`;
    g.fillText(String(t || ''), c.width / 2, 100 + i * 95, c.width - 60);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(anchoM, anchoM * c.height / c.width),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
}

const cortar = (t, n) => (t && t.length > n ? t.slice(0, n - 1) + '…' : t || '');

/**
 * Escena en G: puntos = recorrido (Vector3, el primero el QR). info = { nombre, referencia, id, descripcion }.
 */
// vista: 'ambas' (flechas y línea), 'flechas' (solo flechas) o 'linea' (solo la línea verde)
export function escenaPaso(puntos, info = {}, { ladoCm = 10, vista = 'flechas' } = {}) {
  const grupo = new THREE.Group();
  // Una cosa u otra: solo flechas o solo la línea de un punto a otro
  const linea = vista === 'linea';
  grupo.add(crearFlechas(puntos, 0.5, { conLinea: linea, conFlechas: !linea, conAro: false, grosorLinea: linea ? 0.018 : 0.008 }));
  grupo.add(anclaTresD(Math.max(0.12, (ladoCm / 100) * 1.4)));
  // Cuadro del tamaño exacto del QR + flecha azul ADELANTE y roja DERECHA: tiene que coincidir con el QR impreso
  grupo.add(marcaSalida(ladoCm / 100, { conTexto: false }));
  const fin = puntos[puntos.length - 1];
  const previo = puntos[puntos.length - 2] || new THREE.Vector3(0, 0, 0.5);
  // El cartel mira hacia donde llega la persona (el tramo anterior), en horizontal
  const mira = previo.clone().sub(fin); mira.y = 0;
  if (mira.lengthSq() < 1e-6) mira.set(0, 0, 1);
  const angulo = Math.atan2(mira.x, mira.z);
  const i = crearIcono(true);
  i.scale.setScalar(0.1);
  i.position.copy(fin).add(new THREE.Vector3(0, 0.1, 0));
  i.rotation.y = angulo;
  grupo.add(i);
  const lineas = [cortar(info.nombre || 'Destino', 28)];
  if (info.referencia || info.id) lineas.push(cortar([info.referencia, info.id].filter(Boolean).join(' · '), 40));
  if (info.descripcion) {
    const d = info.descripcion.replace(/\s+/g, ' ');
    lineas.push(cortar(d, 42));
    if (d.length > 42) lineas.push(cortar(d.slice(41), 42));
  }
  const placa = cartel(lineas);
  placa.position.copy(fin).add(new THREE.Vector3(0, 0.33, 0));
  placa.rotation.y = angulo;
  grupo.add(placa);
  return grupo;
}

/** Materiales compatibles con el AR de Apple (estándar, una cara, sin transparencias). */
function compatibles(raiz) {
  raiz.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      const e = m.isMeshStandardMaterial ? m : new THREE.MeshStandardMaterial({ color: m.color ? m.color.clone() : 0xffffff, map: m.map || null });
      e.side = THREE.FrontSide; e.transparent = false; e.opacity = 1;
      return e;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

/**
 * .usdz del paso. modo 'qr': anclado al QR impreso (textoQR, ladoCm, colocacion 'suelo'|'pared', giro en grados).
 * modo 'suelo': se coloca a mano.
 */
export async function usdzPaso(puntos, info, { modo = 'qr', textoQR, ladoCm = 10, colocacion = 'suelo', giro = 0, vista = 'flechas', unidad = 'cm', soloQR = false } = {}) {
  const escena = escenaPaso(puntos, info, { ladoCm, vista });
  compatibles(escena);
  if (modo === 'qr') {
    const arribaL = colocacion === 'pared' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    // Imagen de referencia = el MARCADOR del ancla (dibujo + QR), salvo que se pida el QR solo (marcadores antiguos)
    const m = soloQR ? null : await pngMarcador(textoQR, ladoCm);
    return usdzAncladoAQR(escena, { textoQR, ladoCm, arribaL, giroGrados: giro, imagen: m && m.png, anchoImagenCm: m && m.anchoCm, unidad });
  }
  const bytes = await new USDZExporter().parseAsync(escena);
  return new Blob([bytes], { type: 'model/vnd.usdz+zip' });
}
