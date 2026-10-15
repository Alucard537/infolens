// Copia de seguridad: exportar e importar TODO (elementos + archivos) en un único .zip.
// Sirve también para pasar los datos del PC al iPhone (y al revés).
import { APP_NAME } from './config.js';
import { db, CAMPOS_ARCHIVO } from './db.js';
import { leerAjustes, guardarAjustes } from './ajustes.js';
import { crearZip, leerIndiceZip, leerEntradaZip } from './zip.js';

const FORMATO = 'infolens-copia';
const JSON_COPIA = 'infolens.json';

const sanear = (n) => String(n || 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);

export function nombreArchivoCopia() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${APP_NAME.toLowerCase()}-copia-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/** Crea el .zip con todo. alAvanzar(texto, fraccion 0-1). */
export async function exportarCopia(alAvanzar = () => {}) {
  alAvanzar('Leyendo la base de datos…', 0);
  const elementos = await db.elementos.toArray();
  const archivos = await db.archivos.toArray();
  const meta = archivos.map((a) => ({
    id: a.id, nombre: a.nombre, tipoMime: a.tipoMime, ruta: `archivos/${a.id}/${sanear(a.nombre)}`,
  }));
  const { qrCm, fovGrados } = leerAjustes();
  const indice = {
    formato: FORMATO, version: 1, app: APP_NAME, fecha: Date.now(),
    elementos, archivos: meta, ajustes: { qrCm, fovGrados },
  };
  const entradas = [
    { nombre: JSON_COPIA, blob: new Blob([JSON.stringify(indice, null, 1)], { type: 'application/json' }) },
    ...archivos.map((a, i) => ({ nombre: meta[i].ruta, blob: a.blob })),
  ];
  const zip = await crearZip(entradas, (i, n) => alAvanzar(`Preparando archivos ${i} de ${n}…`, n ? i / n : 1));
  guardarAjustes({ ultimaCopia: Date.now() });
  return { zip, elementos: elementos.length, archivos: archivos.length };
}

/**
 * Importa un .zip de copia.
 * modo 'combinar': añade los elementos nuevos y actualiza los que tienen el mismo ID (no borra nada más).
 * modo 'sustituir': el móvil queda exactamente igual que la copia (se borra lo que no esté en ella).
 */
export async function importarCopia(archivoZip, modo = 'combinar', alAvanzar = () => {}) {
  alAvanzar('Leyendo el .zip…', 0);
  const entradas = await leerIndiceZip(archivoZip);
  const porRuta = new Map(entradas.map((e) => [e.nombre, e]));
  const entJson = porRuta.get(JSON_COPIA);
  if (!entJson) throw new Error(`Este .zip no es una copia de ${APP_NAME}.`);
  let indice;
  try {
    indice = JSON.parse(await (await leerEntradaZip(archivoZip, entJson)).text());
  } catch {
    throw new Error('La copia está dañada (no se puede leer el índice).');
  }
  if (indice.formato !== FORMATO || !Array.isArray(indice.elementos)) {
    throw new Error(`Este .zip no es una copia de ${APP_NAME}.`);
  }

  // 1) Archivos (fotos, PDF, modelos). Se escriben uno a uno para no llenar la memoria.
  const metas = indice.archivos || [];
  const importados = new Set();
  let faltan = 0;
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    alAvanzar(`Importando archivos ${i + 1} de ${metas.length}…`, metas.length ? i / metas.length : 1);
    const e = porRuta.get(m.ruta);
    if (!e) { faltan++; continue; }
    const contenido = await leerEntradaZip(archivoZip, e);
    await db.archivos.put({
      id: m.id, nombre: m.nombre, tipoMime: m.tipoMime,
      blob: new Blob([contenido], { type: m.tipoMime || 'application/octet-stream' }),
    });
    importados.add(m.id);
  }

  // 2) Elementos
  alAvanzar('Guardando elementos…', 1);
  const idsCopia = new Set();
  await db.transaction('rw', db.elementos, db.archivos, async () => {
    for (const el of indice.elementos) {
      if (!el || !el.id) continue;
      idsCopia.add(el.id);
      for (const c of CAMPOS_ARCHIVO) if (el[c] && !importados.has(el[c])) el[c] = null; // archivo que no venía
      await db.elementos.put(el);
    }
    if (modo === 'sustituir') {
      const sobran = (await db.elementos.toCollection().primaryKeys()).filter((id) => !idsCopia.has(id));
      await db.elementos.bulkDelete(sobran);
    }
    // 3) Borrar archivos que ya no usa ningún elemento
    const usados = new Set();
    await db.elementos.each((el) => CAMPOS_ARCHIVO.forEach((c) => el[c] && usados.add(el[c])));
    const huerfanos = (await db.archivos.toCollection().primaryKeys()).filter((id) => !usados.has(id));
    await db.archivos.bulkDelete(huerfanos);
  });

  if (indice.ajustes && modo === 'sustituir') {
    const { qrCm, fovGrados } = indice.ajustes;
    guardarAjustes({ ...(qrCm ? { qrCm } : {}), ...(fovGrados ? { fovGrados } : {}) });
  }
  guardarAjustes({ ejemploCreado: true });
  return { elementos: idsCopia.size, archivos: importados.size, faltan };
}

/** Espacio que ocupan los datos de la app (aprox.), en bytes. */
export async function espacioUsado() {
  try {
    const est = await navigator.storage.estimate();
    return { usado: est.usage || 0, total: est.quota || 0 };
  } catch {
    return null;
  }
}
