// Crea un archivo .glb (modelo 3D estándar) a partir de las mallas que devuelve el lector de STEP.
// - Pasa de milímetros (CAD) a metros (glTF).
// - Gira el modelo: en CAD "arriba" es el eje Z; en glTF es el eje Y.
// - Respeta los colores de las caras si el STEP los trae.

const GRIS = [0.72, 0.74, 0.78];

function claveColor(c) {
  return c ? c.map((v) => Math.round(v * 255)).join(',') : 'gris';
}

/** resultado: lo que devuelve occt.ReadStepFile. Devuelve { glb: ArrayBuffer, triangulos }. */
export function crearGlb(resultado, nombre = 'modelo') {
  const trozos = [];      // partes del búfer binario
  let longitud = 0;
  const bufferViews = [];
  const accessors = [];
  const materials = [];
  const mapaMateriales = new Map();
  const meshes = [];
  const nodosMalla = [];
  let triangulos = 0;

  const anadir = (array, target) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const relleno = (4 - (longitud % 4)) % 4;
    if (relleno) { trozos.push(new Uint8Array(relleno)); longitud += relleno; }
    bufferViews.push({ buffer: 0, byteOffset: longitud, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    trozos.push(bytes);
    longitud += bytes.byteLength;
    return bufferViews.length - 1;
  };

  const material = (color) => {
    const k = claveColor(color);
    if (!mapaMateriales.has(k)) {
      const c = color || GRIS;
      materials.push({
        name: 'color_' + k,
        pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], 1], metallicFactor: 0.35, roughnessFactor: 0.55 },
        doubleSided: true,
      });
      mapaMateriales.set(k, materials.length - 1);
    }
    return mapaMateriales.get(k);
  };

  for (const m of resultado.meshes || []) {
    const pos = Float32Array.from(m.attributes.position.array);
    if (!pos.length) continue;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let j = 0; j < 3; j++) {
        if (pos[i + j] < min[j]) min[j] = pos[i + j];
        if (pos[i + j] > max[j]) max[j] = pos[i + j];
      }
    }
    accessors.push({ bufferView: anadir(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    const accPos = accessors.length - 1;
    let accNorm = null;
    if (m.attributes.normal && m.attributes.normal.array.length === pos.length) {
      const nor = Float32Array.from(m.attributes.normal.array);
      accessors.push({ bufferView: anadir(nor, 34962), componentType: 5126, count: nor.length / 3, type: 'VEC3' });
      accNorm = accessors.length - 1;
    }
    const indices = m.index.array;
    triangulos += indices.length / 3;

    // Agrupar los triángulos por color de cara (si el STEP trae colores por cara)
    const grupos = new Map();
    const caras = m.brep_faces || [];
    if (caras.some((c) => c.color)) {
      for (const c of caras) {
        const color = c.color || m.color || null;
        const k = claveColor(color);
        if (!grupos.has(k)) grupos.set(k, { color, idx: [] });
        const g = grupos.get(k).idx;
        for (let t = c.first; t <= c.last; t++) g.push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
      }
    } else {
      grupos.set(claveColor(m.color), { color: m.color || null, idx: indices });
    }

    const primitives = [];
    for (const { color, idx } of grupos.values()) {
      if (!idx.length) continue;
      const arr = Uint32Array.from(idx);
      accessors.push({ bufferView: anadir(arr, 34963), componentType: 5125, count: arr.length, type: 'SCALAR' });
      primitives.push({
        attributes: { POSITION: accPos, ...(accNorm !== null ? { NORMAL: accNorm } : {}) },
        indices: accessors.length - 1,
        material: material(color),
        mode: 4,
      });
    }
    meshes.push({ name: m.name || `pieza_${meshes.length + 1}`, primitives });
    nodosMalla.push({ mesh: meshes.length - 1, name: m.name || `pieza_${meshes.length}` });
  }
  if (!meshes.length) throw new Error('El archivo no contiene ninguna pieza 3D.');

  const s = Math.SQRT1_2;
  const nodes = [
    // Nodo raíz: mm -> m y Z arriba -> Y arriba (giro de -90° en el eje X)
    { name: nombre, children: nodosMalla.map((_, i) => i + 1), rotation: [-s, 0, 0, s], scale: [0.001, 0.001, 0.001] },
    ...nodosMalla,
  ];
  const json = {
    asset: { version: '2.0', generator: 'InfoLens (STEP a glb)' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: longitud }],
  };

  // Empaquetar en formato GLB: cabecera + bloque JSON + bloque binario
  let textoJson = new TextEncoder().encode(JSON.stringify(json));
  const rellenoJson = (4 - (textoJson.length % 4)) % 4;
  const bloqueJson = new Uint8Array(textoJson.length + rellenoJson).fill(0x20);
  bloqueJson.set(textoJson);
  const rellenoBin = (4 - (longitud % 4)) % 4;
  const total = 12 + 8 + bloqueJson.length + 8 + longitud + rellenoBin;
  const salida = new Uint8Array(total);
  const dv = new DataView(salida.buffer);
  dv.setUint32(0, 0x46546c67, true);  // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, bloqueJson.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  salida.set(bloqueJson, 20);
  let p = 20 + bloqueJson.length;
  dv.setUint32(p, longitud + rellenoBin, true);
  dv.setUint32(p + 4, 0x004e4942, true); // "BIN"
  p += 8;
  for (const t of trozos) { salida.set(t, p); p += t.byteLength; }
  return { glb: salida.buffer, triangulos };
}
