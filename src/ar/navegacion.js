// Navegación con QR: sistema de coordenadas del QR, flechas 3D y exportación a AR de Apple
// anclada al propio QR impreso (ARKit lo sigue con LiDAR aunque deje de verse).
//
// SISTEMA DE COORDENADAS "G" (el que se guarda en cada componente, en metros):
//   origen = centro del QR ancla
//   Y = hacia arriba (contrario a la gravedad), aunque el QR esté inclinado o tumbado
//   Z = horizontal, hacia fuera del QR (hacia quien lo mira). Si el QR está tumbado en una mesa,
//       hacia su borde de abajo.
//   X = horizontal, hacia la derecha mirando el QR de frente
//
// Coordenadas propias del QR "L": x = derecha del QR, y = borde de arriba, z = sale del QR.
import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
import QRCode from 'qrcode';
import { crearIcono } from './icono.js';

const VERDE = 0x34c759;

/** Ejes de G expresados en coordenadas L, a partir de "arriba" en coordenadas L. */
// QR "tumbado" (suelo, mesa, techo) si su cara mira a menos de 45° de la vertical; si no, "de pared".
// Tumbado: ADELANTE = hacia su borde de arriba (la flecha "▲ ADELANTE" impresa).
// De pared: ADELANTE = hacia la pared. En los dos casos DERECHA = el borde derecho del QR.
export function colocacionQR(arribaL) {
  const c = arribaL[2] ?? arribaL.z;
  return c > Math.SQRT1_2 ? 'suelo' : c < -Math.SQRT1_2 ? 'techo' : 'pared';
}
function ejesG(arribaL) {
  const y = arribaL.clone().normalize();
  const z = colocacionQR(y) === 'pared'
    ? new THREE.Vector3(0, 0, 1).addScaledVector(y, -y.z)     // normal del QR, en horizontal
    : new THREE.Vector3(0, -1, 0).addScaledVector(y, y.y);    // QR tumbado: su borde de abajo, en horizontal
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return { x, y, z };
}

/** "Arriba" del mundo en coordenadas del QR (para guardar cómo está colocado el QR). */
export function gravedadEnQR(rotQR, arribaCamara) {
  return arribaCamara.clone().applyQuaternion(rotQR.clone().invert()).normalize();
}

/**
 * Matriz G -> cámara, con la posición y el giro del QR (en cámara) y "arriba" (en cámara).
 * gravedadL: "arriba" ya medido en coordenadas del QR (fijo: el QR no se mueve). Si se da, los ejes
 * dependen SOLO de la posición del QR y no se mueven con el sensor.
 */
export function marcoQR(posQR, rotQR, arribaCamara, salida = new THREE.Matrix4(), gravedadL = null) {
  const { x, y, z } = ejesG(gravedadL || gravedadEnQR(rotQR, arribaCamara));
  const mL = new THREE.Matrix4().makeBasis(x, y, z);           // G -> L
  const mQR = new THREE.Matrix4().compose(posQR, rotQR, new THREE.Vector3(1, 1, 1)); // L -> cámara
  return salida.multiplyMatrices(mQR, mL);
}

// ---------- flechas y destino ----------

let geoFlecha = null;
function geometriaFlecha() {
  if (geoFlecha) return geoFlecha;
  // Flecha plana que apunta hacia +Z (un "chevron" con algo de grosor), de 16 cm de largo
  const forma = new THREE.Shape();
  forma.moveTo(0, 0.08); forma.lineTo(0.07, 0.0); forma.lineTo(0.035, 0.0);
  forma.lineTo(0.035, -0.08); forma.lineTo(-0.035, -0.08); forma.lineTo(-0.035, 0.0);
  forma.lineTo(-0.07, 0.0); forma.closePath();
  const g = new THREE.ExtrudeGeometry(forma, { depth: 0.012, bevelEnabled: false });
  g.translate(0, 0, -0.006);
  g.rotateX(-Math.PI / 2); // la forma estaba en XY: ahora queda tumbada, apuntando a -Z...
  g.rotateY(Math.PI);      // ...y la giramos para que apunte a +Z
  geoFlecha = g;
  return g;
}

