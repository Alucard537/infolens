// Máquinas, anclas, localizaciones y guías.
// Cada máquina tiene sus propios elementos, guías y coordenadas. Un QR de ancla puede tener
// un montaje distinto en cada máquina donde se habilita.
import { db, normalizarId, borrarArchivos, guardarArchivo, siguienteId, CAMPOS_ARCHIVO, pasoSinElemento, quitarReferenciasDelElemento } from './db.js';
import { leerAjustes, guardarAjustes } from './ajustes.js';
import { CARAS_MAQUINA, ORIENTACIONES_QR, calibracionSubanclaValida, giroSubanclaValido, subanclasDe } from './subanclas.js';

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
    listarAnclas(id).then((lista) => lista.length),
    db.localizaciones.where('maquinaId').equals(id).count(),
    db.guias.where('maquinaId').equals(id).count(),
  ]);
  return { elementos, anclas, localizaciones, guias };
}

/** Borra los datos de la máquina y conserva los montajes de las anclas que se usan en otras. */
export async function borrarMaquina(id) {
  await db.transaction('rw', [db.maquinas, db.elementos, db.anclas, db.localizaciones, db.guias, db.archivos], async () => {
    const guias = await db.guias.where('maquinaId').equals(id).toArray();
    await db.elementos.where('maquinaId').equals(id).modify({ maquinaId: null });
    await db.localizaciones.where('maquinaId').equals(id).delete();
    for (const ancla of await db.anclas.toArray()) {
      if (!anclaParaMaquina(ancla, id)) continue;
      const montajes = { ...montajesDelAncla(ancla) };
      delete montajes[id];
      if (Object.keys(montajes).length) await guardarMontajes(ancla, montajes);
      else await db.anclas.delete(ancla.id);
    }
    await db.guias.where('maquinaId').equals(id).delete();
    await borrarArchivos(guias.flatMap(archivosDeGuia));
    await db.maquinas.delete(id);
  });
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
  return db.transaction('rw', [db.maquinas, db.elementos, db.localizaciones, db.guias], async () => {
    if (!(await db.maquinas.get(maquinaId))) throw new Error('Esa máquina no existe.');
    const el = await db.elementos.get(elementoId);
    if (!el) throw new Error('Ese elemento no existe.');
    if (el.maquinaId === maquinaId) return el;
    const movido = { ...el, maquinaId, modificado: Date.now() };
    await quitarReferenciasDelElemento(el);
    await db.elementos.put(movido);
    return movido;
  });
}

/** Desvincula un elemento de su máquina SIN borrarlo (y quita sus localizaciones). */
export async function desvincularElemento(elementoId) {
  await db.transaction('rw', db.elementos, db.localizaciones, db.guias, async () => {
    const elemento = await db.elementos.get(elementoId);
    if (!elemento) return;
    await quitarReferenciasDelElemento(elemento);
    await db.elementos.update(elementoId, { maquinaId: null, modificado: Date.now() });
  });
}

async function copiarArchivo(id) {
  const archivo = id && await db.archivos.get(id);
  return archivo ? guardarArchivo(archivo.blob, archivo.nombre) : null;
}

async function copiarElementoEn(elemento, maquinaId) {
  let id = await siguienteId();
  while (await db.anclas.get(id)) id = 'V-' + String(Number(id.slice(2)) + 1).padStart(4, '0');
  const copia = { ...elemento, id, maquinaId, creado: Date.now(), modificado: Date.now() };
  if (elemento.maquinaId === maquinaId) copia.nombre = `${elemento.nombre || elemento.id} (copia)`;
  delete copia.nav;
  for (const campo of CAMPOS_ARCHIVO) copia[campo] = await copiarArchivo(elemento[campo]);
  await db.elementos.add(copia);
  const huella = await db.huellas.get(elemento.id);
  if (huella) await db.huellas.put({ ...huella, elementoId: copia.id });
  return copia;
}

export async function duplicarElemento(id, maquinaId) {
  return db.transaction('rw', [db.maquinas, db.elementos, db.archivos, db.huellas, db.anclas], async () => {
    if (!(await db.maquinas.get(maquinaId))) throw new Error('Esa máquina no existe.');
    const elemento = await db.elementos.get(id);
    if (!elemento) throw new Error('Ese elemento no existe.');
    return copiarElementoEn(elemento, maquinaId);
  });
}

