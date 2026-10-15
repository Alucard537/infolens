// Usuarios: "normal" (solo consulta) y "administrador" (añade y modifica).
// La contraseña de administrador nunca se guarda tal cual: se guarda una "huella" cifrada
// (PBKDF2-SHA256 con sal aleatoria). Viaja dentro de las copias .zip del administrador, para que
// los teléfonos de los operarios queden protegidos con la misma contraseña.
// El modo administrador dura hasta que se pulsa "Salir".
import { leerAjustes, guardarAjustes } from './ajustes.js';

const ITERACIONES = 150_000;
export const MIN_LARGO = 6;

const aHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const deHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

async function derivar(contrasena, salHex, iteraciones) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(contrasena), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deHex(salHex), iterations: iteraciones }, clave, 256,
  );
  return aHex(bits);
}

export const hayContrasena = () => !!(leerAjustes().adminClave && leerAjustes().adminClave.hash);
export const esAdmin = () => !!leerAjustes().modoAdmin;

export async function crearContrasena(contrasena) {
  if (String(contrasena).length < MIN_LARGO) throw new Error(`La contraseña debe tener al menos ${MIN_LARGO} caracteres.`);
  const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derivar(contrasena, sal, ITERACIONES);
  guardarAjustes({ adminClave: { sal, hash, iteraciones: ITERACIONES, fecha: Date.now() }, modoAdmin: true });
}

export async function comprobarContrasena(contrasena) {
  const c = leerAjustes().adminClave;
  if (!c || !c.hash) return false;
  return (await derivar(contrasena, c.sal, c.iteraciones || ITERACIONES)) === c.hash;
}

export async function entrarComoAdmin(contrasena) {
  const ok = await comprobarContrasena(contrasena);
  if (ok) guardarAjustes({ modoAdmin: true });
  return ok;
}

export function salirDeAdmin() {
  guardarAjustes({ modoAdmin: false });
}

export async function cambiarContrasena(actual, nueva) {
  if (!(await comprobarContrasena(actual))) throw new Error('La contraseña actual no es correcta.');
  await crearContrasena(nueva);
}

/** Para la copia .zip: la huella cifrada de la contraseña (o null). */
export const claveParaCopia = () => (hayContrasena() ? leerAjustes().adminClave : null);

/** Al importar una copia que trae contraseña, este teléfono pasa a usar esa misma contraseña. */
export function aplicarClaveDeCopia(clave) {
  if (!clave || !clave.hash || !clave.sal) return;
  const actual = leerAjustes().adminClave;
  if (actual && actual.hash === clave.hash && actual.sal === clave.sal) return;
  guardarAjustes({ adminClave: { sal: clave.sal, hash: clave.hash, iteraciones: clave.iteraciones || ITERACIONES, fecha: clave.fecha || Date.now() } });
}
