// Copia de seguridad: exportar e importar TODO (elementos + archivos) en un único .zip.
// Sirve también para pasar los datos del PC al iPhone (y al revés).
import { APP_NAME } from './config.js';
import { db, CAMPOS_ARCHIVO } from './db.js';
import { leerAjustes, guardarAjustes } from './ajustes.js';
import { crearZip, leerIndiceZip, leerEntradaZip } from './zip.js';
import { serializarHuella, deserializarHuella, MAX_IMAGENES } from './reconocer/vectores.js';
import { anclaParaMaquina, archivosDeGuia, maquinaActivaId, migrarDatosAntiguos } from './maquinas.js';
import { MIME_MODELO_GUIA } from './modelos-guia.js';

const FORMATO = 'infolens-copia';
const JSON_COPIA = 'infolens.json';
const MB = 1024 * 1024;
const MAX_ARCHIVO = 256 * MB;
const MAX_INDICE = 64 * MB;
const MAX_COPIA = 4096 * MB - 2;
const VIDA_TEMPORAL_MS = 24 * 60 * 60 * 1000;
const TABLAS_COPIA = ['maquinas', 'anclas', 'localizaciones', 'guias'];

const sanear = (n) => String(n || 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);

export function nombreArchivoCopia() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${APP_NAME.toLowerCase()}-copia-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/** Crea el .zip con todo. alAvanzar(texto, fraccion 0-1). */
export async function exportarCopia(alAvanzar = () => {}) {
  alAvanzar('Leyendo la base de datos…', 0);
  const tablas = [db.elementos, db.archivos, db.huellas, ...TABLAS_COPIA.map((t) => db[t])];
  const [elementos, archivos, huellasGuardadas, maquinas, anclas, localizaciones, guias] =
    await db.transaction('r', tablas, () => Promise.all(tablas.map((tabla) => tabla.toArray())));
  const porId = new Map(archivos.map((a) => [a.id, a]));

  // Carpetas legibles: elementos/V-0001 - Nombre/foto.jpg, ficha.pdf, modelo.glb…
  // (así, al abrir el .zip en el PC, se ve qué archivo es de cada elemento)
  const rutaDe = new Map();
  const ext = (n, def) => { const m = /\.([a-z0-9]{1,5})$/i.exec(n || ''); return m ? m[1].toLowerCase() : def; };
  const filasCsv = [['id', 'nombre', 'referencia', 'tipo', 'descripcion', 'foto', 'pdf', 'pdf_conexion', 'modelo3d']];
  const carpetaDe = new Map();
  for (const el of elementos) {
    const carpeta = `elementos/${sanear(el.id)} - ${sanear(el.nombre).slice(0, 60).trim()}`;
    carpetaDe.set(el.id, carpeta);
    // Cada tipo de archivo con su prefijo, para que nunca coincidan dos nombres en la misma carpeta
    const original = (c, def) => sanear(porId.get(el[c])?.nombre || def);
    const nombres = {
      imagenId: `foto.${ext(porId.get(el.imagenId)?.nombre, 'jpg')}`,
      miniaturaId: `miniatura.${ext(porId.get(el.miniaturaId)?.nombre, 'jpg')}`,
      pdfId: `ficha-tecnica - ${original('pdfId', 'ficha.pdf')}`,
      pdfConexionId: `conexion - ${original('pdfConexionId', 'conexion.pdf')}`,
      modelo3dId: `modelo-3d - ${original('modelo3dId', 'modelo.glb')}`,
    };
    for (const c of CAMPOS_ARCHIVO) {
      if (el[c] && porId.has(el[c]) && !rutaDe.has(el[c])) rutaDe.set(el[c], `${carpeta}/${nombres[c]}`);
    }
    const ruta = (c) => (el[c] ? rutaDe.get(el[c]) || '' : '');
    filasCsv.push([el.id, el.nombre, el.referencia, el.tipo === 'COMPUESTO' ? 'compuesto' : 'sencillo', el.descripcion || '',
      ruta('imagenId'), ruta('pdfId'), ruta('pdfConexionId'), ruta('modelo3dId')]);
  }
  // Máquinas, anclas, localizaciones y guías (y los archivos de las guías en su propia carpeta)
  for (const m of maquinas) if (m.fondoId && porId.has(m.fondoId)) rutaDe.set(m.fondoId, `maquinas/${sanear(m.id)}/fondo.jpg`);
  for (const g of guias) {
    const carpeta = `guias/${sanear(g.maquinaId)} - ${sanear(g.id)} - ${sanear(g.nombre).slice(0, 50).trim()}`;
    archivosDeGuia(g).forEach((fid, i) => {
      if (porId.has(fid) && !rutaDe.has(fid)) rutaDe.set(fid, `${carpeta}/${String(i + 1).padStart(2, '0')} - ${sanear(porId.get(fid).nombre)}`);
    });
  }
  const rutasUsadas = new Set();
  const meta = archivos.map((a) => {
    let ruta = rutaDe.get(a.id);
    if (!ruta || rutasUsadas.has(ruta)) ruta = `archivos/${encodeURIComponent(a.id)}/${sanear(a.nombre)}`;
    rutasUsadas.add(ruta);
    return { id: a.id, nombre: a.nombre, tipoMime: a.tipoMime, ruta };
  });
  // Huellas para reconocer sin QR: un archivo binario por elemento (vectores y después escalas)
  const huellas = huellasGuardadas
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
    maquinas, anclas, localizaciones, guias,
  };
  // Lista de elementos para abrir con Excel (separador ";" y BOM para los acentos)
  const celda = (v) => {
    let texto = String(v ?? '');
    if (/^\s*[=+\-@]|^[\t\r\n]/u.test(texto)) texto = "'" + texto;
    return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const csv = '﻿' + filasCsv.map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
  const manifiesto = new Blob([JSON.stringify(indice, null, 1)], { type: 'application/json' });
  if (manifiesto.size > MAX_INDICE) throw new Error('El catálogo es demasiado grande para una sola copia.');
  const entradas = [
    { nombre: JSON_COPIA, blob: manifiesto },
    { nombre: 'elementos.csv', blob: new Blob([csv], { type: 'text/csv' }) },
    ...[
      ...archivos.map((a, i) => ({ nombre: meta[i].ruta, blob: a.blob })),
      ...huellas.map((h, i) => ({ nombre: metaHuellas[i].ruta, blob: new Blob(h.partes) })),
    ].sort((x, y) => x.nombre.localeCompare(y.nombre)),
  ];
  if (entradas.some(({ blob }) => blob.size > MAX_ARCHIVO)) {
    throw new Error('Hay un archivo de más de 256 MB. Reduce su tamaño antes de exportar la copia.');
  }
  const zip = await crearZip(entradas, (i, n) => alAvanzar(`Preparando archivos ${i} de ${n}…`, n ? i / n : 1));
  guardarAjustes({ ultimaCopia: Date.now() });
  return { zip, elementos: elementos.length, archivos: archivos.length };
}

