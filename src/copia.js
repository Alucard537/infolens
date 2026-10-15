// Copia de seguridad: exportar e importar TODO (elementos + archivos) en un único .zip.
// Sirve también para pasar los datos del PC al iPhone (y al revés).
import { APP_NAME } from './config.js';
import { db, CAMPOS_ARCHIVO } from './db.js';
import { leerAjustes, guardarAjustes } from './ajustes.js';
import { crearZip, leerIndiceZip, leerEntradaZip } from './zip.js';
import { serializarHuella, deserializarHuella } from './reconocer/vectores.js';

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
  const elementos = await db.elementos.orderBy('id').toArray();
  const archivos = await db.archivos.toArray();
  const porId = new Map(archivos.map((a) => [a.id, a]));

  // Carpetas legibles: elementos/V-0001 - Nombre/foto.jpg, ficha.pdf, modelo.glb…
  // (así, al abrir el .zip en el PC, se ve qué archivo es de cada elemento)
  const rutaDe = new Map();
  const ext = (n, def) => { const m = /\.([a-z0-9]{1,5})$/i.exec(n || ''); return m ? m[1].toLowerCase() : def; };
  const filasCsv = [['id', 'nombre', 'referencia', 'tipo', 'descripcion', 'foto', 'pdf', 'modelo3d']];
  const carpetaDe = new Map();
  for (const el of elementos) {
    const carpeta = `elementos/${sanear(el.id)} - ${sanear(el.nombre).slice(0, 60).trim()}`;
    carpetaDe.set(el.id, carpeta);
    const nombres = {
      imagenId: `foto.${ext(porId.get(el.imagenId)?.nombre, 'jpg')}`,
      miniaturaId: `miniatura.${ext(porId.get(el.miniaturaId)?.nombre, 'jpg')}`,
      pdfId: sanear(porId.get(el.pdfId)?.nombre || 'ficha.pdf'),
      modelo3dId: sanear(porId.get(el.modelo3dId)?.nombre || 'modelo.glb'),
    };
    for (const c of CAMPOS_ARCHIVO) {
      if (el[c] && porId.has(el[c]) && !rutaDe.has(el[c])) rutaDe.set(el[c], `${carpeta}/${nombres[c]}`);
    }
    filasCsv.push([el.id, el.nombre, el.referencia, el.tipo === 'COMPUESTO' ? 'compuesto' : 'sencillo', el.descripcion || '',
      el.imagenId ? rutaDe.get(el.imagenId) : '', el.pdfId ? rutaDe.get(el.pdfId) : '', el.modelo3dId ? rutaDe.get(el.modelo3dId) : '']);
  }
  const meta = archivos.map((a) => ({
    id: a.id, nombre: a.nombre, tipoMime: a.tipoMime,
    ruta: rutaDe.get(a.id) || `archivos/${a.id}/${sanear(a.nombre)}`,
  }));
  // Huellas para reconocer sin QR: un archivo binario por elemento (vectores y después escalas)
  const huellas = (await db.huellas.toArray())
    .filter((h) => carpetaDe.has(h.elementoId))
    .map((h) => ({ elementoId: h.elementoId, ...serializarHuella(h) }));
  const metaHuellas = huellas.map((h) => ({
    elementoId: h.elementoId, ...h.meta,
    ruta: `${carpetaDe.get(h.elementoId)}/huella-reconocimiento.bin`,
  }));
  const { qrCm, fovGrados, posModelo } = leerAjustes();
  const indice = {
    formato: FORMATO, version: 1, app: APP_NAME, fecha: Date.now(),
    elementos, archivos: meta, huellas: metaHuellas, ajustes: { qrCm, fovGrados, posModelo },
  };
  // Lista de elementos para abrir con Excel (separador ";" y BOM para los acentos)
  const celda = (v) => { const t = String(v ?? ''); return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = '﻿' + filasCsv.map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
  const entradas = [
    { nombre: JSON_COPIA, blob: new Blob([JSON.stringify(indice, null, 1)], { type: 'application/json' }) },
    { nombre: 'elementos.csv', blob: new Blob([csv], { type: 'text/csv' }) },
    ...[
      ...archivos.map((a, i) => ({ nombre: meta[i].ruta, blob: a.blob })),
      ...huellas.map((h, i) => ({ nombre: metaHuellas[i].ruta, blob: new Blob(h.partes) })),
    ].sort((x, y) => x.nombre.localeCompare(y.nombre)),
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
    // Copiar los bytes de verdad: Safari del iPhone puede guardar mal un "trozo" (slice) de un archivo grande
    const bytes = await contenido.arrayBuffer();
    await db.archivos.put({
      id: m.id, nombre: m.nombre, tipoMime: m.tipoMime,
      blob: new Blob([bytes], { type: m.tipoMime || 'application/octet-stream' }),
    });
    importados.add(m.id);
  }

  // 1b) Huellas para reconocer sin QR
  for (const h of indice.huellas || []) {
    const e = porRuta.get(h.ruta);
    if (!e || !h.dim || !h.n) continue;
    const buf = await (await leerEntradaZip(archivoZip, e)).arrayBuffer();
    const huella = deserializarHuella(buf, h, h.elementoId);
    if (huella) await db.huellas.put(huella); // si está incompleta, se ignora
  }

  // 2) Elementos
  alAvanzar('Guardando elementos…', 1);
  const idsCopia = new Set();
  await db.transaction('rw', db.elementos, db.archivos, db.huellas, async () => {
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
    // ...y huellas de elementos que ya no existen
    const ids = new Set(await db.elementos.toCollection().primaryKeys());
    const huellasSobran = (await db.huellas.toCollection().primaryKeys()).filter((id) => !ids.has(id));
    await db.huellas.bulkDelete(huellasSobran);
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
