// Prepara las fotos antes de guardarlas: las reduce de tamaño (para que 500 elementos
// quepan sin problema) y crea una miniatura para la lista.

function cargarImagen(blob) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function aJpeg(img, maxLado, calidad) {
  const k = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';           // fondo blanco por si la imagen tiene transparencia
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, mal) =>
    c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo convertir la imagen'))), 'image/jpeg', calidad));
}

/** Devuelve { imagen, miniatura } como Blobs JPEG. */
export async function prepararFoto(archivo) {
  const img = await cargarImagen(archivo);
  const imagen = await aJpeg(img, 2400, 0.85);
  const miniatura = await aJpeg(img, 240, 0.75);
  return { imagen, miniatura };
}
