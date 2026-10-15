// Guardar un archivo creado por la app: en el iPhone abre el menú Compartir
// (Guardar en Archivos, AirDrop, WhatsApp…); en el PC lo descarga.

const esMovil = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Debe llamarse directamente desde un toque del usuario (si no, Safari no deja compartir). */
export async function guardarOCompartir(blob, nombre, tipo) {
  const archivo = new File([blob], nombre, { type: tipo || blob.type });
  if (esMovil() && navigator.canShare && navigator.canShare({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo] });
      return 'compartido';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelado';
    }
  }
  descargar(blob, nombre);
  return 'descargado';
}
