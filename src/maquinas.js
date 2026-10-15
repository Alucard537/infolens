// Máquinas, anclas, localizaciones y guías.
// REGLA FUNDAMENTAL: cada máquina es un entorno independiente. Ningún elemento, ancla, coordenada
// ni guía de una máquina puede usarse con otra. Las comprobaciones se hacen AL GUARDAR y AL
// CONSULTAR (no solo en pantalla).
import { db, normalizarId, borrarArchivos } from './db.js';
import { leerAjustes, guardarAjustes } from './ajustes.js';

export const ID_GENERAL = 'GENERAL';

// ---------- máquina activa (la elegida en este dispositivo) ----------

export const maquinaActivaId = () => leerAjustes().maquinaActiva || null;

export async function maquinaActiva() {
  const id = maquinaActivaId();
  return id ? (await db.maquinas.get(id)) || null : null;
}

export function establecerMaquinaActiva(id) {
  guardarAjustes({ maquinaActiva: id || null });
}

/** ¿El elemento pertenece a la máquina activa? */
export const deLaMaquinaActiva = (el) => !!el && !!el.maquinaId && el.maquinaId === maquinaActivaId();

// ---------- máquinas ----------

export async function listarMaquinas() {
  return db.maquinas.orderBy('nombre').toArray();
}

export async function obtenerMaquina(id) {
  return id ? (await db.maquinas.get(id)) || null : null;
}

export async function guardarMaquina(datos, esNueva) {
  const id = normalizarId(datos.id);
  if (!id) throw new Error('Escribe un identificador para la máquina.');
  if (!String(datos.nombre || '').trim()) throw new Error('Escribe el nombre de la máquina.');
  return db.transaction('rw', db.maquinas, async () => {
    const anterior = await db.maquinas.get(id);
    if (esNueva && anterior) throw new Error(`Ya existe una máquina con el identificador ${id}.`);
    if (!esNueva && !anterior) throw new Error('Esa máquina ya no existe.');
    const ahora = Date.now();
    const m = {
      ...(anterior || {}),
      id,
      nombre: String(datos.nombre).trim(),
      modelo: String(datos.modelo || '').trim(),
      descripcion: String(datos.descripcion || '').trim(),
      creado: anterior?.creado || ahora,
      modificado: ahora,
    };
    await db.maquinas.put(m);
    return m;
  });
}

export async function dependenciasMaquina(id) {
  const [elementos, anclas, localizaciones, guias] = await Promise.all([
    db.elementos.where('maquinaId').equals(id).count(),
    db.anclas.where('maquinaId').equals(id).count(),
    db.localizaciones.where('maquinaId').equals(id).count(),
    db.guias.where('maquinaId').equals(id).count(),
  ]);
  return { elementos, anclas, localizaciones, guias };
}

/** Borra una máquina: sus elementos quedan "sin máquina" (no se borran); sus anclas, localizaciones y guías sí. */
export async function borrarMaquina(id) {
  const guias = await db.guias.where('maquinaId').equals(id).toArray();
  await db.transaction('rw', [db.maquinas, db.elementos, db.anclas, db.localizaciones, db.guias], async () => {
    await db.elementos.where('maquinaId').equals(id).modify({ maquinaId: null });
    await db.localizaciones.where('maquinaId').equals(id).delete();
    await db.anclas.where('maquinaId').equals(id).delete();
    await db.guias.where('maquinaId').equals(id).delete();
    await db.maquinas.delete(id);
  });
  await borrarArchivos(guias.flatMap(archivosDeGuia));
  if (maquinaActivaId() === id) establecerMaquinaActiva(null);
}

// ---------- elementos de una máquina ----------

export async function elementosDeMaquina(maquinaId) {
  if (!maquinaId) return [];
  return (await db.elementos.where('maquinaId').equals(maquinaId).toArray()).sort((a, b) => a.id.localeCompare(b.id));
}

export async function elementosSinMaquina() {
  return (await db.elementos.toArray()).filter((e) => !e.maquinaId).sort((a, b) => a.id.localeCompare(b.id));
}

/** Asocia un elemento existente a una máquina (si venía de otra, sus localizaciones antiguas se borran). */
export async function asignarElemento(elementoId, maquinaId) {
  if (!(await db.maquinas.get(maquinaId))) throw new Error('Esa máquina no existe.');
  await db.transaction('rw', db.elementos, db.localizaciones, async () => {
    const el = await db.elementos.get(elementoId);
    if (!el) throw new Error('Ese elemento no existe.');
    if (el.maquinaId !== maquinaId) await db.localizaciones.where('elementoId').equals(elementoId).delete();
    await db.elementos.update(elementoId, { maquinaId, modificado: Date.now() });
  });
}

