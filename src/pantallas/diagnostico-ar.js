// DIAGNÓSTICO del AR con LiDAR: el MISMO recorrido (rojo → 130 adelante → 150 derecha → azul) abierto de
// 4 formas distintas, para saber cuál funciona en el iPhone y por qué falla la guía.
//  A) archivo del servidor (como la prueba que funciona)
//  B) el mismo archivo del servidor, copiado al almacén de la app (como la guía)
//  C) generado en el móvil y guardado en el almacén de la app (como la guía)
//  D) generado en el móvil, como archivo temporal (blob)
import { crearEnlaceAR, hayQuickLook } from '../ar/boton-ar.js';

export function pantallaDiagnosticoAR(app, { volver }) {
  let activo = true;
  const base = import.meta.env?.BASE_URL ?? './';
  const instalada = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const controlada = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Inicio</button>
      <h1>🔬 Diagnóstico del AR con LiDAR</h1>
      <p class="nota">Prueba los 4 botones, uno a uno. Todos abren lo mismo (rojo → 130 adelante → 150 derecha → azul).
        Apunta qué letras se abren con la cámara y el AR, y cuáles no hacen nada o salen sin cámara.</p>
      <div class="tarjeta-info diag-info"></div>
      <div class="diag"></div>
    </div>`;
  app.querySelector('.volver').addEventListener('click', volver);
  app.querySelector('.diag-info').innerHTML = `
    <div>Abierta como: <b>${instalada ? 'app instalada' : 'Safari'}</b></div>
    <div>Service worker: <b>${controlada ? 'activo' : 'NO activo'}</b></div>
    <div>AR de Apple disponible: <b>${hayQuickLook() ? 'sí' : 'no'}</b></div>`;
  const cont = app.querySelector('.diag');
  const fila = (letra, texto) => {
    const d = document.createElement('div');
    d.className = 'bloque-lidar-guia';
    d.innerHTML = '<p class="nota lidar-recomendado"></p><div class="b"></div><p class="nota estado">⏳ Preparando…</p>';
    d.querySelector('.lidar-recomendado').textContent = `${letra}) ${texto}`;
    cont.appendChild(d);
    return {
      listo(url, nota) {
        d.querySelector('.b').appendChild(crearEnlaceAR({ url, texto: `🧪 Probar ${letra}` }).enlace);
        d.querySelector('.estado').textContent = nota;
      },
      error(e) { d.querySelector('.estado').textContent = '❌ ' + (e && e.message ? e.message : e); },
    };
  };
  const A = fila('A', 'Archivo del servidor (como la prueba que funciona)');
  const B = fila('B', 'El mismo archivo, guardado en el almacén de la app (como la guía)');
  const C = fila('C', 'Generado en el móvil y guardado en el almacén de la app (como la guía)');
  const D = fila('D', 'Generado en el móvil, archivo temporal');
  const urlFija = new URL(base + 'ejemplo/prueba-flechas.usdz', location.href).href;
  A.listo(urlFija, 'Del servidor.');

  const comprobar = async (url) => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const b = await r.blob();
      return `Comprobación: ${r.status} · ${r.headers.get('content-type') || '?'} · ${Math.round(b.size / 1024)} KB`;
    } catch (e) { return 'Comprobación: ❌ ' + e.message; }
  };
  (async () => {
    const { direccionWeb } = await import('../ar/quicklook.js');
    try {
      const blob = await (await fetch(urlFija)).blob();
      const url = await direccionWeb('diag-B', new Blob([blob], { type: 'model/vnd.usdz+zip' }));
      if (activo) B.listo(url, `${url.startsWith('blob:') ? '⚠️ quedó como temporal (service worker no activo)' : 'En el almacén de la app.'} ${await comprobar(url)}`);
    } catch (e) { B.error(e); }
    try {
      const { usdzPruebaFlechas } = await import('../ar/prueba-flechas.js');
      const bytes = await usdzPruebaFlechas([{ adelante: 130 }, { derecha: 150 }]);
      const blob = new Blob([bytes], { type: 'model/vnd.usdz+zip' });
      const url = await direccionWeb('diag-C', blob);
      if (activo) C.listo(url, `${url.startsWith('blob:') ? '⚠️ quedó como temporal (service worker no activo)' : 'En el almacén de la app.'} ${await comprobar(url)}`);
      if (activo) D.listo(URL.createObjectURL(blob), `Temporal · ${Math.round(blob.size / 1024)} KB`);
    } catch (e) { C.error(e); D.error(e); }
  })();
  return () => { activo = false; };
}
