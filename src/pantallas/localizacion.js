// Localizaciones de un elemento (administrador): respecto a qué ancla de SU máquina está, en qué
// coordenadas, por qué puntos intermedios pasa el recorrido y dónde va el icono final.
// Coordenadas en cm en pantalla (en metros en la base de datos). X derecha, Y arriba, Z hacia fuera del QR.
import { obtenerElemento } from '../db.js';
import {
  obtenerMaquina, listarAnclas, localizacionesDeElemento, guardarLocalizacion, borrarLocalizacion,
} from '../maquinas.js';

const cm = (m) => String(Math.round(m * 1000) / 10).replace('.', ',');
const num = (t) => parseFloat(String(t).replace(',', '.'));

export function pantallaLocalizacion(app, elementoId, { volver, previsualizar, posicionarConCamara }) {
  let activo = true;

  const pintar = async () => {
    const el = await obtenerElemento(elementoId);
    if (!activo) return;
    if (!el) { app.innerHTML = '<div class="pagina"><p>El elemento no existe.</p></div>'; return; }
    const maquina = el.maquinaId ? await obtenerMaquina(el.maquinaId) : null;
    const [anclas, locs] = await Promise.all([listarAnclas(el.maquinaId), localizacionesDeElemento(elementoId)]);
    if (!activo) return;
    app.innerHTML = `
      <div class="pagina formulario">
        <button class="volver">‹ Volver</button>
        <h1>🧭 Localizaciones</h1>
        <p class="det-ref"></p>
        <p class="nota">Dónde está este componente respecto a cada ancla QR de su máquina, en <b>cm</b> desde el centro del QR:
          <b>X</b> a la derecha, <b>Y</b> hacia arriba (según la gravedad), <b>Z</b> hacia fuera del QR (hacia quien lo mira).
          Lo más fácil es medirlo con la cámara: botón <b>📍</b> en ANCLA, viendo a la vez el QR del ancla y el del componente.</p>
        <div class="avisos-loc"></div>
        <div class="lista-loc"></div>
        <button class="boton" data-a="nueva">➕ Nueva localización (otra ancla)</button>
        <button class="boton secundario" data-a="camara">📍 Medir con la cámara (ANCLA)</button>
      </div>`;
    const $ = (s) => app.querySelector(s);
    $('.volver').addEventListener('click', volver);
    $('.det-ref').textContent = `${el.nombre} · ${el.referencia} · ${el.id} — Máquina: ${maquina ? maquina.nombre : 'ninguna'}`;
    $('[data-a="camara"]').addEventListener('click', posicionarConCamara);
    if (!maquina) { $('.avisos-loc').innerHTML = '<p class="error-form">Este elemento no pertenece a ninguna máquina. Asígnalo a una máquina para poder localizarlo.</p>'; return; }
    if (!anclas.length) { $('.avisos-loc').innerHTML = '<p class="error-form">Su máquina todavía no tiene anclas. Créalas en Gestión de máquinas.</p>'; }

    const cont = $('.lista-loc');
    const bloque = (loc) => {
      const b = document.createElement('form');
      b.className = 'bloque-archivo bloque-loc';
      b.noValidate = true;
      b.innerHTML = `
        <label>Ancla de referencia (de la máquina ${maquina.id})
          <select name="ancla"></select>
        </label>
        <div class="titulo-archivo">📌 Posición del componente (cm)</div>
        <div class="fila-xyz">
          <label>X<input name="x" inputmode="decimal"></label><label>Y<input name="y" inputmode="decimal"></label><label>Z<input name="z" inputmode="decimal"></label>
        </div>
        <div class="titulo-archivo">↪️ Puntos intermedios (en orden)</div>
        <p class="nota">Sin puntos, las flechas van en línea recta. Añade puntos para rodear la máquina o bajar al suelo, sin atravesarla.</p>
        <ol class="puntos"></ol>
        <button type="button" class="boton-mini" data-a="punto">➕ Añadir punto</button>
        <div class="titulo-archivo">ℹ️ Posición del icono final (cm, opcional)</div>
        <p class="nota">Vacío = justo encima del componente.</p>
        <div class="fila-xyz">
          <label>X<input name="ix" inputmode="decimal"></label><label>Y<input name="iy" inputmode="decimal"></label><label>Z<input name="iz" inputmode="decimal"></label>
        </div>
        <p class="error-form" hidden></p><p class="ok-form" hidden></p>
        <div class="botones-archivo">
          <button class="boton" type="submit">💾 Guardar</button>
          ${loc ? '<button class="boton secundario" type="button" data-a="ver">🧪 Previsualizar</button>' : ''}
        </div>
        ${loc ? '<button class="quitar" type="button" data-a="borrar">Borrar esta localización</button>' : ''}`;
      const sel = b.elements.ancla;
      for (const a of anclas) {
        const o = document.createElement('option');
        o.value = a.id; o.textContent = `${a.nombre} (${a.id})`;
        sel.appendChild(o);
      }
      if (loc) { sel.value = loc.anclaId; sel.disabled = true; }
      const ol = b.querySelector('.puntos');
      const fila = (p) => {
        const li = document.createElement('li');
        li.className = 'punto-fila';
        li.innerHTML = '<input class="px" inputmode="decimal" placeholder="X"><input class="py" inputmode="decimal" placeholder="Y"><input class="pz" inputmode="decimal" placeholder="Z"><button type="button" class="boton-mini" data-m="sube">↑</button><button type="button" class="boton-mini" data-m="baja">↓</button><button type="button" class="boton-mini" data-m="quita">✕</button>';
        if (p) { li.querySelector('.px').value = cm(p[0]); li.querySelector('.py').value = cm(p[1]); li.querySelector('.pz').value = cm(p[2]); }
        li.addEventListener('click', (ev) => {
          const m = ev.target.dataset.m;
          if (m === 'sube' && li.previousElementSibling) ol.insertBefore(li, li.previousElementSibling);
          if (m === 'baja' && li.nextElementSibling) ol.insertBefore(li.nextElementSibling, li);
          if (m === 'quita') li.remove();
        });
        ol.appendChild(li);
      };
      if (loc) {
        [b.elements.x.value, b.elements.y.value, b.elements.z.value] = loc.pos.map(cm);
        (loc.ruta || []).forEach(fila);
        if (loc.posIcono) [b.elements.ix.value, b.elements.iy.value, b.elements.iz.value] = loc.posIcono.map(cm);
      }
      b.querySelector('[data-a="punto"]').addEventListener('click', () => fila(null));
      b.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const er = b.querySelector('.error-form'), ok = b.querySelector('.ok-form');
        er.hidden = true; ok.hidden = true;
        try {
          const pos = [b.elements.x.value, b.elements.y.value, b.elements.z.value].map(num);
          if (pos.some((n) => !Number.isFinite(n))) throw new Error('Escribe X, Y y Z de la posición (en cm).');
          const ruta = [...ol.querySelectorAll('.punto-fila')].map((li, i) => {
            const p = ['.px', '.py', '.pz'].map((c) => num(li.querySelector(c).value));
            if (p.some((n) => !Number.isFinite(n))) throw new Error(`El punto intermedio ${i + 1} necesita X, Y y Z.`);
            return p.map((n) => n / 100);
          });
          const ic = [b.elements.ix.value, b.elements.iy.value, b.elements.iz.value];
          let posIcono = null;
          if (ic.some((t) => String(t).trim() !== '')) {
            const p = ic.map(num);
            if (p.some((n) => !Number.isFinite(n))) throw new Error('La posición del icono necesita X, Y y Z (o déjala vacía).');
            posIcono = p.map((n) => n / 100);
          }
          if (!sel.value) throw new Error('Elige un ancla.');
          await guardarLocalizacion({ maquinaId: el.maquinaId, anclaId: sel.value, elementoId, pos: pos.map((n) => n / 100), ruta, posIcono });
          ok.hidden = false; ok.textContent = '✅ Guardada.';
          if (!loc) pintar();
        } catch (ex) { er.hidden = false; er.textContent = ex.message; }
      });
      b.querySelector('[data-a="ver"]')?.addEventListener('click', () => previsualizar(loc));
      b.querySelector('[data-a="borrar"]')?.addEventListener('click', async () => {
        if (!confirm('¿Borrar esta localización?')) return;
        await borrarLocalizacion(loc.id);
        pintar();
      });
      return b;
    };
    if (!locs.length && anclas.length) cont.appendChild(bloque(null));
    for (const l of locs) cont.appendChild(bloque(l));
    $('[data-a="nueva"]').addEventListener('click', () => {
      const libres = anclas.filter((a) => !locs.some((l) => l.anclaId === a.id));
      if (!libres.length) { alert('Ya tiene localización respecto a todas las anclas de su máquina.'); return; }
      const b = bloque(null);
      b.elements.ancla.value = libres[0].id;
      cont.appendChild(b);
      b.scrollIntoView({ behavior: 'smooth' });
    });
  };
  pintar();
  return () => { activo = false; };
}