/** Desvincula un elemento de su máquina SIN borrarlo (y quita sus localizaciones). */
export async function desvincularElemento(elementoId) {
  await db.transaction('rw', db.elementos, db.localizaciones, async () => {
    await db.localizaciones.where('elementoId').equals(elementoId).delete();
    await db.elementos.update(elementoId, { maquinaId: null, modificado: Date.now() });
  });
}

// ---------- anclas ----------

export async function listarAnclas(maquinaId) {
  if (!maquinaId) return [];
  return (await db.anclas.where('maquinaId').equals(maquinaId).toArray()).sort((a, b) => a.id.localeCompare(b.id));
}

export async function obtenerAncla(id) {
  return id ? (await db.anclas.get(id)) || null : null;
}

export async function mapaAnclas() {
  return new Map((await db.anclas.toArray()).map((a) => [a.id, a]));
}

export async function siguienteIdAncla(maquinaId) {
  const base = `A-${normalizarId(maquinaId)}-`;
  let n = 1;
  while (await db.anclas.get(base + n)) n++;
  return base + n;
}

export async function guardarAncla(datos, esNueva) {
  const id = normalizarId(datos.id);
  if (!id) throw new Error('Escribe el identificador del ancla (es lo que lleva su QR).');
  if (!(await db.maquinas.get(datos.maquinaId))) throw new Error('El ancla tiene que pertenecer a una máquina que exista.');
  return db.transaction('rw', db.anclas, db.elementos, async () => {
    const anterior = await db.anclas.get(id);
    if (esNueva && anterior) throw new Error(`Ya existe un ancla con el identificador ${id}.`);
    if (anterior && anterior.maquinaId !== datos.maquinaId) throw new Error(`El ancla ${id} pertenece a otra máquina (${anterior.maquinaId}).`);
    // Si su QR coincide con el de un elemento, ese elemento tiene que ser de la misma máquina
    const el = await db.elementos.get(id);
    if (el && el.maquinaId !== datos.maquinaId) throw new Error(`El QR ${id} ya es de un elemento de otra máquina. Usa otro identificador.`);
    const a = {
      ...(anterior || {}),
      id,
      maquinaId: datos.maquinaId,
      nombre: String(datos.nombre || '').trim() || id,
      descripcion: String(datos.descripcion || '').trim(),
      gravedad: datos.gravedad !== undefined ? datos.gravedad : anterior?.gravedad || null,
      modificado: Date.now(),
    };
    await db.anclas.put(a);
    return a;
  });
}

/** Guarda cómo está colocado físicamente el QR del ancla (su "arriba" respecto al QR). */
export async function guardarGravedadAncla(id, gravedad) {
  await db.anclas.update(id, { gravedad: gravedad.map((n) => Math.round(n * 1000) / 1000), modificado: Date.now() });
}

export async function dependenciasAncla(id) {
  const [localizaciones, guias] = await Promise.all([
    db.localizaciones.where('anclaId').equals(id).count(),
    db.guias.filter((g) => g.anclaId === id).count(),
  ]);
  return { localizaciones, guias };
}

/** Borra un ancla y sus localizaciones; las guías que la usaban quedan sin ancla (en borrador). */
export async function borrarAncla(id) {
  await db.transaction('rw', db.anclas, db.localizaciones, db.guias, async () => {
    await db.localizaciones.where('anclaId').equals(id).delete();
    await db.guias.filter((g) => g.anclaId === id).modify({ anclaId: null, estado: 'borrador' });
    await db.anclas.delete(id);
  });
}

// ---------- localizaciones (elemento + ancla + máquina → coordenadas) ----------

const idLocalizacion = (anclaId, elementoId) => `${anclaId}>${elementoId}`;

/** Comprueba la coherencia máquina–elemento–ancla. Devuelve un texto de error o null. */
export async function problemaCoherencia(maquinaId, anclaId, elementoId) {
  const [m, a, e] = await Promise.all([db.maquinas.get(maquinaId), db.anclas.get(anclaId), db.elementos.get(elementoId)]);
  if (!m) return 'La máquina no existe.';
  if (!a) return 'El ancla no existe.';
  if (!e) return 'El elemento no existe.';
  if (a.maquinaId !== maquinaId) return `El ancla ${anclaId} no pertenece a la máquina ${maquinaId}.`;
  if (e.maquinaId !== maquinaId) return `El elemento ${elementoId} no pertenece a la máquina ${maquinaId}.`;
  return null;
}

