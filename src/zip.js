// Lector y escritor de archivos .zip, hecho a medida para manejar copias grandes
// (cientos de PDF y fotos) sin cargar todo en la memoria del móvil.
// - Al crear: los archivos se guardan sin comprimir (fotos y PDF ya vienen comprimidos).
// - Al leer: se accede a cada archivo por separado; admite también zips normales (comprimidos).

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

async function crc32(blob) {
  let c = 0xffffffff;
  const lector = blob.stream().getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) c = TABLA_CRC[(c ^ value[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function fechaDos(d = new Date()) {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    fecha: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const LIMITE = 0xfffffffe; // 4 GB: límite del formato zip clásico

/** entradas: [{ nombre: 'carpeta/archivo.pdf', blob }]. Devuelve un Blob .zip. */
export async function crearZip(entradas, alAvanzar = () => {}) {
  const codif = new TextEncoder();
  const { hora, fecha } = fechaDos();
  const partes = [];
  const central = [];
  let posicion = 0;
  let tamCentral = 0;
  if (entradas.length > 65535) throw new Error('Demasiados archivos para una sola copia.');

  for (let i = 0; i < entradas.length; i++) {
    const { nombre, blob } = entradas[i];
    alAvanzar(i, entradas.length);
    const n = codif.encode(nombre);
    const crc = await crc32(blob);
    const tam = blob.size;
    if (tam > LIMITE || posicion > LIMITE) throw new Error('La copia supera los 4 GB.');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // versión
    local.setUint16(6, 0x0800, true);   // nombres en UTF-8
    local.setUint16(8, 0, true);        // sin comprimir
    local.setUint16(10, hora, true);
    local.setUint16(12, fecha, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, tam, true);
    local.setUint32(22, tam, true);
    local.setUint16(26, n.length, true);
    local.setUint16(28, 0, true);
    partes.push(local.buffer, n, blob);

    const cab = new DataView(new ArrayBuffer(46));
    cab.setUint32(0, 0x02014b50, true);
    cab.setUint16(4, 20, true);
    cab.setUint16(6, 20, true);
    cab.setUint16(8, 0x0800, true);
    cab.setUint16(10, 0, true);
    cab.setUint16(12, hora, true);
    cab.setUint16(14, fecha, true);
    cab.setUint32(16, crc, true);
    cab.setUint32(20, tam, true);
    cab.setUint32(24, tam, true);
    cab.setUint16(28, n.length, true);
    cab.setUint32(42, posicion, true);
    central.push(cab.buffer, n);

    posicion += 30 + n.length + tam;
    tamCentral += 46 + n.length;
  }
  if (posicion > LIMITE) throw new Error('La copia supera los 4 GB.');

  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, entradas.length, true);
  fin.setUint16(10, entradas.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, posicion, true);
  alAvanzar(entradas.length, entradas.length);
  return new Blob([...partes, ...central, fin.buffer], { type: 'application/zip' });
}

/** Lee el índice de un .zip. Devuelve [{ nombre, metodo, tamComprimido, tam, posLocal }]. */
export async function leerIndiceZip(archivo) {
  const tamFin = Math.min(archivo.size, 22 + 65535);
  const fin = new DataView(await archivo.slice(archivo.size - tamFin).arrayBuffer());
  let p = -1;
  for (let i = tamFin - 22; i >= 0; i--) {
    if (fin.getUint32(i, true) === 0x06054b50) { p = i; break; }
  }
  if (p < 0) throw new Error('El archivo no es un .zip válido.');
  const total = fin.getUint16(p + 10, true);
  const tamCentral = fin.getUint32(p + 12, true);
  const posCentral = fin.getUint32(p + 16, true);
  if (posCentral === 0xffffffff || total === 0xffff) throw new Error('Este .zip es demasiado grande (formato ZIP64 no admitido).');

  const cd = new DataView(await archivo.slice(posCentral, posCentral + tamCentral).arrayBuffer());
  const utf8 = new TextDecoder('utf-8');
  const entradas = [];
  let q = 0;
  for (let i = 0; i < total; i++) {
    if (cd.getUint32(q, true) !== 0x02014b50) throw new Error('El .zip está dañado.');
    const metodo = cd.getUint16(q + 10, true);
    const tamComprimido = cd.getUint32(q + 20, true);
    const tam = cd.getUint32(q + 24, true);
    const lnom = cd.getUint16(q + 28, true);
    const lextra = cd.getUint16(q + 30, true);
    const lcom = cd.getUint16(q + 32, true);
    const posLocal = cd.getUint32(q + 42, true);
    const nombre = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + q + 46, lnom));
    if (!nombre.endsWith('/')) entradas.push({ nombre, metodo, tamComprimido, tam, posLocal });
    q += 46 + lnom + lextra + lcom;
  }
  return entradas;
}

/** Devuelve el contenido (Blob) de una entrada del zip. */
export async function leerEntradaZip(archivo, e) {
  const local = new DataView(await archivo.slice(e.posLocal, e.posLocal + 30).arrayBuffer());
  if (local.getUint32(0, true) !== 0x04034b50) throw new Error('El .zip está dañado.');
  const inicio = e.posLocal + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const datos = archivo.slice(inicio, inicio + e.tamComprimido);
  if (e.metodo === 0) return datos;
  if (e.metodo === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede descomprimir este .zip.');
    return new Response(datos.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  }
  throw new Error(`Formato de compresión no admitido en ${e.nombre}.`);
}
