// PRUEBA (diagnóstico): anclaje a la imagen del QR declarado en la RAÍZ del archivo (el "defaultPrim"),
// como en el ejemplo de la documentación de Apple (Preliminary_AnchoringAPI), en lugar de en la escena
// interior que crea three.js. Si el AR de Apple lo reconoce, el 3D no aparece hasta ver el QR y lo sigue
// si se mueve o se gira el QR.
import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { unzipSync, strToU8, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { pngQR, empaquetarUsdz } from './navegacion.js';

/**
 * contenidoG: escena en coordenadas del QR tumbado (x derecha, y arriba, −z ADELANTE = borde de arriba del QR).
 * opciones: textoQR, anchoCm (medida real de la imagen impresa), unidad 'cm' | 'm', imagen (png propio, opcional).
 */
export async function usdzImagenEnRaiz(contenidoG, { textoQR, anchoCm, unidad = 'cm', imagen = null }) {
  contenidoG.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      const e = m.isMeshStandardMaterial ? m : new THREE.MeshStandardMaterial({ color: m.color ? m.color.clone() : 0xffffff, map: m.map || null });
      e.side = THREE.FrontSide; e.transparent = false; e.opacity = 1;
      return e;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  const bytes = await new USDZExporter().parseAsync(contenidoG);
  const files = unzipSync(new Uint8Array(bytes));
  let usda = strFromU8(files['model.usda']);
  // Quitar el anclaje de plano que pone three.js en la escena interior
  usda = usda.replace(/\n\s*token preliminary:anchoring:type = "[^"]*"/, '').replace(/\n\s*token preliminary:planeAnchoring:alignment = "[^"]*"/, '');
  // La escena deja de ser una 'biblioteca de escenas' (formato de Reality Composer): una sola escena normal
  usda = usda.replace(/def Scope "Scenes" \(\s*kind = "sceneLibrary"\s*\)/, 'def Scope "Scenes"');
  // Anclaje de imagen en la raíz
  if (!/def Xform "Root"\n\{/.test(usda)) throw new Error('Formato inesperado del archivo.');
  const ancho = unidad === 'm' ? (anchoCm / 100).toFixed(4) : Number(anchoCm).toFixed(2);
  usda = usda.replace(/def Xform "Root"\n\{/, `def Xform "Root" (
    prepend apiSchemas = ["Preliminary_AnchoringAPI"]
)
{
    uniform token preliminary:anchoring:type = "image"
    rel preliminary:imageAnchoring:referenceImage = </Root/AnchoringReferenceImage>

    def Preliminary_ReferenceImage "AnchoringReferenceImage"
    {
        uniform asset image = @qr_ancla.png@
        uniform double physicalWidth = ${ancho}
    }
`);
  const nuevos = { 'model.usda': strToU8(usda) };
  for (const [k, v] of Object.entries(files)) if (k !== 'model.usda') nuevos[k] = v;
  nuevos['qr_ancla.png'] = imagen || await pngQR(textoQR);
  return new Blob([empaquetarUsdz(nuevos)], { type: 'model/vnd.usdz+zip' });
}
