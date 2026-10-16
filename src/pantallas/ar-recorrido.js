// Pantalla "#/ar?d=…": recorrido con LiDAR a partir de los datos de la dirección (sin base de datos).
// Sirve para abrirlo en SAFARI desde la app instalada en la pantalla de inicio (Safari no tiene los
// datos de la app: son almacenes distintos). d = { p: puntos (m) desde el QR, i: info del elemento,
// a: id del ancla, l: tamaño del QR (cm), c: 'suelo'|'pared', g: giro (grados) }.
import { bloquePasoLidar } from '../ar/bloque-lidar.js';
import { deG, describir } from '../coordenadas.js';

export function leerDatosRecorrido(texto) {
  try {
    const d = JSON.parse(texto || '');
    const ok = d && Array.isArray(d.p) && d.p.length >= 2 && d.p.length <= 200
      && d.p.every((q) => Array.isArray(q) && q.length === 3 && q.every((n) => Number.isFinite(n) && Math.abs(n) < 1000));
    if (!ok) return null;
    const i = d.i && typeof d.i === 'object' ? d.i : { nombre: d.n };
    const txt = (v, n) => String(v || '').slice(0, n);
    return {
      puntos: d.p,
      info: { nombre: txt(i.nombre || 'Destino', 80), referencia: txt(i.referencia, 80), id: txt(i.id, 60), descripcion: txt(i.descripcion, 300) },
      anclaId: txt(d.a, 80),
      ladoCm: Number(d.l) > 0 && Number(d.l) < 200 ? Number(d.l) : 10,
      fijos: {
        colocacion: d.c === 'pared' ? 'pared' : 'suelo',
        giro: Number.isFinite(Number(d.g)) ? Math.round(Number(d.g) / 5) * 5 : 0,
        anchoReal: Number(d.w) > 2 && Number(d.w) < 200 ? Number(d.w) : null,
        vista: d.v === 'linea' ? 'linea' : 'flechas',
      },
    };
  } catch {
    return null;
  }
}

export function pantallaArRecorrido(app, datosTexto, { volver }) {
  const datos = leerDatosRecorrido(datosTexto);
  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Inicio</button>
      <h1>🧭 Recorrido con LiDAR</h1>
      <p class="det-ref"></p>
      <div class="ar-cuerpo"></div>
      <p class="nota">Cuando termines, vuelve a la app InfoLens para seguir con la guía.</p>
    </div>`;
  app.querySelector('.volver').addEventListener('click', volver);
  const cuerpo = app.querySelector('.ar-cuerpo');
  if (!datos) { cuerpo.innerHTML = '<p class="error-form">Esta dirección no tiene un recorrido válido.</p>'; return () => {}; }
  app.querySelector('.det-ref').textContent = `Destino: ${datos.info.nombre} · ${describir(deG(datos.puntos[datos.puntos.length - 1]))} desde el QR del ancla`;
  if (!datos.anclaId) {
    // Direcciones antiguas sin ancla: solo se puede colocar a mano
    datos.anclaId = 'ANCLA';
  }
  cuerpo.appendChild(bloquePasoLidar(datos));
  return () => {};
}
