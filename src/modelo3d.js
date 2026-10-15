// Prepara un modelo 3D para guardarlo: acepta .glb directamente y convierte STEP, IGES y STL a .glb.
import { crearGlb } from './glb.js';

const MB = 1024 * 1024;
export const EXTENSIONES_MODELO = ['glb', 'stp', 'step', 'igs', 'iges', 'stl'];

const extension = (n) => String(n || '').toLowerCase().split('.').pop();
const sinExtension = (n) => String(n || 'modelo').replace(/\.[^.]+$/, '');

async function cabecera(archivo, n) {
  return new Uint8Array(await archivo.slice(0, n).arrayBuffer());
}

// ---------- STEP / IGES (en un Worker para no congelar la pantalla) ----------
function convertirCad(archivo, formato) {
  return new Promise(async (ok, mal) => {
    const worker = new Worker(new URL('./cad-worker.js', import.meta.url), { type: 'module' });
    const terminar = () => worker.terminate();
    worker.onmessage = (e) => {
      terminar();
      if (e.data.ok) ok(e.data); else mal(new Error(e.data.error));
    };
    worker.onerror = (e) => { terminar(); mal(new Error('Error al convertir: ' + (e.message || 'desconocido'))); };
    const buffer = await archivo.arrayBuffer();
    worker.postMessage({ formato, buffer, nombre: sinExtension(archivo.name) }, [buffer]);
  });
}

// ---------- STL (binario o de texto) ----------
function leerStl(buffer) {
  const dv = new DataView(buffer);
  const n = buffer.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const pos = [], nor = [];
  if (buffer.byteLength === 84 + n * 50) {           // STL binario
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50;
      const nx = dv.getFloat32(o, true), ny = dv.getFloat32(o + 4, true), nz = dv.getFloat32(o + 8, true);
      for (let v = 0; v < 3; v++) {
        const q = o + 12 + v * 12;
        pos.push(dv.getFloat32(q, true), dv.getFloat32(q + 4, true), dv.getFloat32(q + 8, true));
        nor.push(nx, ny, nz);
      }
    }
  } else {                                            // STL de texto
    const texto = new TextDecoder().decode(buffer);
    let normal = [0, 0, 1];
    for (const linea of texto.split(/\r?\n/)) {
      const t = linea.trim().split(/\s+/);
      if (t[0] === 'facet' && t[1] === 'normal') normal = t.slice(2, 5).map(Number);
      else if (t[0] === 'vertex') { pos.push(...t.slice(1, 4).map(Number)); nor.push(...normal); }
    }
  }
  if (!pos.length) throw new Error('El archivo STL está vacío o dañado.');
  const indices = new Uint32Array(pos.length / 3).map((_, i) => i);
  return {
    meshes: [{ name: 'pieza', attributes: { position: { array: pos }, normal: { array: nor } }, index: { array: indices } }],
  };
}

/**
 * Devuelve { blob, nombre, aviso } listo para guardar como modelo3dId.
 * alAvanzar(texto) para mostrar "Convirtiendo…".
 */
export async function prepararModelo(archivo, alAvanzar = () => {}) {
  const ext = extension(archivo.name);
  const cab = await cabecera(archivo, 16);
  const texto = String.fromCharCode(...cab);
  let glb, triangulos = null, convertido = false;

  if (texto.startsWith('glTF')) {
    glb = archivo;
  } else if (ext === 'sat' || ext === 'sab') {
    throw new Error('Los archivos .sat (ACIS) no se pueden convertir gratis. Descarga el modelo del fabricante en formato STEP (.stp) y elige ese.');
  } else if (ext === 'stp' || ext === 'step' || texto.startsWith('ISO-10303-21')) {
    alAvanzar('Convirtiendo STEP a 3D… (puede tardar unos segundos)');
    ({ glb, triangulos } = await convertirCad(archivo, 'step'));
    convertido = true;
  } else if (ext === 'igs' || ext === 'iges') {
    alAvanzar('Convirtiendo IGES a 3D…');
    ({ glb, triangulos } = await convertirCad(archivo, 'iges'));
    convertido = true;
  } else if (ext === 'stl') {
    alAvanzar('Convirtiendo STL a 3D…');
    const r = crearGlb(leerStl(await archivo.arrayBuffer()), sinExtension(archivo.name));
    glb = r.glb; triangulos = r.triangulos; convertido = true;
  } else {
    throw new Error('Formato no admitido. Usa .glb, .stp/.step, .igs/.iges o .stl.');
  }

  const blob = new Blob([glb], { type: 'model/gltf-binary' });
  if (blob.size > 50 * MB) throw new Error('El modelo pesa más de 50 MB. Simplifícalo antes (por ejemplo en Blender, con "Decimate").');
  const nombre = convertido ? sinExtension(archivo.name) + '.glb' : archivo.name;
  const aviso = convertido ? `Convertido a .glb (${triangulos.toLocaleString('es-ES')} triángulos).` : '';
  return { blob, nombre, aviso };
}