// ---------- anclas ----------

const montajeDe = ({ gravedad = null, cara = null, orientacion = null, subanclas = [] } = {}) => ({ gravedad, cara, orientacion, subanclas });

function montajesDelAncla(ancla) {
  return ancla?.montajes ?? (ancla?.maquinaId ? { [ancla.maquinaId]: montajeDe(ancla) } : {});
}

export const maquinasDelAncla = (ancla) => Object.keys(montajesDelAncla(ancla));

export function anclaParaMaquina(ancla, maquinaId) {
  const montajes = montajesDelAncla(ancla);
  return maquinaId && Object.hasOwn(montajes, maquinaId) ? { ...ancla, ...montajes[maquinaId], maquinaId } : null;
}

async function guardarMontajes(ancla, montajes) {
  const maquinaId = Object.hasOwn(montajes, ancla.maquinaId) ? ancla.maquinaId : Object.keys(montajes)[0] ?? null;
  const actualizado = { ...ancla, ...montajeDe(montajes[maquinaId] ?? ancla), maquinaId, montajes, modificado: Date.now() };
  await db.anclas.put(actualizado);
  return actualizado;
}

function guardarMontaje(ancla, maquinaId, configuracion) {
  return guardarMontajes(ancla, { ...montajesDelAncla(ancla), [maquinaId]: montajeDe(configuracion) });
}

export async function guardarMaquinasAncla(id, ids, { desde, copiarSubanclas = false } = {}) {
  return db.transaction('rw', [db.anclas, db.maquinas, db.localizaciones, db.guias], async () => {
    const ancla = await obtenerAncla(id);
    if (!ancla) throw new Error('El ancla ya no existe.');
    const maquinas = [...new Set(ids)];
    if ((await db.maquinas.bulkGet(maquinas)).some((m) => !m)) throw new Error('Alguna máquina seleccionada ya no existe.');
    const actual = montajesDelAncla(ancla);
    const referencia = actual[desde] ?? ancla;
    const inicial = montajeDe({ cara: referencia.cara, orientacion: referencia.orientacion,
      subanclas: copiarSubanclas ? subanclasDe(referencia).map(({ giroQR, ...s }) => s) : [] });
    if (inicial.subanclas.length) {
      const nuevosIds = new Set(inicial.subanclas.map((s) => s.id));
      const otrasAnclas = (await db.anclas.toArray()).filter((a) => a.id !== id);
      for (const maq of maquinas.filter((m) => !Object.hasOwn(actual, m))) {
        const repetido = otrasAnclas.some((a) => subanclasDe(anclaParaMaquina(a, maq) ?? {}).some((s) => nuevosIds.has(s.id)));
        if (repetido) throw new Error(`En ${maq} ya se usa uno de estos QR. Asigna el ancla sin copiar las subanclas.`);
      }
    }
    const montajes = Object.fromEntries(maquinas.map((maq) => [maq, actual[maq] ?? inicial]));
    for (const maquinaId of Object.keys(actual)) {
      if (Object.hasOwn(montajes, maquinaId)) continue;
      await db.localizaciones.where('anclaId').equals(id).and((loc) => loc.maquinaId === maquinaId).delete();
      await db.guias.where('maquinaId').equals(maquinaId).and((g) => g.anclaId === id).modify({ anclaId: null, estado: 'borrador' });
    }
    return guardarMontajes(ancla, montajes);
  });
}

