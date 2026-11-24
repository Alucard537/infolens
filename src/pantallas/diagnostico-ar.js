// Prueba del QR en el visor nativo y diagnóstico de carga de modelos con Quick Look.
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
      <div class="tarjeta-info diag-info"></div>
      <div class="diag-nativo"></div>
      <details>
        <summary>Pruebas técnicas de Quick Look</summary>
        <p class="nota">Las pruebas A–D comparan distintas formas de abrir un modelo de ejemplo con el visor de Apple.</p>
        <div class="diag"></div>
      </details>
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
  const A = fila('A', 'Archivo del servidor');
  const B = fila('B', 'Archivo del servidor copiado al almacén de la app');
  const C = fila('C', 'Generado en el móvil y guardado en el almacén de la app');
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
    <label>📏 Medida real del marcador impreso (cm, de borde negro a borde negro) <input inputmode="decimal" data-d="ancho"></label>
    <button class="boton secundario" data-d="pdf">🖨️ Imprimir el marcador de este ancla</button>
    <p class="nota">Imprímelo al 100 %, ponlo en la mesa y prueba E y F. En el bueno, el ⚓ aparece encima y, si giras el
      papel, el ancla y las flechas giran con él. La flecha azul tiene que apuntar a "▲ ADELANTE".</p>
    <div class="e"></div><p class="nota e-estado"></p>
    <div class="f"></div><p class="nota f-estado"></p>`;
  cont.appendChild(marc);
  const selA = marc.querySelector('[data-d="ancla"]');
  (async () => {
    const [{ listarAnclas, mapaAnclas, maquinaActivaId }, { leerAjustes }] = await Promise.all([import('../maquinas.js'), import('../ajustes.js')]);
    const maq = maquinaActivaId();
    const anclas = maq ? await listarAnclas(maq) : [...(await mapaAnclas()).values()];
    if (!anclas.length) anclas.push({ id: 'PRUEBA', nombre: 'Prueba' });
    for (const a of anclas) { const o = document.createElement('option'); o.value = a.id; o.textContent = `${a.nombre} (${a.id})`; selA.appendChild(o); }
    const lado = leerAjustes().qrCm || 10;
    const { anchoMarcadorCm } = await import('../ar/marcador.js');
    const inAncho = marc.querySelector('[data-d="ancho"]');
    inAncho.value = String(anchoMarcadorCm(lado)).replace('.', ',');
    const anchoReal = () => { const n = parseFloat(String(inAncho.value).replace(',', '.')); return n > 2 && n < 200 ? n : null; };
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
          const b = await usdzPaso(pts, { nombre: 'Prueba', referencia: '100 adelante · 50 derecha' }, { modo: 'qr', textoQR: 'INFOLENS:' + selA.value, ladoCm: lado, unidad, anchoRealCm: anchoReal() });
          if (!activo) return;
          caja.appendChild(crearEnlaceAR({ url: URL.createObjectURL(b), texto: `🧪 Probar ${letra} (tamaño en ${unidad === 'cm' ? 'centímetros' : 'metros'})` }).enlace);
          est.textContent = `${Math.round(b.size / 1024)} KB · recorrido: 100 cm adelante y 50 cm a la derecha`;
        } catch (e) { est.textContent = '❌ ' + (e && e.message ? e.message : e); }
      }
    };
    selA.addEventListener('change', preparar);
    inAncho.addEventListener('change', preparar);
    preparar();
  })();
  const raiz = document.createElement('div');
  raiz.className = 'bloque-lidar-guia';
  raiz.innerHTML = `
    <h2>Prueba de anclaje al QR</h2>
    <label>QR del ancla <select data-r="ancla"></select></label>
    <label>📏 Lo que mide la zona negra del QR impreso (cm) <input inputmode="decimal" data-r="lado"></label>
    <a class="boton secundario enlace-boton" href="${base}ejemplo/qr-prueba.html" target="_blank" rel="noopener">Ver e imprimir el QR TEST-1</a>
    <p class="nota">Enfoca el QR hasta que aparezca el recorrido. Gira el papel 90° y comprueba que las flechas giran con él.</p>
    <div class="nativo"></div>
    <p class="nota">Esta prueba se abre en la app InfoLens Visor del iPhone.</p>`;
  app.querySelector('.diag-nativo').appendChild(raiz);
  const variantesRaiz = document.createElement('div');
  variantesRaiz.className = 'bloque-lidar-guia';
  variantesRaiz.innerHTML = `
    <p class="nota lidar-recomendado">G / H / I) Variantes de archivos USDZ para el QR seleccionado</p>
    <div class="g"></div><p class="nota g-estado"></p>
    <div class="h"></div><p class="nota h-estado"></p>
    <div class="i"></div><p class="nota i-estado"></p>`;
  cont.appendChild(variantesRaiz);
  (async () => {
    const [{ listarAnclas, mapaAnclas, maquinaActivaId }, { leerAjustes }] = await Promise.all([import('../maquinas.js'), import('../ajustes.js')]);
    const maq = maquinaActivaId();
    const anclas = maq ? await listarAnclas(maq) : [...(await mapaAnclas()).values()];
    if (!activo) return;
    if (!anclas.some((a) => a.id === 'TEST-1')) anclas.push({ id: 'TEST-1', nombre: 'QR de prueba' });
    const sel = raiz.querySelector('[data-r="ancla"]');
    for (const a of anclas) { const o = document.createElement('option'); o.value = a.id; o.textContent = `${a.nombre} (${a.id})`; sel.appendChild(o); }
    const inLado = raiz.querySelector('[data-r="lado"]');
    const ladoConfigurado = leerAjustes().qrCm || 10;
    const preparar = async () => {
      const lado = parseFloat(String(inLado.value).replace(',', '.')) || 10;
      const { botonVisor } = await import('../ar/visor-nativo.js');
      const nat = raiz.querySelector('.nativo');
      nat.innerHTML = '';
      nat.appendChild(botonVisor({ puntos: [[0, 0, 0], [0, 0, -1], [0.5, 0, -1]], info: { nombre: 'Prueba', referencia: '100 adelante · 50 derecha' }, anclaId: sel.value, ladoCm: lado }, '📱 Prueba en el visor nativo'));
      const THREE = await import('three');
      const [{ escenaPaso }, { usdzImagenEnRaiz }, { pngMarcador }] = await Promise.all([
        import('../ar/recorrido-lidar.js'), import('../ar/anclaje-raiz.js'), import('../ar/marcador.js')]);
      const pts = [[0, 0, 0], [0, 0, -1], [0.5, 0, -1]].map((q) => new THREE.Vector3(...q));
      const variantes = [
        ['g', 'G', 'QR · tamaño en cm', { unidad: 'cm', anchoCm: lado }],
        ['h', 'H', 'QR · tamaño en metros', { unidad: 'm', anchoCm: lado }],
        ['i', 'I', 'marcador de colores (si lo imprimiste) · cm', { unidad: 'cm', marcador: true }],
      ];
      for (const [clase, letra, texto, op] of variantes) {
        const caja = variantesRaiz.querySelector('.' + clase), est = variantesRaiz.querySelector(`.${clase}-estado`);
        caja.innerHTML = ''; est.textContent = '⏳ Preparando…';
        try {
          const textoQR = 'INFOLENS:' + sel.value;
          let imagen = null, anchoCm = op.anchoCm;
          if (op.marcador) { const m = await pngMarcador(textoQR, leerAjustes().qrCm || 10); imagen = m.png; anchoCm = m.anchoCm; }
          const escena = escenaPaso(pts, { nombre: 'Prueba', referencia: '100 adelante · 50 derecha' }, { ladoCm: lado });
          const b = await usdzImagenEnRaiz(escena, { textoQR, anchoCm, unidad: op.unidad, imagen });
          if (!activo) return;
          caja.appendChild(crearEnlaceAR({ url: URL.createObjectURL(b), texto: `🧪 Probar ${letra}` }).enlace);
          est.textContent = `${letra}: ${texto} · ${Math.round(b.size / 1024)} KB`;
        } catch (e) { est.textContent = '❌ ' + (e && e.message ? e.message : e); }
      }
    };
    const cambiarAncla = () => {
      inLado.value = String(sel.value === 'TEST-1' ? 10 : ladoConfigurado).replace('.', ',');
      preparar();
    };
    sel.addEventListener('change', cambiarAncla);
    inLado.addEventListener('change', preparar);
    sel.value = 'TEST-1';
    cambiarAncla();
  })();
  return () => { activo = false; };
}
