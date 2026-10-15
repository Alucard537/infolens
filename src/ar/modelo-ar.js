// Carga el modelo 3D (.glb) de un elemento para mostrarlo en realidad aumentada.
// Lo deja preparado: centrado, apoyado en su base (y = 0) y con un tamaño razonable.
// Estructura: raiz (posición y giro sobre el QR) -> pivote (giro con el dedo, en el centro del
// modelo) -> ajustado (escala) -> modelo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const cargador = new GLTFLoader();

/** blob: el .glb. tamMax: medida máxima del modelo en metros. Devuelve un THREE.Group. */
export async function cargarModeloAR(blob, tamMax) {
  const datos = await blob.arrayBuffer();
  const gltf = await cargador.parseAsync(datos, '');
  const modelo = gltf.scene;

  // Medir el modelo y escalarlo para que su lado más largo mida tamMax
  modelo.updateMatrixWorld(true);
  const caja = new THREE.Box3().setFromObject(modelo);
  const tam = caja.getSize(new THREE.Vector3());
  const mayor = Math.max(tam.x, tam.y, tam.z) || 1;
  const k = tamMax / mayor;
  const centro = caja.getCenter(new THREE.Vector3());
  const altura = tam.y * k;

  // Centrado en horizontal y con la base en y = 0
  modelo.position.set(-centro.x, -caja.min.y, -centro.z);
  const ajustado = new THREE.Group();
  ajustado.add(modelo);
  ajustado.scale.setScalar(k);
  ajustado.position.y = -altura / 2;

  // El pivote está en el centro del modelo: así gira sobre sí mismo
  const pivote = new THREE.Group();
  pivote.rotation.order = 'YXZ';
  pivote.position.y = altura / 2;
  pivote.add(ajustado);

  const raiz = new THREE.Group();
  raiz.add(pivote);
  raiz.matrixAutoUpdate = false;
  raiz.userData.altura = altura;
  // Radio que ocupa en horizontal, girado como sea (para que la "i" no lo tape)
  raiz.userData.radio = 0.5 * Math.hypot(tam.x * k, tam.y * k, tam.z * k);
  raiz.userData.pivote = pivote;
  return raiz;
}