export async function listarAnclas(maquinaId) {
  if (!maquinaId) return [];
  return (await db.anclas.toArray()).map((a) => anclaParaMaquina(a, maquinaId)).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

export async function obtenerAncla(id, maquinaId) {
  const ancla = id ? (await db.anclas.get(id)) || null : null;
  return maquinaId === undefined ? ancla : anclaParaMaquina(ancla, maquinaId);
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

function validarConfiguracionAncla({ cara, orientacion }) {
  if (cara && !Object.hasOwn(CARAS_MAQUINA, cara)) throw new Error('Elige una cara válida para el QR principal.');
  if (orientacion && !Object.hasOwn(ORIENTACIONES_QR, orientacion)) throw new Error('Elige una colocación válida para el QR principal.');
}

export async function guardarAncla(datos, esNueva) {
  const id = normalizarId(datos.id);
  if (!id) throw new Error('Escribe el identificador del ancla (es lo que lleva su QR).');
  validarConfiguracionAncla(datos);
  return db.transaction('rw', [db.anclas, db.elementos, db.maquinas], async () => {
    if (!(await db.maquinas.get(datos.maquinaId))) throw new Error('El ancla tiene que pertenecer a una máquina que exista.');
    const anterior = await db.anclas.get(id);
    if (esNueva && anterior) throw new Error(`Ya existe un ancla con el identificador ${id}.`);
    const montaje = anclaParaMaquina(anterior, datos.maquinaId);
    if (anterior && !montaje) throw new Error(`El ancla ${id} no está asignada a esta máquina.`);
    // Si su QR coincide con el de un elemento, ese elemento tiene que ser de la misma máquina
    const el = await db.elementos.get(id);
    if (!anterior && el && el.maquinaId !== datos.maquinaId) throw new Error(`El QR ${id} ya es de un elemento de otra máquina. Usa otro identificador.`);
    const a = {
      ...(anterior || {}),
      id,
      nombre: String(datos.nombre || '').trim() || id,
      descripcion: String(datos.descripcion || '').trim(),
    };
    const cambios = { ...montaje,
      gravedad: datos.gravedad === undefined ? montaje?.gravedad : datos.gravedad,
      cara: datos.cara === undefined ? montaje?.cara : datos.cara || null,
      orientacion: datos.orientacion === undefined ? montaje?.orientacion : datos.orientacion || null };
    return anclaParaMaquina(await guardarMontaje(a, datos.maquinaId, cambios), datos.maquinaId);
  });
}

export async function guardarConfiguracionAncla(id, maquinaId, { cara, orientacion }) {
  validarConfiguracionAncla({ cara, orientacion });
  return db.transaction('rw', db.anclas, async () => {
    const ancla = await obtenerAncla(id);
    const montaje = anclaParaMaquina(ancla, maquinaId);
    if (!montaje) throw new Error('El ancla ya no existe en esta máquina.');
    await guardarMontaje(ancla, maquinaId, { ...montaje,
      ...(cara !== undefined ? { cara: cara || null } : {}),
      ...(orientacion !== undefined ? { orientacion: orientacion || null } : {}),
    });
  });
}

/** Guarda cómo está colocado físicamente el QR del ancla (su "arriba" respecto al QR). */
export async function guardarGravedadAncla(id, maquinaId, gravedad) {
  return db.transaction('rw', db.anclas, async () => {
    const ancla = await obtenerAncla(id);
    const montaje = anclaParaMaquina(ancla, maquinaId);
    if (montaje) await guardarMontaje(ancla, maquinaId, { ...montaje, gravedad: gravedad.map((n) => Math.round(n * 1000) / 1000) });
  });
}

export async function listarSubanclasReutilizables(maquinaId) {
  const anclas = await db.anclas.toArray();
  const usados = new Set();
  const disponibles = new Map();
  for (const ancla of anclas) {
    const montajes = Object.entries(montajesDelAncla(ancla));
    for (const [maq, montaje] of montajes.length ? montajes : [['Sin asignar', ancla]]) {
      for (const s of subanclasDe(montaje)) {
        if (maq === maquinaId) usados.add(s.id);
        else if (!disponibles.has(s.id)) disponibles.set(s.id, { ...s, maquinaId: maq });
      }
    }
  }
  return [...disponibles.values()].filter((s) => !usados.has(s.id));
}

export async function guardarSubancla(anclaId, maquinaId, datos) {
  const { id, reutilizarId, pos, cara, ladoCm, orientacion } = datos;
  const nombre = String(datos.nombre || '').trim();
  if (!nombre || nombre.length > 80) throw new Error('Escribe un nombre de hasta 80 caracteres.');
  if (!calibracionSubanclaValida(datos)) throw new Error('Revisa las coordenadas, la cara y el tamaño del QR. El centro debe estar en un punto distinto al QR principal.');
  return db.transaction('rw', db.anclas, async () => {
    const ancla = await obtenerAncla(anclaId);
    const montajeActual = anclaParaMaquina(ancla, maquinaId);
    if (!montajeActual) throw new Error('El ancla ya no existe en esta máquina.');
    const subanclas = subanclasDe(montajeActual);
    const indice = id ? subanclas.findIndex((s) => s.id === id) : -1;
    if (id && indice < 0) throw new Error('La subancla ya no existe.');
    if (!id && subanclas.length >= 99) throw new Error('Esta ancla ya tiene el máximo de subanclas.');
    if (reutilizarId) {
      const original = (await listarSubanclasReutilizables(maquinaId)).find((s) => s.id === reutilizarId);
      if (id || !original) throw new Error('Este QR ya está asignado en la máquina o ya no está disponible.');
      if (ladoCm !== original.ladoCm) throw new Error('Vuelve a seleccionar el QR. Se actualizó su tamaño guardado.');
    }
    const anterior = subanclas[indice];
    const montaje = orientacion ?? anterior?.orientacion;
    const subancla = { id: id || reutilizarId || 'S-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12), nombre, pos, cara, ladoCm,
      ...(montaje ? { orientacion: montaje } : {}) };
    if (anterior && giroSubanclaValido(anterior.giroQR) && anterior.cara === cara && anterior.ladoCm === ladoCm &&
        (anterior.orientacion ?? 'vertical') === (montaje ?? 'vertical') &&
        anterior.pos.every((n, i) => n === pos[i])) subancla.giroQR = anterior.giroQR;
    if (indice < 0) subanclas.push(subancla);
    else subanclas[indice] = subancla;
    await guardarMontaje(ancla, maquinaId, { ...montajeActual, subanclas });
    return subancla;
  });
}

export async function guardarMedicionSubancla(anclaId, maquinaId, referencia, { pos, giroQR }) {
  return db.transaction('rw', db.anclas, async () => {
    const ancla = await obtenerAncla(anclaId);
    const montaje = anclaParaMaquina(ancla, maquinaId);
    if (!montaje) throw new Error('El ancla ya no existe en esta máquina.');
    const subanclas = subanclasDe(montaje);
    const indice = subanclas.findIndex((s) => s.id === referencia.id && s.ladoCm === referencia.ladoCm &&
      (s.orientacion ?? 'vertical') === (referencia.orientacion ?? 'vertical'));
    if (indice < 0) throw new Error('El QR cambió durante la medición. Vuelve a medirlo.');
    const medida = { ...subanclas[indice], pos, giroQR };
    if (!calibracionSubanclaValida(medida) || !giroSubanclaValido(giroQR)) throw new Error('La medición no es válida.');
    subanclas[indice] = medida;
    await guardarMontaje(ancla, maquinaId, { ...montaje, subanclas });
  });
}

export async function borrarSubancla(anclaId, maquinaId, id) {
  return db.transaction('rw', db.anclas, async () => {
    const ancla = await obtenerAncla(anclaId);
    const montaje = anclaParaMaquina(ancla, maquinaId);
    if (!montaje) throw new Error('El ancla ya no existe en esta máquina.');
    const subanclas = subanclasDe(montaje).filter((s) => s.id !== id);
    await guardarMontaje(ancla, maquinaId, { ...montaje, subanclas });
  });
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
  if (!anclaParaMaquina(a, maquinaId)) return `El ancla ${anclaId} no está asignada a la máquina ${maquinaId}.`;
  if (e.maquinaId !== maquinaId) return `El elemento ${elementoId} no pertenece a la máquina ${maquinaId}.`;
  return null;
}

const redondear = (p) => p.map((n) => Math.round(Number(n) * 1000) / 1000);
const esPunto = (p) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(Number(n)));

export async function guardarLocalizacion({ maquinaId, anclaId, elementoId, pos, ruta = [], posIcono = null }) {
  if (!esPunto(pos)) throw new Error('La posición necesita X, Y y Z.');
  if (!ruta.every(esPunto)) throw new Error('Algún punto intermedio no tiene X, Y y Z.');
  if (posIcono && !esPunto(posIcono)) throw new Error('La posición del icono necesita X, Y y Z.');
  const loc = {
    id: idLocalizacion(anclaId, elementoId), maquinaId, anclaId, elementoId,
    pos: redondear(pos), ruta: ruta.map(redondear), posIcono: posIcono ? redondear(posIcono) : null,
    modificado: Date.now(),
  };
  return db.transaction('rw', [db.maquinas, db.anclas, db.elementos, db.localizaciones], async () => {
    const problema = await problemaCoherencia(maquinaId, anclaId, elementoId);
    if (problema) throw new Error(problema);
    await db.localizaciones.put(loc);
    return loc;
  });
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
  if (!await obtenerAncla(anclaId, maquinaId)) return [];
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
  return [g.portadaId, ...(g.pasos || []).flatMap((p) => [...(p.imagenes || []), ...(p.videos || []), p.ampliacionId])].filter(Boolean);
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
    titulo: '', texto: '', imagenes: [], videos: [], ampliacionId: null,
    elementoId: null, flechas: true, icono: true, rutaPropia: null, destinoPropio: null,
    advertencia: '', confirmar: false, comprobaciones: [],
  };
}