/** Puntos del recorrido en G: QR -> puntos intermedios -> destino. */
export function puntosRecorrido(nav) {
  const p = [new THREE.Vector3(0, 0, 0)]; // salida: el centro del QR del ancla
  for (const q of nav.ruta || []) p.push(new THREE.Vector3(q[0], q[1], q[2]));
  p.push(new THREE.Vector3(nav.pos[0], nav.pos[1], nav.pos[2]));
  return p;
}

/**
 * Grupo con las flechas a lo largo del recorrido (en coordenadas G).
 * separacion: metros entre flechas.
 */
export function crearFlechas(puntos, separacion = 0.5, { conLinea = true } = {}) {
  const grupo = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: VERDE, emissive: 0x145c2a, roughness: 0.4, metalness: 0.1 });
  const materialLinea = new THREE.MeshStandardMaterial({ color: VERDE, emissive: 0x145c2a, transparent: true, opacity: 0.7 });
  grupo.userData.materiales = [material, materialLinea];
  const arriba = new THREE.Vector3(0, 1, 0);
  const ESCALA_FLECHA = new THREE.Vector3(0.9, 0.9, 0.9);
  if (conLinea && puntos.length) {
    // Marca de salida junto al QR del ancla (un aro en el suelo del recorrido)
    const aro = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 32), materialLinea);
    aro.rotation.x = Math.PI / 2;
    aro.position.copy(puntos[0]);
    aro.userData.linea = true;
    grupo.add(aro);
  }
  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i], b = puntos[i + 1];
    const tramo = b.clone().sub(a);
    const largo = tramo.length();
    if (largo < 1e-3) continue;
    const dir = tramo.clone().divideScalar(largo);
    // Flecha "de pie" respecto al suelo: su arriba es la vertical (salvo en tramos verticales)
    let up = arriba.clone().addScaledVector(dir, -arriba.dot(dir));
    if (up.lengthSq() < 0.01) up = new THREE.Vector3(0, 0, 1).addScaledVector(dir, -dir.z);
    up.normalize();
    const lateral = new THREE.Vector3().crossVectors(up, dir).normalize();
    const giro = new THREE.Matrix4().makeBasis(lateral, up, dir);
    // Línea continua del tramo (un tubo fino), para ver el camino completo
    if (conLinea) {
      const tubo = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, largo, 8, 1), materialLinea);
      tubo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      tubo.position.copy(a).addScaledVector(tramo, 0.5);
      tubo.userData.linea = true;
      grupo.add(tubo);
    }
    const n = Math.max(1, Math.floor(largo / separacion));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const f = new THREE.Mesh(geometriaFlecha(), material);
      f.matrixAutoUpdate = false;
      f.matrix.copy(giro).scale(ESCALA_FLECHA).setPosition(a.clone().addScaledVector(tramo, t));
      f.userData.tramo = { i, t };
      grupo.add(f);
    }
  }
  return grupo;
}

