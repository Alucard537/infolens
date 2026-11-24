// Usuarios: "normal" (solo consulta) y "administrador" (añade y modifica).
// El verificador PBKDF2 queda en este dispositivo. La sesión vive en memoria.
import { leerAjustes, guardarAjustes } from './ajustes.js';

const ITERACIONES = 150_000;
export const MIN_LARGO = 6;
let sesionAdmin = false;

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
export const esAdmin = () => sesionAdmin;

export async function crearContrasena(contrasena) {
  if (String(contrasena).length < MIN_LARGO) throw new Error(`La contraseña debe tener al menos ${MIN_LARGO} caracteres.`);
  const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derivar(contrasena, sal, ITERACIONES);
  guardarAjustes({ adminClave: { sal, hash, iteraciones: ITERACIONES, fecha: Date.now() } });
  sesionAdmin = true;
}

export async function comprobarContrasena(contrasena) {
  const c = leerAjustes().adminClave;
  if (!c || !c.hash) return false;
  return (await derivar(contrasena, c.sal, c.iteraciones || ITERACIONES)) === c.hash;
}

export async function entrarComoAdmin(contrasena) {
  const ok = await comprobarContrasena(contrasena);
  if (ok) sesionAdmin = true;
  return ok;
}

export function salirDeAdmin() {
  sesionAdmin = false;
}

export async function cambiarContrasena(actual, nueva) {
  if (!(await comprobarContrasena(actual))) throw new Error('La contraseña actual no es correcta.');
  await crearContrasena(nueva);
}