const redondear = (p) => p.map((n) => Math.round(Number(n) * 1000) / 1000);
const esPunto = (p) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(Number(n)));

export async function guardarLocalizacion({ maquinaId, anclaId, elementoId, pos, ruta = [], posIcono = null }) {
  const problema = await problemaCoherencia(maquinaId, anclaId, elementoId);
  if (problema) throw new Error(problema);
  if (!esPunto(pos)) throw new Error('La posición necesita X, Y y Z.');
  if (!ruta.every(esPunto)) throw new Error('Algún punto intermedio no tiene X, Y y Z.');
  if (posIcono && !esPunto(posIcono)) throw new Error('La posición del icono necesita X, Y y Z.');
  const loc = {
    id: idLocalizacion(anclaId, elementoId), maquinaId, anclaId, elementoId,
    pos: redondear(pos), ruta: ruta.map(redondear), posIcono: posIcono ? redondear(posIcono) : null,
    modificado: Date.now(),
  };
  await db.localizaciones.put(loc);
  return loc;
}

export async function borrarLocalizacion(id) {
  await db.localizaciones.delete(id);
}

export async function localizacionesDeElemento(elementoId) {
  return db.localizaciones.where('elementoId').equals(elementoId).toArray();
}

/**
 * Localizaciones válidas para navegar desde un ancla de la máquina activa.
 * Se comprueba la coherencia en la consulta (regla 7): máquina activa = máquina del ancla = máquina del elemento.
 */
export async function localizacionesDeAncla(maquinaId, anclaId) {
  const ancla = await db.anclas.get(anclaId);
  if (!ancla || ancla.maquinaId !== maquinaId) return [];
  const locs = await db.localizaciones.where('anclaId').equals(anclaId).toArray();
  const res = [];
  for (const l of locs) {
    if (l.maquinaId !== maquinaId) continue;
    const el = await db.elementos.get(l.elementoId);
    if (!el || el.maquinaId !== maquinaId) continue;
    res.push({ ...l, elemento: el });
  }
  return res.sort((a, b) => a.elemento.nombre.localeCompare(b.elemento.nombre));
}

// ---------- guías ----------

export const ESTADOS_GUIA = { borrador: 'Borrador', publicada: 'Publicada', desactivada: 'Desactivada' };
export const TIPOS_GUIA = { localizacion: 'Localización de componentes', mantenimiento: 'Mantenimiento' };

export function archivosDeGuia(g) {
  return [g.portadaId, ...(g.pasos || []).flatMap((p) => [...(p.imagenes || []), ...(p.videos || [])])].filter(Boolean);
}