/** Texto en una placa (para la etiqueta del destino en el AR de Apple). */
function placaTexto(lineas, anchoM = 0.3) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(15,27,36,0.92)';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#7EC8F2'; g.lineWidth = 10; g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 84px -apple-system, system-ui, sans-serif';
  g.fillText(lineas[0] || '', c.width / 2, 95, c.width - 40);
  g.fillStyle = '#7EC8F2';
  g.font = '500 60px -apple-system, system-ui, sans-serif';
  g.fillText(lineas[1] || '', c.width / 2, 185, c.width - 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const placa = new THREE.Mesh(
    new THREE.PlaneGeometry(anchoM, anchoM / 4),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  return placa;
}

/**
 * Escena para el AR de Apple (en G): flechas + "i" de destino + etiqueta con el nombre.
 * Como en el AR de Apple no se puede girar hacia la cámara, el destino mira hacia el inicio del recorrido.
 */
export function escenaRecorrido(nav, componente, { conEtiqueta = true } = {}) {
  const grupo = new THREE.Group();
  const puntos = puntosRecorrido(nav);
  grupo.add(crearFlechas(puntos, 0.5, { conLinea: false }));
  const destino = puntos[puntos.length - 1];
  const previo = puntos[puntos.length - 2];
  const mira = previo.clone().sub(destino); mira.y = 0;
  if (mira.lengthSq() < 1e-6) mira.set(0, 0, 1);
  mira.normalize();
  const angulo = Math.atan2(mira.x, mira.z);
  const icono = crearIcono(true);
  icono.scale.setScalar(0.12);
  icono.position.copy(destino).add(new THREE.Vector3(0, 0.12, 0));
  icono.rotation.y = angulo;
  grupo.add(icono);
  if (conEtiqueta) {
    const placa = placaTexto([componente.nombre, `${componente.referencia} · ${componente.id}`]);
    placa.position.copy(destino).add(new THREE.Vector3(0, 0.27, 0));
    placa.rotation.y = angulo;
    grupo.add(placa);
  }
  return grupo;
}

// ---------- exportar al AR de Apple, anclado al QR impreso ----------

/** G -> coordenadas del ancla de imagen de ARKit (imagen en el plano XZ, Y sale de la imagen, arriba de la imagen = -Z). */
function matrizGaImagen(arribaL) {
  const { x, y, z } = ejesG(arribaL);
  const aImagen = (v) => new THREE.Vector3(v.x, v.z, -v.y); // L -> imagen
  return new THREE.Matrix4().makeBasis(aImagen(x), aImagen(y), aImagen(z));
}

/** PNG del QR (solo la zona negra, sin margen: su ancho real es el tamaño impreso). */
async function pngQR(texto) {
  const url = await QRCode.toDataURL(texto, { errorCorrectionLevel: 'M', margin: 0, scale: 16 });
  const bin = atob(url.split(',')[1]);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Vuelve a empaquetar el .usdz con los archivos alineados a 64 bytes (lo exige el formato). */
function empaquetarUsdz(files) {
  let offset = 0;
  const salida = {};
  for (const nombre of Object.keys(files)) {
    const datos = files[nombre];
    offset += 34 + nombre.length;
    const mod = offset & 63;
    salida[nombre] = mod !== 4 ? [datos, { extra: { 12345: new Uint8Array(64 - mod) } }] : datos;
    offset = datos.length;
  }
  return zipSync(salida, { level: 0, mtime: new Date() });
}

/**
 * Exporta "contenidoG" (en coordenadas G) a .usdz anclado al QR impreso.
 * textoQR: contenido del QR ancla; ladoCm: tamaño impreso; arribaL: cómo está colocado el QR
 * (vector "arriba" en coordenadas del QR; por defecto QR vertical en una pared).
 */
export async function usdzAncladoAQR(contenidoG, { textoQR, ladoCm, arribaL = new THREE.Vector3(0, 1, 0), giroGrados = 0 }) {
  const envoltura = new THREE.Group();
  envoltura.matrixAutoUpdate = false;
  // giroGrados: corrección por si el AR de Apple coloca el contenido girado sobre el QR (gira sobre la cara del QR)
  envoltura.matrix.makeRotationY(THREE.MathUtils.degToRad(giroGrados)).multiply(matrizGaImagen(arribaL));
  envoltura.add(contenidoG);
  envoltura.updateMatrixWorld(true);
  // Materiales compatibles con el AR de Apple: todos "estándar" y de una sola cara
  contenidoG.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      const e = m.isMeshStandardMaterial ? m : new THREE.MeshStandardMaterial({
        color: m.color ? m.color.clone() : 0xffffff, map: m.map || null,
        transparent: !!m.transparent, opacity: m.opacity ?? 1, roughness: 0.5, metalness: 0.1,
      });
      e.side = THREE.FrontSide;
      return e;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  const bytes = await new USDZExporter().parseAsync(envoltura, {
    ar: { anchoring: { type: 'image' }, planeAnchoring: { alignment: 'vertical' } },
  });
  const files = unzipSync(new Uint8Array(bytes));
  let usda = strFromU8(files['model.usda']);
  const lineaPlano = /\n(\s*)token preliminary:planeAnchoring:alignment = "[^"]*"/;
  const m = lineaPlano.exec(usda);
  if (!m) throw new Error('No se pudo preparar el anclaje al QR.');
  const s = m[1];
  usda = usda.replace(lineaPlano, `
${s}rel preliminary:imageAnchoring:referenceImage = </Root/Scenes/Scene/AnchoringReferenceImage>

${s}def Preliminary_ReferenceImage "AnchoringReferenceImage"
${s}{
${s}    uniform asset image = @textures/qr_ancla.png@
${s}    uniform double physicalWidth = ${Number(ladoCm).toFixed(2)}
${s}}`);
  const nuevos = { 'model.usda': strToU8(usda) };
  for (const [k, v] of Object.entries(files)) if (k !== 'model.usda') nuevos[k] = v;
  nuevos['textures/qr_ancla.png'] = await pngQR(textoQR);
  return new Blob([empaquetarUsdz(nuevos)], { type: 'model/vnd.usdz+zip' });
}

// ---------- exportar al AR de Apple para COLOCAR A MANO en el suelo ----------
// Igual que un objeto 3D: Quick Look lo pone en el suelo y el usuario lo arrastra (un dedo) y lo gira
// (dos dedos) hasta que el cuadro de salida queda encima del QR impreso y la flecha azul apunta como
// la flecha "▲ ADELANTE" del QR. No depende de que ARKit reconozca el QR.

function marcaSalida(ladoM) {
  const g = new THREE.Group();
  const azul = new THREE.MeshStandardMaterial({ color: 0x0a84ff, emissive: 0x06336b, roughness: 0.5 });
  const rojo = new THREE.MeshStandardMaterial({ color: 0xff453a, emissive: 0x5a1410, roughness: 0.5 });
  const blanco = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333, roughness: 0.6 });
  const h = ladoM / 2, grosor = Math.max(0.006, ladoM * 0.06);
  // Cuadro del tamaño del QR
  for (const [x, z, ancho, fondo] of [[0, -h, ladoM + grosor, grosor], [0, h, ladoM + grosor, grosor], [-h, 0, grosor, ladoM], [h, 0, grosor, ladoM]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(ancho, 0.004, fondo), blanco);
    b.position.set(x, 0.002, z);
    g.add(b);
  }
  // Flecha que sale del borde del cuadro: dir = ángulo (0 = ADELANTE, −Z; −90° = DERECHA, +X)
  const flecha = (dir, mat, largo) => {
    const f = new THREE.Group();
    const palo = new THREE.Mesh(new THREE.BoxGeometry(grosor * 0.8, 0.004, largo), mat);
    palo.position.z = -largo / 2;
    const punta = new THREE.Mesh(new THREE.ConeGeometry(grosor * 2.2, grosor * 4, 3), mat);
    punta.rotation.x = -Math.PI / 2;
    punta.position.z = -largo - grosor * 2;
    f.add(palo, punta);
    const pivote = new THREE.Group();
    f.position.z = -h;
    pivote.add(f);
    pivote.rotation.y = dir;
    pivote.position.y = 0.004;
    return pivote;
  };
  g.add(flecha(0, azul, Math.max(0.12, ladoM)));
  g.add(flecha(-Math.PI / 2, rojo, Math.max(0.06, ladoM * 0.5)));
  // Texto tumbado en el suelo, por detrás del QR (se lee de pie junto al QR mirando ADELANTE)
  const ancho = Math.max(0.24, ladoM * 2.2);
  const placa = placaTexto(['Pon el cuadro sobre el QR', 'Flecha azul = ▲ ADELANTE'], ancho);
  placa.rotation.x = -Math.PI / 2;
  placa.position.set(0, 0.003, h + ancho / 8 + 0.03);
  g.add(placa);
  return g;
}

/** .usdz del recorrido para colocar a mano en el suelo (contenido en coordenadas G). */
export async function usdzEnSuelo(contenidoG, { ladoCm }) {
  const raiz = new THREE.Group();
  raiz.add(contenidoG);
  raiz.add(marcaSalida(ladoCm / 100));
  raiz.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      const e = m.isMeshStandardMaterial ? m : new THREE.MeshStandardMaterial({
        color: m.color ? m.color.clone() : 0xffffff, map: m.map || null,
        transparent: !!m.transparent, opacity: m.opacity ?? 1, roughness: 0.5, metalness: 0.1,
      });
      e.side = THREE.FrontSide;
      return e;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  raiz.updateMatrixWorld(true);
  const bytes = await new USDZExporter().parseAsync(raiz, {
    ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
  });
  return new Blob([bytes], { type: 'model/vnd.usdz+zip' });
}
