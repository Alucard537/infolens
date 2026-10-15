// Dirección "arriba" del mundo real (contraria a la gravedad), vista desde la cámara.
// Se calcula con el sensor de orientación del móvil. Sirve para que la "i" esté siempre de pie,
// aunque el QR esté en el suelo, en una pared o inclinado.
//
// Coordenadas: las de la cámara de three.js con la cámara trasera, que coinciden con las del
// móvil en vertical: x = derecha de la pantalla, y = parte de arriba de la pantalla, z = hacia el usuario.
import * as THREE from 'three';

import { pedirPermisoSensor, faltaPermiso } from './permiso-sensor.js';

export { pedirPermisoSensor, faltaPermiso };

const Q_CAMARA_TRASERA = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° en X
const EJE_Z = new THREE.Vector3(0, 0, 1);

export function crearSensorVertical() {
  const arriba = new THREE.Vector3(0, 1, 0);   // valor suavizado que se usa
  const objetivo = new THREE.Vector3(0, 1, 0); // última lectura del sensor
  let recibido = false;

  const alGirar = (e) => {
    if (e.beta == null || e.gamma == null) return;
    const b = (e.beta * Math.PI) / 180;
    const g = (e.gamma * Math.PI) / 180;
    // "Arriba" del mundo en coordenadas del móvil (independiente de la brújula)
    const x = -Math.sin(g) * Math.cos(b);
    const y = Math.sin(b);
    const z = Math.cos(g) * Math.cos(b);
    // Si la pantalla está girada (horizontal), pasar a coordenadas de la pantalla
    const angulo = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * Math.PI / 180;
    const xs = Math.cos(angulo) * x - Math.sin(angulo) * y;
    const ys = Math.sin(angulo) * x + Math.cos(angulo) * y;
    objetivo.set(xs, ys, z).normalize();
    recibido = true;
    // Giro completo de la cámara respecto al mundo (para el "ancla": que un objeto se quede quieto
    // en su sitio aunque se gire el móvil). Mismo cálculo que DeviceOrientationControls de three.js.
    if (e.alpha != null) {
      euler.set(b, (e.alpha * Math.PI) / 180, -g, 'YXZ');
      giroObjetivo.setFromEuler(euler).multiply(Q_CAMARA_TRASERA).multiply(qPantalla.setFromAxisAngle(EJE_Z, -angulo));
      if (!tieneGiro) giro.copy(giroObjetivo);
      tieneGiro = true;
    }
  };
  const euler = new THREE.Euler();
  const giro = new THREE.Quaternion(), giroObjetivo = new THREE.Quaternion(), qPantalla = new THREE.Quaternion();
  let tieneGiro = false;
  window.addEventListener('deviceorientation', alGirar);

  return {
    /** Giro de la cámara (cámara -> mundo), suavizado. null si el móvil no da ese dato. */
    giro(dt) {
      if (!tieneGiro) return null;
      giro.slerp(giroObjetivo, 1 - Math.exp(-dt * 25));
      return giro;
    },
    /** Devuelve el vector "arriba" suavizado (dt en segundos). Sin sensor: arriba de la pantalla. */
    leer(dt) {
      if (!recibido) return arriba.set(0, 1, 0);
      arriba.lerp(objetivo, 1 - Math.exp(-dt * 10)).normalize();
      return arriba;
    },
    get activo() { return recibido; },
    detener() { window.removeEventListener('deviceorientation', alGirar); },
  };
}
