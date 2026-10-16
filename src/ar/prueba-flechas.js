// PRUEBA: dos objetos unidos por flechas, para el AR de Apple con LiDAR.
// Objeto ROJO = salida (donde está el QR del ancla), objeto AZUL = llegada. Las flechas siguen los
// tramos (adelante / derecha / arriba en cm). Sin texturas ni textos: lo más parecido a la prueba que
// ya funciona, para saber si el problema está en el recorrido o en otra cosa.
// Lo usan la pantalla de inicio (generado en el móvil) y scripts/generar-prueba-flechas.mjs (archivo fijo).
import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { crearFlechas } from './navegacion.js';
import { puntosDeTramos } from '../coordenadas.js';

function objeto(color, forma) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
  const g = new THREE.Group();
  const cuerpo = forma === 'caja'
    ? new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat)
    : new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 32), mat);
  cuerpo.position.y = 0.06;
  const punta = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 24), mat);
  punta.position.y = 0.16;
  g.add(cuerpo, punta);
  return g;
}

/** Escena: objeto rojo en el origen, flechas por los tramos y objeto azul al final. */
export function escenaPruebaFlechas(tramos) {
  const grupo = new THREE.Group();
  const puntos = [new THREE.Vector3(0, 0, 0), ...puntosDeTramos(tramos).map((p) => new THREE.Vector3(...p))];
  // Las flechas empiezan y terminan un poco fuera de los objetos para que no queden tapadas
  grupo.add(crearFlechas(puntos, 0.5, { conLinea: false }));
  grupo.add(objeto(0xff3b30, 'caja'));
  const fin = objeto(0x0a84ff, 'cilindro');
  fin.position.copy(puntos[puntos.length - 1]);
  grupo.add(fin);
  return grupo;
}

/** .usdz de la prueba (mismas opciones que el ejemplo que funciona). */
export async function usdzPruebaFlechas(tramos) {
  const escena = escenaPruebaFlechas(tramos);
  escena.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => { m.side = THREE.FrontSide; m.transparent = false; m.opacity = 1; });
  });
  return new USDZExporter().parseAsync(escena);
}
