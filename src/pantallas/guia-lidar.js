// GUÍA CON LiDAR: la guía paso a paso SIN la cámara de la app (como la prueba del inicio, que funciona).
// Cada paso tiene su botón del AR de Apple con un solo objeto: ancla 🟥 + flechas + componente 🟦.
// Si la app tuviera la cámara abierta, el AR de Apple se abriría sin realidad aumentada.
import { obtenerArchivo, mapaElementos } from '../db.js';
import { obtenerGuia, obtenerAncla, localizacionesDeAncla, maquinaActivaId, TIPOS_GUIA } from '../maquinas.js';
import { esAdmin } from '../permisos.js';
import { hayQuickLook } from '../ar/boton-ar.js';
import { deG, describir } from '../coordenadas.js';

/** ¿Adónde se va en un paso? 1) sus tramos, 2) posición final suelta (antiguas), 3) localización del componente. */
export function destinoDelPaso(p, locs) {
  const propios = Array.isArray(p.rutaPropia) && p.rutaPropia.length ? p.rutaPropia : null;
  if (propios) return { pos: propios[propios.length - 1], ruta: propios.slice(0, -1) };
  if (Array.isArray(p.destinoPropio)) return { pos: p.destinoPropio, ruta: [] };
  const l = p.elementoId && locs.get(p.elementoId);
  return l ? { pos: l.pos, ruta: l.ruta || [] } : null;
}