/** Guarda una guía comprobando que todo (ancla y elementos de los pasos) es de su máquina. */
export async function guardarGuia(datos) {
  if (!String(datos.nombre || '').trim()) throw new Error('Escribe el nombre de la guía.');
  return db.transaction('rw', [db.guias, db.archivos, db.maquinas, db.anclas, db.elementos], async () => {
    if (!(await db.maquinas.get(datos.maquinaId))) throw new Error('La guía tiene que pertenecer a una máquina que exista.');
    if (datos.anclaId) {
      if (!await obtenerAncla(datos.anclaId, datos.maquinaId)) throw new Error('El ancla elegida no está asignada a la máquina de la guía.');
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
    if (anterior) {
      const usados = new Set(archivosDeGuia(g));
      await borrarArchivos(archivosDeGuia(anterior).filter((f) => !usados.has(f)));
    }
    return g;
  });
}

export async function borrarGuia(id) {
  const g = await db.guias.get(id);
  if (!g) return;
  await db.guias.delete(id);
  await borrarArchivos(archivosDeGuia(g));
}

async function trasladarGuia(id, destino, duplicar) {
  return db.transaction('rw', [db.guias, db.maquinas, db.anclas, db.elementos, db.archivos, db.huellas], async () => {
    const original = await db.guias.get(id);
    if (!original) throw new Error('La guía no existe.');
    const maquinaId = destino ?? original.maquinaId;
    if (!(await db.maquinas.get(maquinaId))) throw new Error('Esa máquina no existe.');
    const cambiaMaquina = maquinaId !== original.maquinaId;
    if (!cambiaMaquina && !duplicar) return original;

    const copias = new Map();
    const pasos = [];
    for (const p of original.pasos || []) {
      let paso = { ...p };
      if (p.elementoId) {
        const previo = await db.elementos.get(p.elementoId);
        if (previo?.maquinaId !== maquinaId) {
          if (cambiaMaquina && previo?.maquinaId === original.maquinaId) {
            if (!copias.has(previo.id)) copias.set(previo.id, await copiarElementoEn(previo, maquinaId));
            paso.elementoId = copias.get(previo.id).id;
          } else paso = pasoSinElemento(paso, previo);
        }
      }
      if (duplicar) {
        paso.id = pasoVacio().id;
        paso.imagenes = (await Promise.all((p.imagenes || []).map(copiarArchivo))).filter(Boolean);
        paso.videos = (await Promise.all((p.videos || []).map(copiarArchivo))).filter(Boolean);
        paso.ampliacionId = await copiarArchivo(p.ampliacionId);
      }
      pasos.push(paso);
    }
    const ahora = Date.now();
    const guia = {
      ...original, maquinaId, pasos, estado: 'borrador', modificado: ahora,
      anclaId: (await obtenerAncla(original.anclaId, maquinaId))?.id ?? null,
    };
    if (duplicar) {
      guia.id = await siguienteIdGuia();
      guia.nombre = `${original.nombre} (copia)`;
      guia.creado = ahora;
      guia.portadaId = await copiarArchivo(original.portadaId);
      await db.guias.add(guia);
    } else await db.guias.put(guia);
    return guia;
  });
}

export const duplicarGuia = (id, maquinaId) => trasladarGuia(id, maquinaId, true);
export const moverGuia = (id, maquinaId) => trasladarGuia(id, maquinaId, false);

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
