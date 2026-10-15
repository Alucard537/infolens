// Base de datos local del móvil (IndexedDB, mediante Dexie).
// Todo se guarda SOLO en este dispositivo: elementos, archivos (fotos, PDF, modelos 3D) y ajustes.
import Dexie from 'dexie';

export const db = new Dexie('infolens');
db.version(1).stores({
  elementos: 'id, nombre, referencia, tipo, modificado', // id = el que va en el QR (p. ej. V-0001)
  archivos: 'id',                                         // { id, nombre, tipoMime, blob }
  ajustes: 'clave',                                       // { clave, valor }
});

const nuevoIdArchivo = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Campos de un elemento que apuntan a la tabla "archivos"
export const CAMPOS_ARCHIVO = ['imagenId', 'miniaturaId', 'pdfId', 'modelo3dId'];

// ---------- elementos ----------

export async function listarElementos() {
  return db.elementos.orderBy('id').toArray();
}

export async function obtenerElemento(id) {
  return (await db.elementos.get(id)) || null;
}

export async function contarElementos() {
  return db.elementos.count();
}

/** Mapa id -> elemento, para que el escáner busque al instante. */
export async function mapaElementos() {
  const lista = await db.elementos.toArray();
  return new Map(lista.map((e) => [e.id, e]));
}

/** Normaliza un ID: mayúsculas, sin espacios, solo letras, números, guion, punto y barra baja. */
export function normalizarId(texto) {
  return String(texto || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9._-]/g, '').replace(/^-+|-+$/g, '');
}

/** Siguiente ID automático del tipo V-0001, V-0002… */
export async function siguienteId(prefijo = 'V-') {
  let max = 0;
  await db.elementos.where('id').startsWith(prefijo).eachPrimaryKey((id) => {
    const n = parseInt(String(id).slice(prefijo.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return prefijo + String(max + 1).padStart(4, '0');
}

/**
 * Guarda un elemento (nuevo o editado).
 * datos: { id, nombre, referencia, tipo, descripcion }
 * archivos: para cada campo de CAMPOS_ARCHIVO:
 *   - undefined -> no se toca
 *   - null      -> se borra el archivo que hubiera
 *   - { blob, nombre } -> se guarda (sustituyendo al anterior)
 */
export async function guardarElemento(datos, archivos = {}, esNuevo = false) {
  return db.transaction('rw', db.elementos, db.archivos, async () => {
    const anterior = await db.elementos.get(datos.id);
    if (esNuevo && anterior) throw new Error(`Ya existe un elemento con el ID ${datos.id}`);
    const ahora = Date.now();
    const el = {
      ...(anterior || {}),
      ...datos,
      creado: anterior?.creado || ahora,
      modificado: ahora,
    };
    for (const campo of CAMPOS_ARCHIVO) {
      const nuevo = archivos[campo];
      if (nuevo === undefined) continue;
      if (el[campo]) await db.archivos.delete(el[campo]);
      el[campo] = null;
      if (nuevo) {
        const id = nuevoIdArchivo();
        await db.archivos.put({
          id, nombre: nuevo.nombre || campo, tipoMime: nuevo.blob.type || 'application/octet-stream', blob: nuevo.blob,
        });
        el[campo] = id;
      }
    }
    await db.elementos.put(el);
    return el;
  });
}

export async function borrarElemento(id) {
  return db.transaction('rw', db.elementos, db.archivos, async () => {
    const el = await db.elementos.get(id);
    if (!el) return;
    for (const campo of CAMPOS_ARCHIVO) if (el[campo]) await db.archivos.delete(el[campo]);
    await db.elementos.delete(id);
  });
}

// ---------- archivos ----------

export async function obtenerArchivo(id) {
  return id ? (await db.archivos.get(id)) || null : null;
}

/** Crea una dirección temporal (blob:) para mostrar un archivo. Hay que liberarla con URL.revokeObjectURL. */
export async function urlArchivo(id) {
  const a = await obtenerArchivo(id);
  return a ? URL.createObjectURL(a.blob) : null;
}

// ---------- ajustes ----------

export async function leerTodosAjustes() {
  const filas = await db.ajustes.toArray();
  return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
}

export async function guardarAjuste(clave, valor) {
  await db.ajustes.put({ clave, valor });
}