export function pantallaGuiaLidar(app, id, { pasoInicial = 0, volver, abrirDetalle, abrirImagen }) {
  let activo = true;
  const urls = [];
  let paso = pasoInicial;
  const cumplido = new Map();
  const estadoDe = (i) => {
    if (!cumplido.has(i)) cumplido.set(i, { advertencia: false, comprobaciones: new Set(), confirmado: false });
    return cumplido.get(i);
  };

  (async () => {
    const g = await obtenerGuia(id);
    if (!activo) return;
    const problema = !g ? 'La guía no existe.'
      : g.maquinaId !== maquinaActivaId() ? 'Esta guía no pertenece a la máquina seleccionada.'
        : g.estado !== 'publicada' && !esAdmin() ? 'Esta guía no está disponible.'
          : !(g.pasos || []).length ? 'La guía no tiene pasos.' : null;
    const ancla = g && g.anclaId ? await obtenerAncla(g.anclaId) : null;
    if (problema || !ancla || ancla.maquinaId !== g.maquinaId) {
      app.innerHTML = '<div class="pagina"><button class="volver">‹ Volver</button><p class="error-form"></p></div>';
      app.querySelector('.error-form').textContent = problema || 'La guía no tiene un ancla válida de esta máquina.';
      app.querySelector('.volver').addEventListener('click', volver);
      return;
    }
    const [els, ls] = await Promise.all([mapaElementos(), localizacionesDeAncla(g.maquinaId, g.anclaId)]);
    if (!activo) return;
    const elementos = new Map([...els].filter(([, e]) => e.maquinaId === g.maquinaId));
    const locs = new Map(ls.map((l) => [l.elementoId, l]));
    const { bloqueRecorridoLidar } = await import('../ar/quicklook.js');
    paso = Math.min(Math.max(0, paso), g.pasos.length - 1);

    const puedeAvanzar = (i) => {
      const p = g.pasos[i], e = estadoDe(i);
      if (p.advertencia && !e.advertencia) return false;
      if ((p.comprobaciones || []).some((_, k) => !e.comprobaciones.has(k))) return false;
      if (p.confirmar && !e.confirmado) return false;
      return true;
    };

    async function pintar() {
      const p = g.pasos[paso], e = estadoDe(paso), total = g.pasos.length;
      const el = p.elementoId ? elementos.get(p.elementoId) || null : null;
      const destino = destinoDelPaso(p, locs);
      app.innerHTML = `
        <div class="pagina guia-lidar">
          <button class="volver">‹ Salir</button>
          <div class="guia-nombre"></div>
          <div class="guia-paso"></div>
          <h2 class="guia-titulo"></h2>
          <div class="lidar-paso"></div>
          <div class="cuerpo-paso"></div>
          <div class="guia-nav"><button class="boton secundario" data-g="ant">‹ Anterior</button><button class="boton" data-g="sig"></button></div>
        </div>`;
      const $ = (s) => app.querySelector(s);
      $('.volver').addEventListener('click', () => { if (confirm('¿Salir de la guía?')) volver(); });
      $('.guia-nombre').textContent = `📘 ${g.nombre}`;
      $('.guia-paso').textContent = `Paso ${paso + 1} de ${total} · ${TIPOS_GUIA[g.tipo] || ''} · Ancla: ${ancla.nombre}`;
      $('.guia-titulo').textContent = p.titulo || (el ? `Localizar: ${el.nombre}` : `Paso ${paso + 1}`);
      const lp = $('.lidar-paso');
      if (destino && p.flechas !== false) {
        if (hayQuickLook() || /iPhone|iPad|iPod/.test(navigator.userAgent)) {
          const comp = el || { id: 'paso-' + (paso + 1), nombre: p.titulo || `Paso ${paso + 1}`, referencia: g.nombre };
          lp.appendChild(bloqueRecorridoLidar({ ...comp, nav: destino }, { id: g.anclaId }, 0));
        } else {
          lp.innerHTML = '<p class="nota">🧊 El AR con LiDAR solo se abre en Safari de iPhone o iPad (no desde la app instalada).</p>';
        }
        const d = document.createElement('p');
        d.className = 'nota';
        d.textContent = `📍 Destino: ${describir(deG(destino.pos))} desde el QR del ancla.`;
        lp.appendChild(d);
      } else if (p.elementoId && !destino) {
        lp.innerHTML = '<p class="error-form">Este componente no tiene localización respecto al ancla de la guía ni tramos en el paso.</p>';
      }
      const c = $('.cuerpo-paso');
      if (el) {
        const f = document.createElement('div');
        f.className = 'guia-componente';
        f.innerHTML = '<b></b><span></span><button class="boton-mini">ℹ️ Ficha</button>';
        f.querySelector('b').textContent = el.nombre;
        f.querySelector('span').textContent = ` · ${el.referencia}`;
        f.querySelector('button').addEventListener('click', () => abrirDetalle(el.id));
        c.appendChild(f);
      }
      if (p.texto) {
        const t = document.createElement('p');
        t.className = 'guia-texto';
        t.textContent = p.texto;
        c.appendChild(t);
      }
      for (const fid of p.imagenes || []) {
        const a = await obtenerArchivo(fid);
        if (!a || !activo) continue;
        const u = URL.createObjectURL(a.blob); urls.push(u);
        const b = document.createElement('button');
        b.className = 'guia-foto';
        b.innerHTML = '<img alt="">';
        b.querySelector('img').src = u;
        b.addEventListener('click', () => abrirImagen && abrirImagen(u, $('.guia-titulo').textContent));
        c.appendChild(b);
      }
      for (const fid of p.videos || []) {
        const a = await obtenerArchivo(fid);
        if (!a || !activo) continue;
        const u = URL.createObjectURL(a.blob); urls.push(u);
        const v = document.createElement('video');
        v.className = 'guia-video'; v.src = u; v.controls = true; v.playsInline = true; v.preload = 'metadata';
        c.appendChild(v);
      }
      if (p.advertencia) {
        const a = document.createElement('div');
        a.className = 'guia-advertencia';
        a.innerHTML = '<div class="guia-adv-titulo">⚠️ Seguridad</div><p></p><label class="fila check"><input type="checkbox"> He leído y aplico estas medidas de seguridad</label>';
        a.querySelector('p').textContent = p.advertencia;
        const cb = a.querySelector('input');
        cb.checked = e.advertencia;
        cb.addEventListener('change', () => { e.advertencia = cb.checked; botones(); });
        c.appendChild(a);
      }
      if ((p.comprobaciones || []).length) {
        const box = document.createElement('div');
        box.className = 'guia-comprobaciones';
        box.innerHTML = '<div class="guia-adv-titulo">☑️ Comprobaciones</div>';
        p.comprobaciones.forEach((texto, k) => {
          const l = document.createElement('label');
          l.className = 'fila check';
          l.innerHTML = '<input type="checkbox"> <span></span>';
          l.querySelector('span').textContent = texto;
          const cb = l.querySelector('input');
          cb.checked = e.comprobaciones.has(k);
          cb.addEventListener('change', () => { if (cb.checked) e.comprobaciones.add(k); else e.comprobaciones.delete(k); botones(); });
          box.appendChild(l);
        });
        c.appendChild(box);
      }
      if (p.confirmar) {
        const b = document.createElement('button');
        b.className = 'boton boton-fijar';
        const t = () => { b.textContent = e.confirmado ? '✅ Paso completado' : '✔ Marcar el paso como completado'; };
        t();
        b.addEventListener('click', () => { e.confirmado = !e.confirmado; t(); botones(); });
        c.appendChild(b);
      }
      const ant = $('[data-g="ant"]'), sig = $('[data-g="sig"]');
      ant.disabled = paso === 0;
      ant.addEventListener('click', () => { paso--; pintar(); });
      sig.textContent = paso === total - 1 ? '🏁 Finalizar guía' : 'Siguiente ›';
      sig.addEventListener('click', () => {
        if (!puedeAvanzar(paso)) return;
        if (paso === total - 1) fin(); else { paso++; pintar(); }
      });
      botones();
      window.scrollTo(0, 0);
    }
    function botones() {
      const sig = app.querySelector('[data-g="sig"]');
      if (sig) sig.disabled = !puedeAvanzar(paso);
    }
    function fin() {
      app.innerHTML = '<div class="pagina"><h1>🏁 Guía finalizada</h1><p class="det-ref"></p><button class="boton">Volver</button></div>';
      app.querySelector('.det-ref').textContent = `${g.nombre}: has completado los ${g.pasos.length} pasos.`;
      app.querySelector('button').addEventListener('click', volver);
    }
    pintar();
  })();
  return () => { activo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
}