function registrosDe(indice, nombre, campoId = 'id') {
  const filas = indice[nombre];
  if (filas == null && nombre !== 'elementos') return [];
  if (!Array.isArray(filas)) throw new Error(`El listado de ${nombre} de la copia es inválido.`);
  const ids = new Set();
  for (const fila of filas) {
    const id = fila?.[campoId];
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new Error(`Hay un identificador inválido o repetido en ${nombre}.`);
    ids.add(id);
  }
  return filas;
}

/** Valida y prepara los archivos antes de cambiar el catálogo visible. */
export async function importarCopia(archivoZip, modo = 'combinar', alAvanzar = () => {}) {
  alAvanzar('Leyendo el .zip…', 0);
  if (modo !== 'combinar' && modo !== 'sustituir') throw new Error('Elige un modo de restauración válido.');
  if (archivoZip.size > MAX_COPIA) throw new Error('La copia supera los 4 GB. Divídela antes de importarla.');
  const entradas = await leerIndiceZip(archivoZip);
  const porRuta = new Map(entradas.map((e) => [e.nombre, e]));
  if (porRuta.size !== entradas.length) throw new Error('Hay nombres de archivo repetidos en el .zip.');
  const total = entradas.reduce((bytes, e) => bytes + e.tam, 0);
  if (total > MAX_COPIA || entradas.some((e) => e.tam > MAX_ARCHIVO)) throw new Error('El contenido del .zip supera el límite de 4 GB por copia o 256 MB por archivo.');
  const entJson = porRuta.get(JSON_COPIA);
  if (!entJson) throw new Error(`Este .zip no es una copia de ${APP_NAME}.`);
  if (entJson.tam > MAX_INDICE) throw new Error('El índice de la copia es demasiado grande.');
  let indice;
  try {
    indice = JSON.parse(await (await leerEntradaZip(archivoZip, entJson)).text());
  } catch {
    throw new Error('La copia está dañada (no se puede leer el índice).');
  }
  if (indice?.formato !== FORMATO || (indice.version != null && indice.version !== 1)) {
    throw new Error(`Este .zip no es una copia de ${APP_NAME}.`);
  }

  const elementos = registrosDe(indice, 'elementos');
  const idsCopia = new Set(elementos.map((e) => e.id));
  const metas = registrosDe(indice, 'archivos');
  const metaHuellas = registrosDe(indice, 'huellas', 'elementoId');
  const filas = Object.fromEntries(TABLAS_COPIA.map((t) => [t, registrosDe(indice, t)]));
  const porArchivo = new Map(metas.map((m) => [m.id, m]));
  const archivosNecesarios = [
    ...elementos.flatMap((e) => CAMPOS_ARCHIVO.map((campo) => e[campo])),
    ...filas.maquinas.map((m) => m.fondoId),
  ];
  for (const guia of filas.guias) {
    if (!Array.isArray(guia.pasos) || guia.pasos.some((p) => !p || typeof p !== 'object' ||
      ['imagenes', 'videos'].some((campo) => p[campo] != null && !Array.isArray(p[campo]))) ||
      (guia.modelos3d != null && (!Array.isArray(guia.modelos3d) || guia.modelos3d.some((m) => !m || porArchivo.get(m.archivoId)?.tipoMime !== MIME_MODELO_GUIA)))) {
      throw new Error(`La guía ${guia.nombre || guia.id} contiene pasos o modelos inválidos.`);
    }
    archivosNecesarios.push(...archivosDeGuia(guia));
  }
  const sinArchivo = archivosNecesarios.find((id) => id && !porArchivo.has(id));
  if (sinArchivo) throw new Error(`La copia está incompleta. Falta un archivo referenciado (${sinArchivo}).`);
  for (const meta of [...metas, ...metaHuellas]) {
    if (typeof meta.ruta !== 'string' || meta.ruta === JSON_COPIA || !porRuta.has(meta.ruta)) {
      throw new Error(`La copia está incompleta. Falta «${meta.nombre || meta.ruta || meta.elementoId || meta.id}».`);
    }
  }
  if (metaHuellas.some((h) => !idsCopia.has(h.elementoId) || !Number.isInteger(h.dim) || h.dim < 1 || h.dim > 4096 ||
      !Number.isInteger(h.n) || h.n < 1 || h.n > MAX_IMAGENES)) throw new Error('La copia contiene datos de reconocimiento inválidos.');

  const temporal = db.archivosDeRestauracion;
  const lote = crypto.randomUUID();
  const totalArchivos = metas.length + metaHuellas.length;
  const preparar = (i) => alAvanzar(`Verificando archivo ${i + 1} de ${totalArchivos}…`, i / totalArchivos * 0.9);
  try {
    await temporal.where('caduca').below(Date.now()).delete();
    for (const [i, m] of metas.entries()) {
      preparar(i);
      const contenido = await leerEntradaZip(archivoZip, porRuta.get(m.ruta));
      // Materializar el archivo evita errores de Safari al guardar una porción de un Blob grande.
      const blob = new Blob([await contenido.arrayBuffer()], { type: m.tipoMime || 'application/octet-stream' });
      const archivo = { id: m.id, nombre: m.nombre, tipoMime: blob.type, blob };
      await temporal.add({ lote, id: m.id, caduca: Date.now() + VIDA_TEMPORAL_MS, archivo });
    }
    for (const [i, h] of metaHuellas.entries()) {
      preparar(metas.length + i);
      const contenido = await leerEntradaZip(archivoZip, porRuta.get(h.ruta));
      const huella = deserializarHuella(await contenido.arrayBuffer(), h, h.elementoId);
      if (!huella || !huella.escalas.every((x) => Number.isFinite(x) && x > 0)) {
        throw new Error(`La huella de ${h.elementoId} está dañada.`);
      }
      await temporal.add({ lote, id: ['huella', h.elementoId], caduca: Date.now() + VIDA_TEMPORAL_MS, huella });
    }

    alAvanzar('Guardando el catálogo…', 0.95);
    const sustituir = modo === 'sustituir';
    const tablas = [db.elementos, db.archivos, db.huellas, temporal, ...TABLAS_COPIA.map((t) => db[t])];
    const maquinaActiva = await db.transaction('rw', tablas, async () => {
      if (sustituir) {
        await db.elementos.clear();
        await db.huellas.clear();
      }
      for (const t of TABLAS_COPIA) {
        if (sustituir) await db[t].clear();
        await db[t].bulkPut(filas[t]);
      }
      await db.elementos.bulkPut(elementos);
      for (const { id } of metas) {
        const registro = await temporal.get([lote, id]);
        if (!registro) throw new Error('La restauración ha caducado. Vuelve a abrir la copia.');
        await db.archivos.put(registro.archivo);
      }
      // La identidad viene del catálogo entrante. Una huella vieja del mismo ID puede ser de otra pieza.
      if (!sustituir) await db.huellas.bulkDelete([...idsCopia]);
      for (const h of metaHuellas) {
        const registro = await temporal.get([lote, ['huella', h.elementoId]]);
        if (!registro) throw new Error('La restauración ha caducado. Vuelve a abrir la copia.');
        await db.huellas.put(registro.huella);
      }

      await migrarDatosAntiguos({ activar: false });
      const [maquinas, anclas, componentes] = await Promise.all([
        db.maquinas.toCollection().primaryKeys(), db.anclas.toArray(), db.elementos.toArray(),
      ]);
      const idsMaquina = new Set(maquinas);
      const anclasPorId = new Map(anclas.map((a) => [a.id, a]));
      const elementosPorId = new Map(componentes.map((e) => [e.id, e]));
      const montaje = (anclaId, maquinaId) => anclaParaMaquina(anclasPorId.get(anclaId), maquinaId);
      for (const e of elementos) {
        if (e.maquinaId && !idsMaquina.has(e.maquinaId)) throw new Error(`Falta la máquina de ${e.nombre || e.id}.`);
      }
      for (const loc of filas.localizaciones) {
        if (!idsMaquina.has(loc.maquinaId) || !montaje(loc.anclaId, loc.maquinaId) ||
            elementosPorId.get(loc.elementoId)?.maquinaId !== loc.maquinaId) {
          throw new Error(`La localización ${loc.id} tiene referencias incompletas.`);
        }
      }
      for (const guia of filas.guias) {
        if (!idsMaquina.has(guia.maquinaId) || (guia.anclaId && !montaje(guia.anclaId, guia.maquinaId)) ||
            guia.pasos.some((p) => p.elementoId && elementosPorId.get(p.elementoId)?.maquinaId !== guia.maquinaId)) {
          throw new Error(`La guía ${guia.nombre || guia.id} tiene referencias incompletas.`);
        }
      }
      const usadas = new Set();
      componentes.forEach((el) => CAMPOS_ARCHIVO.forEach((c) => el[c] && usadas.add(el[c])));
      await db.guias.each((g) => {
        archivosDeGuia(g).forEach((id) => usadas.add(id));
        for (const m of g.modelos3d || []) usadas.add(m.archivoId);
      });
      await db.maquinas.each((m) => { if (m.fondoId) usadas.add(m.fondoId); });
      await db.archivos.filter((a) => a.tipoMime === MIME_MODELO_GUIA && (!sustituir || porArchivo.has(a.id)))
        .each((a) => usadas.add(a.id));
      const huerfanos = (await db.archivos.toCollection().primaryKeys()).filter((id) => !usadas.has(id));
      await db.archivos.bulkDelete(huerfanos);
      await temporal.where('lote').equals(lote).delete();
      const anterior = maquinaActivaId();
      if (anterior && await db.maquinas.get(anterior)) return anterior;
      return await db.maquinas.count() === 1 ? (await db.maquinas.toCollection().first()).id : null;
    });
    const qrCm = Number(indice.ajustes?.qrCm);
    guardarAjustes({ ejemploCreado: true, maquinaActiva, ...(sustituir && qrCm >= 1 && qrCm <= 100 ? { qrCm } : {}) });
    return { elementos: idsCopia.size, archivos: metas.length };
  } finally {
    await temporal.where('lote').equals(lote).delete().catch((error) => console.warn('Restauración temporal:', error));
  }
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