export async function listarGuias(maquinaId, { soloPublicadas = false } = {}) {
  if (!maquinaId) return [];
  const lista = await db.guias.where('maquinaId').equals(maquinaId).toArray();
  return lista.filter((g) => !soloPublicadas || g.estado === 'publicada').sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function obtenerGuia(id) {
  return id ? (await db.guias.get(id)) || null : null;
}

async function siguienteIdGuia() {
  let n = (await db.guias.count()) + 1;
  while (await db.guias.get('G-' + String(n).padStart(4, '0'))) n++;
  return 'G-' + String(n).padStart(4, '0');
}

export function pasoVacio() {
  return {
    id: Math.random().toString(36).slice(2, 10),
    titulo: '', texto: '', imagenes: [], videos: [],
    elementoId: null, flechas: true, icono: true, rutaPropia: null, destinoPropio: null,
    advertencia: '', confirmar: false, comprobaciones: [],
  };
}

/** Guarda una guía comprobando que todo (ancla y elementos de los pasos) es de su máquina. */
export async function guardarGuia(datos) {
  if (!String(datos.nombre || '').trim()) throw new Error('Escribe el nombre de la guía.');
  if (!(await db.maquinas.get(datos.maquinaId))) throw new Error('La guía tiene que pertenecer a una máquina que exista.');
  if (datos.anclaId) {
    const a = await db.anclas.get(datos.anclaId);
    if (!a || a.maquinaId !== datos.maquinaId) throw new Error('El ancla elegida no pertenece a la máquina de la guía.');
  }
  for (const [i, p] of (datos.pasos || []).entries()) {
    if (!p.elementoId) continue;
    const el = await db.elementos.get(p.elementoId);
    if (!el || el.maquinaId !== datos.maquinaId) throw new Error(`Paso ${i + 1}: el elemento ${p.elementoId} no pertenece a la máquina de la guía.`);
  }
  if (datos.estado === 'publicada') {
    if (!datos.anclaId) throw new Error('Para publicarla, la guía necesita un ancla QR.');
    if (!(datos.pasos || []).length) throw new Error('Para publicarla, la guía necesita al menos un paso.');
  }
  const id = datos.id || (await siguienteIdGuia());
  const anterior = await db.guias.get(id);
  if (anterior && anterior.maquinaId !== datos.maquinaId) throw new Error('No se puede mover una guía a otra máquina.');
  const g = {
    ...(anterior || {}),
    ...datos,
    id,
    nombre: String(datos.nombre).trim(),
    estado: ESTADOS_GUIA[datos.estado] ? datos.estado : 'borrador',
    tipo: TIPOS_GUIA[datos.tipo] ? datos.tipo : 'localizacion',
    creado: anterior?.creado || Date.now(),
    modificado: Date.now(),
  };
  await db.guias.put(g);
  // Borrar los archivos que ya no usa la guía (fotos o vídeos quitados)
  if (anterior) {
    const usados = new Set(archivosDeGuia(g));
    await borrarArchivos(archivosDeGuia(anterior).filter((f) => !usados.has(f)));
  }
  return g;
}

export async function borrarGuia(id) {
  const g = await db.guias.get(id);
  if (!g) return;
  await db.guias.delete(id);
  await borrarArchivos(archivosDeGuia(g));
}

/** Duplica una guía (con copia de sus archivos) como borrador. */
export async function duplicarGuia(id) {
  const g = await db.guias.get(id);
  if (!g) throw new Error('La guía no existe.');
  const copiar = async (fid) => {
    const a = fid && (await db.archivos.get(fid));
    if (!a) return null;
    const nuevo = Math.random().toString(36).slice(2) + Date.now().toString(36);
    await db.archivos.put({ ...a, id: nuevo });
    return nuevo;
  };
  const pasos = [];
  for (const p of g.pasos || []) {
    pasos.push({
      ...p,
      id: Math.random().toString(36).slice(2, 10),
      imagenes: (await Promise.all((p.imagenes || []).map(copiar))).filter(Boolean),
      videos: (await Promise.all((p.videos || []).map(copiar))).filter(Boolean),
    });
  }
  const { id: _quitar, ...resto } = g;
  return guardarGuia({ ...resto, id: null, nombre: g.nombre + ' (copia)', estado: 'borrador', portadaId: await copiar(g.portadaId), pasos });
}

// ---------- paso de datos antiguos al sistema de máquinas ----------

/**
 * Si hay elementos pero ninguna máquina (datos de antes de esta versión o copia antigua),
 * se crea la máquina GENERAL con todos ellos. Las posiciones guardadas con la versión anterior
 * (campo "nav" de los elementos) se convierten en anclas y localizaciones.
 */
export async function migrarDatosAntiguos() {
  const [nMaq, nEl] = await Promise.all([db.maquinas.count(), db.elementos.count()]);
  if (nMaq === 0 && nEl > 0) {
    await db.maquinas.put({ id: ID_GENERAL, nombre: 'General', modelo: '', descripcion: 'Creada automáticamente con los elementos que ya existían.', creado: Date.now(), modificado: Date.now() });
    await db.elementos.filter((e) => !e.maquinaId).modify({ maquinaId: ID_GENERAL });
  }
  const conNav = await db.elementos.filter((e) => e.nav && e.nav.ancla).toArray();
  for (const e of conNav) {
    try {
      const anclaEl = await db.elementos.get(e.nav.ancla);
      const maquinaId = e.maquinaId || anclaEl?.maquinaId;
      if (maquinaId && (await db.maquinas.get(maquinaId)) && !(await db.anclas.get(e.nav.ancla))) {
        await db.anclas.put({
          id: e.nav.ancla, maquinaId, nombre: anclaEl ? anclaEl.nombre : e.nav.ancla, descripcion: '',
          gravedad: anclaEl?.anclaGravedad || null, modificado: Date.now(),
        });
      }
      if (maquinaId) await guardarLocalizacion({ maquinaId, anclaId: e.nav.ancla, elementoId: e.id, pos: e.nav.pos, ruta: e.nav.ruta || [] });
    } catch (err) {
      console.warn('No se pudo convertir la posición antigua de', e.id, err);
    }
    await db.elementos.update(e.id, { nav: undefined });
  }
  if (!maquinaActivaId()) {
    const primera = (await db.maquinas.orderBy('nombre').first());
    if (primera && (await db.maquinas.count()) === 1) establecerMaquinaActiva(primera.id);
  }
}
