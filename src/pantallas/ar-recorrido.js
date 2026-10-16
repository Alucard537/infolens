// Pantalla "#/ar?d=…": recorrido con LiDAR a partir de los datos de la dirección (sin base de datos).
// Sirve para abrirlo en SAFARI desde la app instalada en la pantalla de inicio: allí el AR de Apple
// no se abre, y Safari no tiene los datos de la app (son almacenes distintos). Por eso el recorrido
// viaja dentro de la dirección: d = { n: nombre del destino, p: puntos en metros desde el QR }.
import { hayQuickLook, crearEnlaceAR } from '../ar/boton-ar.js';
import { deG, describir } from '../coordenadas.js';

export function leerDatosRecorrido(texto) {
  try {
    const d = JSON.parse(texto || '');
    const ok = d && Array.isArray(d.p) && d.p.length >= 2 && d.p.length <= 200
      && d.p.every((q) => Array.isArray(q) && q.length === 3 && q.every((n) => Number.isFinite(n) && Math.abs(n) < 1000));
    return ok ? { nombre: String(d.n || 'Destino').slice(0, 80), puntos: d.p } : null;
  } catch {
    return null;
  }
}

export function pantallaArRecorrido(app, datosTexto, { volver }) {
  let activo = true;
  const datos = leerDatosRecorrido(datosTexto);
  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Inicio</button>
      <h1>🧭 Recorrido con LiDAR</h1>
      <p class="det-ref"></p>
      <div class="ar-cuerpo"></div>
    </div>`;
  app.querySelector('.volver').addEventListener('click', volver);
  const cuerpo = app.querySelector('.ar-cuerpo');
  if (!datos) { cuerpo.innerHTML = '<p class="error-form">Esta dirección no tiene un recorrido válido.</p>'; return () => {}; }
  app.querySelector('.det-ref').textContent = `Destino: ${datos.nombre} · ${describir(deG(datos.puntos[datos.puntos.length - 1]))} desde el QR del ancla`;
  if (!hayQuickLook()) {
    cuerpo.innerHTML = '<p class="error-form">El AR con LiDAR solo se abre en Safari de iPhone o iPad (no desde la app instalada).</p>';
    return () => {};
  }
  cuerpo.innerHTML = `
    <p class="nota">🟥 Rojo = el QR del ancla · 🟦 Azul = <span class="n"></span>.<br>
      Coloca el rojo encima del QR del ancla y gira con dos dedos hasta que las flechas salgan hacia "▲ ADELANTE". Luego camina.</p>
    <button class="boton grande" data-a="preparar">⚙️ Preparar recorrido con LiDAR</button>
    <div class="listo"></div>
    <p class="nota">Cuando termines, vuelve a la app InfoLens para seguir con la guía.</p>`;
  cuerpo.querySelector('.n').textContent = datos.nombre;
  const btn = cuerpo.querySelector('[data-a="preparar"]');
  const listo = cuerpo.querySelector('.listo');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⏳ Preparando…';
    listo.innerHTML = '';
    try {
      const THREE = await import('three');
      const [{ usdzRecorridoObjetos }, { direccionWeb }] = await Promise.all([import('../ar/prueba-flechas.js'), import('../ar/quicklook.js')]);
      const bytes = await usdzRecorridoObjetos(datos.puntos.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
      const blob = new Blob([bytes], { type: 'model/vnd.usdz+zip' });
      const url = await direccionWeb('safari', blob);
      if (!activo) return;
      listo.appendChild(crearEnlaceAR({ url, texto: '🧭 Ver recorrido con LiDAR' }).enlace);
      const info = document.createElement('p');
      info.className = 'nota';
      info.textContent = `✅ Listo · ${Math.round(blob.size / 1024)} KB. Toca el botón verde.`;
      listo.appendChild(info);
      btn.textContent = '↻ Volver a preparar';
    } catch (e) {
      const p = document.createElement('p');
      p.className = 'error-form';
      p.textContent = '❌ No se pudo preparar: ' + (e && e.message ? e.message : e);
      listo.appendChild(p);
      btn.textContent = '⚙️ Preparar recorrido con LiDAR';
    }
    btn.disabled = false;
  });
  return () => { activo = false; };
}
