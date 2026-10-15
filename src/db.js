// Base de datos local del móvil (IndexedDB, mediante Dexie).
// Todo se guarda SOLO en este dispositivo: elementos, archivos (fotos, PDF, modelos 3D) y ajustes.
import Dexie from 'dexie';

export const db = new Dexie('infolens');
db.version(1).stores({
  elementos: 'id, nombre, referencia, tipo, modificado', // id = el que va en el QR (p. ej. V-0001)
  archivos: 'id',                                         // { id, nombre, tipoMime, blob }
  ajustes: 'clave',                                       // { clave, valor }
});
// Versión 2: "huellas visuales" para reconocer elementos sin QR
// { elementoId, modelo, dim, n, vectores: Int8Array (n × dim), escalas: Float32Array (n), fecha }
db.version(2).stores({
  huellas: 'elementoId',
});
// Versión 3: máquinas, anclas, localizaciones y guías (cada máquina es un entorno independiente)
//  maquinas:        { id, nombre, modelo, descripcion, creado, modificado }
//  elementos:       + maquinaId (la máquina a la que pertenece; null = sin asignar)
//  anclas:          { id (= el que va en su QR), maquinaId, nombre, descripcion, gravedad: [x,y,z] | null }
//  localizaciones:  { id, maquinaId, anclaId, elementoId, pos: [x,y,z], ruta: [[x,y,z]…], posIcono: [x,y,z] | null }
//  guias:           { id, maquinaId, nombre, tipo, descripcion, anclaId, portadaId, estado, pasos: […] }
db.version(3).stores({
  elementos: 'id, nombre, referencia, tipo, modificado, maquinaId',
  maquinas: 'id, nombre',
  anclas: 'id, maquinaId',
  localizaciones: 'id, maquinaId, anclaId, elementoId',
  guias: 'id, maquinaId, estado',
});

const nuevoIdArchivo = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Campos de un elemento que apuntan a la tabla "archivos"
// pdfId = ficha técnica, pdfConexionId = esquema de conexión (cada uno opcional)
export const CAMPOS_ARCHIVO = ['imagenId', 'miniaturaId', 'pdfId', 'pdfConexionId', 'modelo3dId'];

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
  return db.transaction('rw', [db.elementos, db.archivos, db.localizaciones, db.maquinas], async () => {
    const anterior = await db.elementos.get(datos.id);
    if (esNuevo && anterior) throw new Error(`Ya existe un elemento con el ID ${datos.id}`);
    const ahora = Date.now();
    const el = {
      ...(anterior || {}),
      ...datos,
      creado: anterior?.creado || ahora,
      modificado: ahora,
    };
    // La máquina tiene que existir (comprobación también al guardar, no solo en pantalla)
    if (el.maquinaId && !(await db.maquinas.get(el.maquinaId))) {
      throw new Error(`La máquina ${el.maquinaId} no existe.`);
    }
    // Si cambia de máquina, sus localizaciones de la máquina anterior dejan de valer
    if (anterior && (anterior.maquinaId || null) !== (el.maquinaId || null)) {
      await db.localizaciones.where('elementoId').equals(el.id).delete();
    }
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
  return db.transaction('rw', [db.elementos, db.archivos, db.huellas, db.localizaciones], async () => {
    const el = await db.elementos.get(id);
    if (!el) return;
    for (const campo of CAMPOS_ARCHIVO) if (el[campo]) await db.archivos.delete(el[campo]);
    await db.huellas.delete(id);
    await db.localizaciones.where('elementoId').equals(id).delete(); // sus localizaciones ya no sirven
    await db.elementos.delete(id);
  });
}

// ---------- huellas visuales (reconocimiento sin QR) ----------

export async function guardarHuella(huella) {
  await db.huellas.put({ ...huella, fecha: Date.now() });
}

export async function obtenerHuella(elementoId) {
  return (await db.huellas.get(elementoId)) || null;
}

export async function borrarHuella(elementoId) {
  await db.huellas.delete(elementoId);
}

export async function listarHuellas() {
  return db.huellas.toArray();
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

// ---------- archivos sueltos (por ejemplo, fotos y vídeos de las guías) ----------

export async function guardarArchivo(blob, nombre) {
  const id = nuevoIdArchivo();
  await db.archivos.put({ id, nombre: nombre || 'archivo', tipoMime: blob.type || 'application/octet-stream', blob });
  return id;
}

export async function borrarArchivos(ids) {
  const lista = (ids || []).filter(Boolean);
  if (lista.length) await db.archivos.bulkDelete(lista);
}
