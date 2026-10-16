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
    // B y C: guardado en el almacén de la app (Cache Storage), como se hacía antes
    const direccionWeb = async (id, blob) => {
      if (!('caches' in window) || !navigator.serviceWorker || !navigator.serviceWorker.controller) return URL.createObjectURL(blob);
      const url = new URL(`${base}ar-generado/${encodeURIComponent(id)}.usdz`, location.href).href;
      await (await caches.open('ar-generado')).put(url, new Response(blob, { headers: { 'Content-Type': 'model/vnd.usdz+zip', 'Content-Length': String(blob.size) } }));
      return url;
    };
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

  // E y F: detección del MARCADOR del ancla (el ancla 3D tiene que girar si giras el papel).
  // Solo cambia cómo se le dice al AR de Apple el tamaño del marcador: en centímetros (E) o en metros (F).
  const marc = document.createElement('div');
  marc.className = 'bloque-lidar-guia';
  marc.innerHTML = `
    <p class="nota lidar-recomendado">E / F) Detectar el MARCADOR del ancla</p>
    <label>Ancla <select data-d="ancla"></select></label>
    <button class="boton secundario" data-d="pdf">🖨️ Imprimir el marcador de este ancla</button>
    <p class="nota">Imprímelo al 100 %, ponlo en la mesa y prueba E y F. En el bueno, el ⚓ aparece encima y, si giras el
      papel, el ancla y las flechas giran con él. La flecha azul tiene que apuntar a "▲ ADELANTE".</p>
    <div class="e"></div><p class="nota e-estado"></p>
    <div class="f"></div><p class="nota f-estado"></p>`;
  cont.appendChild(marc);
  const selA = marc.querySelector('[data-d="ancla"]');
  (async () => {
    const [{ mapaAnclas, maquinaActivaId }, { leerAjustes }] = await Promise.all([import('../maquinas.js'), import('../ajustes.js')]);
    const maq = maquinaActivaId();
    const anclas = [...(await mapaAnclas()).values()].filter((a) => !maq || a.maquinaId === maq);
    if (!anclas.length) anclas.push({ id: 'PRUEBA', nombre: 'Prueba' });
    for (const a of anclas) { const o = document.createElement('option'); o.value = a.id; o.textContent = `${a.nombre} (${a.id})`; selA.appendChild(o); }
    const lado = leerAjustes().qrCm || 10;
    marc.querySelector('[data-d="pdf"]').addEventListener('click', async () => {
      const [{ generarPdfMarcador }, { guardarOCompartir }] = await Promise.all([import('../qr-pdf.js'), import('../ui/descargar.js')]);
      const a = anclas.find((x) => x.id === selA.value);
      guardarOCompartir(generarPdfMarcador([{ id: a.id, nombre: a.nombre, referencia: 'Diagnóstico' }], lado), `ANCLA-${a.id}.pdf`, 'application/pdf');
    });
    const preparar = async () => {
      const THREE = await import('three');
      const { usdzPaso } = await import('../ar/recorrido-lidar.js');
      const pts = [[0, 0, 0], [0, 0, -1], [0.5, 0, -1]].map((q) => new THREE.Vector3(...q));
      for (const [clase, unidad, letra] of [['e', 'cm', 'E'], ['f', 'm', 'F']]) {
        const caja = marc.querySelector('.' + clase), est = marc.querySelector(`.${clase}-estado`);
        caja.innerHTML = ''; est.textContent = '⏳ Preparando…';
        try {
          const b = await usdzPaso(pts, { nombre: 'Prueba', referencia: '100 adelante · 50 derecha' }, { modo: 'qr', textoQR: 'INFOLENS:' + selA.value, ladoCm: lado, unidad });
          if (!activo) return;
          caja.appendChild(crearEnlaceAR({ url: URL.createObjectURL(b), texto: `🧪 Probar ${letra} (tamaño en ${unidad === 'cm' ? 'centímetros' : 'metros'})` }).enlace);
          est.textContent = `${Math.round(b.size / 1024)} KB · recorrido: 100 cm adelante y 50 cm a la derecha`;
        } catch (e) { est.textContent = '❌ ' + (e && e.message ? e.message : e); }
      }
    };
    selA.addEventListener('change', preparar);
    preparar();
  })();
  return () => { activo = false; };
}
