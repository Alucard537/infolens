import { Box3, BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';

// FBX industrial en centímetros. Se conservan las piezas y sus colores de material.
export async function convertirFbxAUsdz(archivo) {
  const origen = new FBXLoader().parse(await archivo.arrayBuffer(), '');
  origen.updateMatrixWorld(true);
  const caja = new Box3().setFromObject(origen);
  if (caja.isEmpty()) throw new Error('El FBX no contiene una pieza 3D.');
  const base = caja.getCenter(new Vector3());
  base.y = caja.min.y;
  const ajuste = new Matrix4().makeScale(0.01, 0.01, 0.01)
    .multiply(new Matrix4().makeTranslation(-base.x, -base.y, -base.z));
  const partes = [];
  origen.traverse((o) => {
    const pos = o.geometry?.getAttribute('position');
    if (!o.isMesh || !pos?.count) return;
    const materiales = Array.isArray(o.material) ? o.material : [o.material];
    const total = o.geometry.index?.count ?? pos.count;
    const grupos = materiales.length > 1 && o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const { start, count, materialIndex } of grupos) {
      const indices = Math.floor(Math.min(count, total - start) / 3) * 3;
      if (indices >= 3) partes.push({ o, start, indices, material: materiales[materialIndex] });
    }
  });
  if (!partes.length) throw new Error('El FBX no contiene superficies para mostrar.');
  const caras = partes.reduce((n, p) => n + p.indices / 3, 0);
  const proporcion = Math.min(1, 150000 / caras);
  if (proporcion < 1) await MeshoptSimplifier.ready;
  const materiales = new Map();
  const escena = new Group();
  for (const { o, start, indices, material } of partes) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', o.geometry.getAttribute('position'));
    if (o.geometry.hasAttribute('normal')) geo.setAttribute('normal', o.geometry.getAttribute('normal'));
    const indice = o.geometry.index;
    const datos = Uint32Array.from({ length: indices }, (_, i) => indice ? indice.getX(start + i) : start + i);
    geo.setIndex(new BufferAttribute(datos, 1));
    let limpia = mergeVertices(geo, 0.00001);
    if (proporcion < 1 && indices >= 180 && MeshoptSimplifier.supported) {
      const posicion = limpia.getAttribute('position').array;
      const objetivo = Math.max(36, Math.floor(indices * proporcion / 3) * 3);
      const [reducido] = MeshoptSimplifier.simplify(limpia.index.array, posicion, 3, objetivo, 0.035, ['Prune']);
      if (reducido.length) {
        limpia.setIndex(new BufferAttribute(reducido, 1));
        limpia = mergeVertices(limpia, 0.00001);
      }
    }
    if (!limpia.hasAttribute('normal')) limpia.computeVertexNormals();
    limpia.applyMatrix4(ajuste.clone().multiply(o.matrixWorld));
    if (!materiales.has(material)) materiales.set(material, new MeshStandardMaterial({
      color: material?.color || '#8898a2', metalness: 0.18, roughness: 0.62,
    }));
    escena.add(new Mesh(limpia, materiales.get(material)));
  }
  const bytes = await new USDZExporter().parseAsync(escena);
  return new Blob([bytes], { type: 'model/vnd.usdz+zip' });
}
