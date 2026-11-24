import { db, guardarArchivo, obtenerArchivo } from './db.js';
import { leerEntradaZip, leerIndiceZip } from './zip.js';
import { destinoDelPaso } from './ar/guia-recorrido.js';

export const MIME_MODELO_GUIA = 'model/vnd.usdz+zip';
export const MAX_MODELOS_GUIA = 24;
const MAX_BYTES = 32 * 1024 * 1024;

export const listarBiblioteca3D = () => db.archivos.filter((a) => a.tipoMime === MIME_MODELO_GUIA).toArray();

export async function importarBiblioteca3D(archivos, alAvanzar) {
  const errores = [];
  let cantidad = 0;
  const guardar = async (nombre, blob) => {
    alAvanzar(`Importando ${nombre}…`);
    if (!blob.size || blob.size > MAX_BYTES) throw new Error('El USDZ debe ocupar entre 1 byte y 32 MB.');
    const entradas = await leerIndiceZip(blob);
    if (!/\.(usd|usda|usdc)$/i.test(entradas[0]?.nombre || '') || entradas.some((e) => e.metodo !== 0)) {
      throw new Error('Elige un USDZ válido con una escena 3D.');
    }
    await guardarArchivo(new Blob([await blob.arrayBuffer()], { type: MIME_MODELO_GUIA }), nombre);
    cantidad++;
  };
  for (const archivo of archivos) {
    try {
      if (/\.zip$/i.test(archivo.name)) {
        const modelos = (await leerIndiceZip(archivo)).filter((e) => /\.usdz$/i.test(e.nombre));
        if (!modelos.length) throw new Error('El ZIP no contiene modelos USDZ.');
        for (const modelo of modelos) {
          const nombre = modelo.nombre.split('/').at(-1);
          try {
            if (modelo.tam > MAX_BYTES) throw new Error('El USDZ ocupa más de 32 MB.');
            await guardar(nombre, await leerEntradaZip(archivo, modelo));
          } catch (e) { errores.push(`${nombre} · ${e.message}`); }
        }
      } else if (/\.fbx$/i.test(archivo.name)) {
        alAvanzar(`Convirtiendo ${archivo.name}…`);
        const { convertirFbxAUsdz } = await import('./ar/importar-fbx.js');
        await guardar(archivo.name.replace(/\.fbx$/i, '.usdz'), await convertirFbxAUsdz(archivo));
      } else await guardar(archivo.name, archivo);
    } catch (e) { errores.push(`${archivo.name} · ${e.message}`); }
  }
  return { cantidad, errores };
}

export function colocacionValida(m) {
  const vector = (v, max) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && Math.abs(n) <= max);
  return !!m?.id && !!m.archivoId && !!m.anclaId && vector(m.pos, 100) && vector(m.rotacion, 3600) &&
    Number.isFinite(m.escala) && m.escala >= 0.01 && m.escala <= 100;
}

export function modelosColocados(guia, localizaciones) {
  if (!guia.anclaId) return [];
  const pasos = new Map((guia.pasos || []).map((p) => [p.id, p]));
  return (guia.modelos3d || []).flatMap((modelo) => {
    const paso = pasos.get(modelo.pasoId);
    const colocado = modelo.pasoId
      ? { ...modelo, anclaId: guia.anclaId, pos: paso && destinoDelPaso(paso, localizaciones)?.pos }
      : modelo;
    return colocado.anclaId === guia.anclaId && colocacionValida(colocado) ? [colocado] : [];
  }).slice(0, MAX_MODELOS_GUIA);
}

// La app nativa lee el archivo por partes desde el mismo origen que lo guardó en IndexedDB.
export async function parteModeloNativo(id, desde) {
  const archivo = await obtenerArchivo(id);
  if (archivo?.tipoMime !== MIME_MODELO_GUIA || !archivo.blob.size || archivo.blob.size > MAX_BYTES) return null;
  const parte = archivo.blob.slice(desde, desde + 384 * 1024);
  const lector = new FileReader();
  const datos = await new Promise((ok, fallo) => {
    lector.onload = () => ok(lector.result.split(',')[1]);
    lector.onerror = () => fallo(lector.error);
    lector.readAsDataURL(parte);
  });
  return { tam: archivo.blob.size, datos };
}
