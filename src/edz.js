// Importación de paquetes de artículos de EPLAN (.edz, del EPLAN Data Portal).
// Un .edz es un archivo 7-Zip con: los datos del artículo (XML), una foto y macros de esquema.
// De ahí se sacan: nombre, referencia, fabricante, descripción técnica, enlaces a fichas y la foto.
// (Los modelos 3D de EPLAN, si los hay, van en un formato cerrado que no se puede convertir.)
import SevenZip from '7z-wasm';
import wasmUrl from '7z-wasm/7zz.wasm?url';
import { atributosPart, datosDesdeEplan } from './edz-datos.js';

let modulo = null;
let contador = 0;
let observarListado = null;
const MB = 1024 * 1024;

function cargar7z() {
  if (!modulo) {
    modulo = SevenZip({
      locateFile: (ruta) => (ruta.endsWith('.wasm') ? wasmUrl : ruta),
      print: (linea) => observarListado?.(linea),
      printErr: () => {},
    });
  }
  return modulo;
}

const TIPO_IMAGEN = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp' };

function validarListado(s, ruta) {
  let entradas = false, archivos = 0, tamanos = 0, bytes = 0, invalido = false;
  observarListado = (linea) => {
    if (linea === '----------') { entradas = true; return; }
    if (!entradas) return;
    if (linea.startsWith('Path = ')) {
      archivos++;
      const nombre = linea.slice(7).replaceAll('\\', '/');
      if (nombre.startsWith('/') || /^[a-z]:/i.test(nombre) || nombre.split('/').includes('..')) invalido = true;
    } else if (linea.startsWith('Size = ')) {
      tamanos++;
      const tam = Number(linea.slice(7));
      if (!Number.isSafeInteger(tam) || tam < 0) invalido = true;
      bytes += tam;
    } else if (linea === 'Encrypted = +') invalido = true;
  };
  try {
    if (s.callMain(['l', '-slt', '-bsp0', ruta]) !== 0 || !archivos || invalido || tamanos !== archivos) {
      throw new Error('El archivo EDZ no se puede abrir.');
    }
  } finally { observarListado = null; }
  if (archivos > 4096 || bytes > 256 * MB) throw new Error('El contenido del EDZ supera el límite de 4096 entradas o 256 MB.');
}

/** Abre un .edz. Devuelve { datos, foto (Blob o null), tiene3d } */
export async function leerEdz(archivo) {
  if (archivo.size > 128 * MB) throw new Error('El archivo EDZ supera los 128 MB.');
  const s = await cargar7z();
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const dir = `/edz${++contador}`;
  const ruta = `${dir}/a.edz`;
  s.FS.mkdir(dir);
  try {
    s.FS.writeFile(ruta, bytes);
    validarListado(s, ruta);
    const rc = s.callMain(['x', ruta, `-o${dir}/out`, '-y', '-bso0', '-bsp0', '-bse0']);
    if (rc !== 0) throw new Error('No se pudo abrir (¿es un .edz de EPLAN?).');

    const lista = [];
    const recorrer = (p) => {
      for (const x of s.FS.readdir(p)) {
        if (x === '.' || x === '..') continue;
        const q = `${p}/${x}`;
        if (s.FS.isDir(s.FS.stat(q).mode)) recorrer(q); else lista.push(q);
      }
    };
    recorrer(`${dir}/out`);
    const leerTexto = (ruta) => new TextDecoder('utf-8').decode(s.FS.readFile(ruta));

    // El XML del artículo (el que no es de fabricante ni de definición de propiedades)
    const xmls = lista.filter((r) => /\/items\/partxml\/[^/]+\.part\.xml$/i.test(r));
    if (!xmls.length) throw new Error('No contiene datos de artículo de EPLAN.');
    const atributos = atributosPart(leerTexto(xmls[0]));
    if (!atributos) throw new Error('Los datos del artículo están dañados.');

    const rutaFoto = lista.find((r) => /\/items\/picture\/.+\.(jpe?g|png|gif|bmp)$/i.test(r));
    let foto = null;
    if (rutaFoto) {
      const ext = rutaFoto.split('.').pop().toLowerCase();
      foto = new Blob([s.FS.readFile(rutaFoto)], { type: TIPO_IMAGEN[ext] || 'image/jpeg' });
    }
    const manifiesto = lista.find((r) => r.endsWith('/out/manifest.xml'));
    const tiene3d = !!manifiesto && /graphicalmacro|3d/i.test(leerTexto(manifiesto).replace(/ItemDoesNotNeed3DMacro/g, ''));
    return { datos: datosDesdeEplan(atributos), foto, tiene3d };
  } finally {
    // Borrar los archivos temporales
    const borrar = (p) => {
      for (const x of s.FS.readdir(p)) {
        if (x === '.' || x === '..') continue;
        const q = `${p}/${x}`;
        if (s.FS.isDir(s.FS.stat(q).mode)) { borrar(q); s.FS.rmdir(q); } else s.FS.unlink(q);
      }
    };
    try { borrar(dir); s.FS.rmdir(dir); } catch {}
  }
}
