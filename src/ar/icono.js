// Icono 3D: disco azul claro semitransparente con una "i" blanca.
// Se construye a tamaño 1 (diámetro 1) y luego se escala según el tamaño del QR.
import * as THREE from 'three';

const AZUL = 0x7ec8f2;
const GRIS = 0x9aa5ad;

export function crearIcono(registrado = true) {
  const icono = new THREE.Group();
  const color = registrado ? AZUL : GRIS;

  // Disco (el cilindro de three.js va en el eje Y; lo giramos para que mire hacia el eje Z)
  const disco = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.08, 64),
    new THREE.MeshPhongMaterial({
      color, transparent: true, opacity: 0.5, shininess: 80, depthWrite: false,
    }),
  );
  disco.rotation.x = Math.PI / 2;
  icono.add(disco);

  // Borde un poco más visible
  const borde = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.03, 16, 64),
    new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.85 }),
  );
  icono.add(borde);

  // Letra "i" (punto + palo), blanca, sobre la cara delantera
  const blanco = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const palo = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.04), blanco);
  palo.position.set(0, -0.08, 0.06);
  icono.add(palo);
  const punto = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.04, 32), blanco);
  punto.rotation.x = Math.PI / 2;
  punto.position.set(0, 0.2, 0.06);
  icono.add(punto);

  return icono;
}

export function crearLuces(escena) {
  escena.add(new THREE.AmbientLight(0xffffff, 1.4));
  const luz = new THREE.DirectionalLight(0xffffff, 1.6);
  luz.position.set(0.5, 1, 1);
  escena.add(luz);
}
